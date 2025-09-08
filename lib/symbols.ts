// lib/symbols.ts
export type Exchange = 'binance' | 'mexc';
export type Market = 'spot' | 'futures';

export async function listSymbols(
  exchange: Exchange,
  quotes: string[] = ['USDT'],
  market: Market = 'spot'
): Promise<string[]> {
  const params = new URLSearchParams();
  params.set('exchange', exchange);
  params.set('market', market);
  const url = `/api/symbols?${params.toString()}`;

  try {
    const r = await fetch(url, { cache: 'no-store' });
    const d = await r.json();
    if (!r.ok || d?.error) throw new Error(d?.error || 'symbols failed');
    const want = new Set(quotes.map((q) => q.toUpperCase()));

    const arr: string[] = (Array.isArray(d?.symbols) ? d.symbols : [])
      .map((s: any) => String(s?.symbol ?? s ?? ''))
      .filter(Boolean)
      .filter((sym: string) => {
        const q = getQuote(sym);
        return !q || want.has(q); // if API already filtered to USDT, keep it; otherwise filter by chosen quotes
      });

    return uniq(arr).sort();
  } catch {
    return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT'];
  }
}

function getQuote(sym: string): string | null {
  const quotes = ['USDT', 'USDC', 'FDUSD', 'TUSD', 'BUSD'];
  for (const q of quotes) if (sym.endsWith(q)) return q;
  return null;
}

function uniq<T>(arr: T[]): T[] {
  const s = new Set<T>(); const out: T[] = [];
  for (const v of arr) if (!s.has(v)) { s.add(v); out.push(v); }
  return out;
}
