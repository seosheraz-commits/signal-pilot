// lib/symbols.ts
export type Exchange = 'binance' | 'mexc';
export type Market = 'spot' | 'futures';

export async function listSymbols(
  exchange: Exchange,
  quotes: string[] = ['USDT'],
  market: Market = 'spot'
): Promise<string[]> {
  const qs = encodeURIComponent(quotes.join(','));
  const url = `/api/symbols?exchange=${exchange}&market=${market}&quotes=${qs}`;
  try {
    const r = await fetch(url, { cache: 'no-store' });
    const j = await r.json();
    if (Array.isArray(j?.symbols) && j.symbols.length) return j.symbols as string[];
    throw new Error('empty');
  } catch {
    return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT'];
  }
}
