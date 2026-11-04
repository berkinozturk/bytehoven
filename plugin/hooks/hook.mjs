import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
// server/live/parse.ts
var basename = (p) => typeof p === "string" && p ? p.split(/[\\/]/).filter(Boolean).pop() : void 0;
var PKG = /* @__PURE__ */ new Set([
	"npm",
	"pnpm",
	"yarn",
	"bun"
]);
/** The verb of a shell command: "git push origin" → "git", "npm run test" → "npm test". */
function commandTarget(cmd) {
	for (const segment of cmd.split(/&&|\|\||;|\|/)) {
		const words = segment.trim().split(/\s+/).filter((w) => w && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
		let i = 0;
		let verb = basename(words[i]);
		if (!verb || verb === "cd") continue;
		if (verb === "npx" || verb === "bunx" || verb === "pnpx") verb = basename(words[++i]);
		if ((verb === "python" || verb === "python3") && words[i + 1] === "-m") verb = basename(words[i += 2]);
		if (!verb) continue;
		const rest = words.slice(i + 1);
		if (PKG.has(verb) && (rest[0] === "test" || rest[0] === "run" && rest[1] === "test")) return `${verb} test`;
		if ((verb === "cargo" || verb === "go") && rest[0] === "test") return `${verb} test`;
		if (verb === "node" && rest[0] === "--test") return "node --test";
		return verb;
	}
}
// server/live/permission.ts
/**
* What the permission hook sends to Bytehoven: the session, its folder name, the
* tool and a short target. Same privacy contract as the transcript parser:
* commands are cut to their verb, paths to a base name, contents are dropped.
*
* Claude Code and Codex send the same PermissionRequest shape (session_id, cwd,
* tool_name, tool_input). For Codex the session and folder are named the way
* the Codex reader names them, so the request lands on the right session.
*/
var SHELL = /* @__PURE__ */ new Set([
	"Bash",
	"exec_command",
	"shell",
	"shell_command",
	"local_shell"
]);
function permissionBody(hook, codex) {
	if (hook.hook_event_name !== "PermissionRequest" || typeof hook.session_id !== "string") return null;
	const input = hook.tool_input && typeof hook.tool_input === "object" ? hook.tool_input : {};
	const tool = typeof hook.tool_name === "string" ? hook.tool_name : "";
	const folder = typeof hook.cwd === "string" ? basename(hook.cwd) : void 0;
	return {
		event: "PermissionRequest",
		session: codex ? `codex:${hook.session_id}` : hook.session_id,
		folder: codex ? `${folder ?? "codex"} · codex` : folder,
		agent: typeof hook.agent_id === "string" ? hook.agent_id : void 0,
		tool: SHELL.has(tool) ? "Bash" : tool === "apply_patch" ? "Edit" : tool,
		target: targetOf(input)
	};
}
function targetOf(input) {
	const file = input.file_path ?? input.notebook_path;
	if (typeof file === "string") return basename(file);
	const cmd = input.cmd ?? input.command;
	if (typeof cmd === "string") return commandTarget(cmd);
	if (Array.isArray(cmd)) return commandTarget(cmd.length >= 3 && cmd[1] === "-lc" ? String(cmd[2]) : cmd.map(String).join(" "));
	const patch = typeof input.input === "string" ? input.input : typeof input.patch === "string" ? input.patch : "";
	const m = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/m.exec(patch);
	return m ? basename(m[1].trim()) : void 0;
}
// bin/bytehoven-hook.ts
/**
* Bytehoven's permission hook (PermissionRequest), for Claude Code and Codex CLI.
*
* The agent runs this when a tool needs your permission. It forwards only the
* session id, the tool name and a short target (a file's base name or a command's
* first word) to Bytehoven on 127.0.0.1, then waits for Approve / Deny there.
*
* If Bytehoven isn't running, nobody is watching, or no answer comes in time,
* it prints nothing and Claude Code shows its own permission prompt as usual.
*/
var LIVE_FILE = path.join(process.env.BYTEHOVEN_HOME || path.join(os.homedir(), ".bytehoven"), "live.json");
var WAIT_MS = 55e3;
function readStdin() {
	return new Promise((resolve) => {
		let data = "";
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (c) => data += c);
		process.stdin.on("end", () => resolve(data));
	});
}
async function main() {
	let live;
	try {
		live = JSON.parse(fs.readFileSync(LIVE_FILE, "utf8"));
	} catch {
		return;
	}
	let hook;
	try {
		hook = JSON.parse(await readStdin());
	} catch {
		return;
	}
	const body = permissionBody(hook, process.argv.includes("--codex"));
	if (!body) return;
	const decision = await new Promise((resolve) => {
		const req = http.request({
			host: "127.0.0.1",
			port: live.port,
			method: "POST",
			path: "/__live/hook",
			headers: {
				host: `127.0.0.1:${live.port}`,
				"content-type": "application/json",
				"x-bytehoven-token": live.token
			},
			timeout: WAIT_MS
		}, (res) => {
			let data = "";
			res.on("data", (c) => data += c);
			res.on("end", () => {
				try {
					resolve(JSON.parse(data).decision ?? null);
				} catch {
					resolve(null);
				}
			});
		});
		req.on("timeout", () => req.destroy());
		req.on("error", () => resolve(null));
		req.end(JSON.stringify(body));
	});
	if (decision === "allow" || decision === "deny") {
		const out = {
			behavior: decision,
			...decision === "deny" ? { message: "Denied from Bytehoven." } : {}
		};
		process.stdout.write(JSON.stringify({ hookSpecificOutput: {
			hookEventName: "PermissionRequest",
			decision: out
		} }));
	}
}
main();
export {};
