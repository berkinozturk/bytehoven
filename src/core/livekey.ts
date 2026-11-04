/**
 * The key that unlocks live mode (see server/live/hub.ts). It arrives once in the
 * link printed in your terminal (`?k=…`); the page keeps it in this browser and
 * takes it out of the address bar, so it doesn't end up in screenshots or history.
 */

const STORE = 'bytehoven.key';

function read(): string | null {
  const url = new URL(location.href);
  const k = url.searchParams.get('k');
  if (k) {
    try {
      localStorage.setItem(STORE, k);
    } catch {
      /* private mode: the key lasts for this page */
    }
    url.searchParams.delete('k');
    history.replaceState(history.state, '', url.pathname + url.search.replace(/=(?=&|$)/g, '') + url.hash); // keep `?live`, not `?live=`
    return k;
  }
  try {
    return localStorage.getItem(STORE);
  } catch {
    return null;
  }
}

export const LIVE_KEY = read();

/** Headers for the page's live requests. */
export const keyed = (h: Record<string, string> = {}): Record<string, string> => (LIVE_KEY ? { ...h, 'x-bytehoven-key': LIVE_KEY } : h);
