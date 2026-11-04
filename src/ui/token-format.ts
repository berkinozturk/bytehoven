/** 950 → "950", 12 345 → "12.3k", 4 560 000 → "4.56M". No imports, so the tests run it directly. */
export function short(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1e6) return `${trim((n / 1e3).toFixed(n < 1e4 ? 2 : 1))}k`;
  return `${trim((n / 1e6).toFixed(n < 1e7 ? 2 : 1))}M`;
}

const trim = (s: string) => (s.includes('.') ? s.replace(/\.?0+$/, '') : s);
