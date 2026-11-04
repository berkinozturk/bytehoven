export type FrameHost = Pick<Window, 'requestAnimationFrame' | 'cancelAnimationFrame'>;

/**
 * Route `home`'s requestAnimationFrame to `away` (the pop-out window), so every
 * render loop keeps running while the main tab may be hidden.
 * Returns a function that routes frames back to `home`. Frames still waiting in
 * `away` move back with it: a closed window never runs them, and every loop
 * (Pixi, Tone.Draw, the score) would otherwise stop for good.
 */
export function routeFrames(home: FrameHost, away: FrameHost): () => void {
  const raf = home.requestAnimationFrame;
  const caf = home.cancelAnimationFrame;
  const waiting = new Map<number, FrameRequestCallback>();
  let routed = true;
  home.requestAnimationFrame = (cb) => {
    const id = away.requestAnimationFrame((t) => {
      if (!routed) return; // already moved back home
      waiting.delete(id);
      cb(t);
    });
    waiting.set(id, cb);
    return id;
  };
  home.cancelAnimationFrame = (id) => {
    waiting.delete(id);
    away.cancelAnimationFrame(id);
  };
  return () => {
    routed = false;
    home.requestAnimationFrame = raf;
    home.cancelAnimationFrame = caf;
    for (const cb of waiting.values()) raf.call(home, cb);
    waiting.clear();
  };
}
