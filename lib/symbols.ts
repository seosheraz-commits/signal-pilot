// lib/symbols.ts
export type Exchange = 'binance' | 'mexc';
export type Market = 'spot' | 'futures';

type SymbolInfo = {
  exchange: Exchange;
  market: Market;
  symbol: string;
  base: string;
  quote: string;
  status: string;
};

export async function listSymbols(exchange: Exchange, quotes: string[] = ['USDT'], market: Market = 'spot'): Promise<string[]> {
  const url = `/api/symbols?exchange=${encodeURIComponent(exchange)}&market=${encodeURIComponent(market)}`;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`symbols ${r.status}`);
  const d = await r.json();
  const list: SymbolInfo[] = Array.isArray(d?.symbols) ? d.symbols : [];
  const want = new Set(quotes.map(q => q.toUpperCase()));
  return list
    .filter(s => want.has((s.quote || '').toUpperCase()))
    .map(s => s.symbol)
    .sort();
}
