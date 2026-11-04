import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeFrames, type FrameHost } from '../src/ui/frames.ts';

/** A fake window whose animation frames run only when we flush them. */
function fakeHost() {
  let next = 1;
  const queue = new Map<number, FrameRequestCallback>();
  const host: FrameHost = {
    requestAnimationFrame: (cb) => {
      queue.set(next, cb);
      return next++;
    },
    cancelAnimationFrame: (id) => void queue.delete(id),
  };
  const flush = () => {
    const due = [...queue.values()];
    queue.clear();
    for (const cb of due) cb(0);
  };
  return { host, flush, pending: () => queue.size };
}

/** A render loop like Pixi's ticker or the score: draw, then ask for the next frame. */
function startLoop(host: FrameHost) {
  const state = { frames: 0 };
  const loop = () => {
    state.frames++;
    host.requestAnimationFrame(loop);
  };
  host.requestAnimationFrame(loop);
  return state;
}

test('render loops keep running in the main tab after the pop-out closes', () => {
  const home = fakeHost();
  const away = fakeHost();
  const loop = startLoop(home.host);
  home.flush();

  const back = routeFrames(home.host, away.host);
  home.flush(); // the frame already queued at home runs, then the loop moves away
  away.flush();
  away.flush();
  const before = loop.frames;

  back(); // the pop-out closes: its queued frames will never run
  home.flush();
  home.flush();
  assert.equal(loop.frames, before + 2, 'the loop should resume in the main tab');
});

test('a frame does not run twice if the closing window fires it late', () => {
  const home = fakeHost();
  const away = fakeHost();
  const loop = startLoop(home.host);
  const back = routeFrames(home.host, away.host);
  home.flush();
  back();
  away.flush(); // a late frame from the closed window
  home.flush();
  assert.equal(loop.frames, 2);
  assert.equal(home.pending(), 1, 'exactly one loop is still scheduled');
});

test('cancelled frames are not carried back', () => {
  const home = fakeHost();
  const away = fakeHost();
  const back = routeFrames(home.host, away.host);
  let ran = false;
  const id = home.host.requestAnimationFrame(() => (ran = true));
  home.host.cancelAnimationFrame(id);
  back();
  home.flush();
  assert.equal(ran, false);
});
