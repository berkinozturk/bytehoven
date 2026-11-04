/**
 * Pop-out: moves the whole app into an always-on-top Document Picture-in-Picture
 * window (Chrome / Edge 116+), so the orchestra can sit on top of a terminal or
 * an editor running Claude Code. Audio keeps running in the original tab.
 */

interface DocumentPiP {
  requestWindow(opts: { width: number; height: number }): Promise<Window>;
}

const dpip = () => (window as unknown as { documentPictureInPicture?: DocumentPiP }).documentPictureInPicture;

export const canPopOut = () => !!dpip();

export interface PopOutHooks {
  /** Called once the app lives in `win`; wire up anything bound to the main window. */
  opened: (win: Window) => void;
  /** Called after the app is back in the main tab. */
  closed: () => void;
  /** Placeholder shown in the main tab while the app is away. */
  placeholder: () => HTMLElement;
}

export async function popOut(app: HTMLElement, hooks: PopOutHooks): Promise<boolean> {
  const api = dpip();
  if (!api) return false;
  let win: Window;
  try {
    win = await api.requestWindow({ width: 520, height: 440 });
  } catch {
    return false; // some embedded browsers expose the API but can't open the window
  }
  const doc = win.document;

  // Resolve relative font/style URLs against the app, then copy every stylesheet.
  const base = doc.createElement('base');
  base.href = location.href;
  doc.head.appendChild(base);
  for (const node of document.head.querySelectorAll('style, link[rel="stylesheet"]')) doc.head.appendChild(node.cloneNode(true));
  doc.documentElement.lang = document.documentElement.lang;
  doc.title = document.title;

  const home = app.parentElement!;
  const placeholder = hooks.placeholder();
  home.insertBefore(placeholder, app);
  doc.body.appendChild(app);

  // The main tab may be hidden behind other windows, and browsers throttle animation
  // frames there. Every render loop (Pixi, Tone.Draw, the score) asks the global
  // requestAnimationFrame, so route it to the visible window while we're popped out.
  const raf = window.requestAnimationFrame;
  const caf = window.cancelAnimationFrame;
  window.requestAnimationFrame = (cb) => win.requestAnimationFrame(cb);
  window.cancelAnimationFrame = (id) => win.cancelAnimationFrame(id);

  // Keyboard shortcuts and resize listeners live on the main window: forward them.
  const forwardKey = (e: KeyboardEvent) => {
    const copy = new KeyboardEvent('keydown', { key: e.key, code: e.code, cancelable: true });
    window.dispatchEvent(copy);
    if (copy.defaultPrevented) e.preventDefault();
  };
  const forwardResize = () => window.dispatchEvent(new Event('resize'));
  win.addEventListener('keydown', forwardKey);
  win.addEventListener('resize', forwardResize);
  hooks.opened(win);
  forwardResize();

  win.addEventListener(
    'pagehide',
    () => {
      window.requestAnimationFrame = raf;
      window.cancelAnimationFrame = caf;
      home.insertBefore(app, placeholder);
      placeholder.remove();
      hooks.closed();
      // let layout settle in the main tab, then resize the canvases
      raf(() => window.dispatchEvent(new Event('resize')));
    },
    { once: true },
  );
  return true;
}
