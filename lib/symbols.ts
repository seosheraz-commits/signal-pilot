// lib/symbols.ts
export type Exchange = 'binance' | 'mexc';
export type Market = 'spot' | 'futures';

/**
 * Fetch symbols via our server route /api/symbols to avoid CORS, partial data,
 * and to get a unioned, de-duplicated list per exchange+market.
 */
export async function listSymbols(
  exchange: Exchange,
  quotes: string[] = ['USDT'],
  market: Market = 'spot'
): Promise<string[]> {
  const qex = encodeURIComponent(exchange);
  const qmk = encodeURIComponent(market);
  const res = await fetch(`/api/symbols?exchange=${qex}&market=${qmk}`, { cache: 'no-store' });

  if (!res.ok) throw new Error(`symbols ${res.status}`);
  const data = await res.json();

  const want = new Set(quotes.map(q => q.toUpperCase()));
  const list: string[] = (data?.symbols || [])
    .filter((s: any) => s && String(s.exchange).toLowerCase() === exchange && String(s.market).toLowerCase() === market)
    .filter((s: any) => want.has(String(s.quote || '').toUpperCase()))
    .map((s: any) => String(s.symbol).toUpperCase());

  // Fallback in the absolute worst case.
  if (!list.length) return ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT'];
  return uniq(list).sort();
}

function uniq<T>(arr: T[]): T[] {
  const s = new Set<T>(), out: T[] = [];
  for (const v of arr) if (!s.has(v)) { s.add(v); out.push(v); }
  return out;
}
