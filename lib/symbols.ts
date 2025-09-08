// lib/symbols.ts
export type Exchange = 'binance' | 'mexc';
export type Market = 'spot' | 'futures';

/**
 * ALWAYS ask our own /api/symbols so we avoid browser CORS and get full lists.
 * Server route already merges/fixes MEXC + Binance quirks.
 */
export async function listSymbols(
  exchange: Exchange,
  quotes: string[] = ['USDT'],
  market: Market = 'spot'
): Promise<string[]> {
  try {
    const params = new URLSearchParams({
      exchange,
      market,
    });
    const r = await fetch(`/api/symbols?${params.toString()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    const want = new Set(quotes.map(q => q.toUpperCase()));
    const list: string[] = (j.symbols || [])
      .filter((s: any) => want.has(String(s.quote || 'USDT').toUpperCase()))
      .map((s: any) => String(s.symbol).toUpperCase());
    return uniq(list).sort();
  } catch {
    // fallback keeps the UI alive
    return ['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','BNBUSDT'];
  }
}

function uniq<T>(arr: T[]): T[] {
  const s = new Set<T>(); const out: T[] = [];
  for (const v of arr) if (!s.has(v)) { s.add(v); out.push(v); }
  return out;
}
