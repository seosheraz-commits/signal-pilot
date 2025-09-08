// lib/symbols.ts
export type Exchange = 'binance' | 'mexc';
export type Market = 'spot' | 'futures';

/**
 * Get symbols via our server route (/api/symbols) to avoid browser CORS.
 * Filters by desired quote currencies on the client.
 */
export async function listSymbols(
  exchange: Exchange,
  quotes: string[] = ['USDT'],
  market: Market = 'spot'
): Promise<string[]> {
  const want = new Set(quotes.map(q => q.toUpperCase()));

  const qs = new URLSearchParams();
  qs.set('exchange', exchange);
  qs.set('market', market);

  try {
    const r = await fetch(`/api/symbols?${qs.toString()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    const j: any = await r.json();

    // our /api/symbols returns { count, symbols: [{ exchange, market, symbol, base, quote, status }, ...] }
    if (Array.isArray(j?.symbols)) {
      const list = j.symbols
        .filter((s: any) => {
          const q = String(s?.quote ?? '').toUpperCase();
          return q && want.has(q);
        })
        .map((s: any) => String(s.symbol).toUpperCase());

      return uniq(list).sort();
    }
  } catch {
    // fall through to defaults
  }

  // last resort so UI stays usable
  return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT'];
}

function uniq<T>(arr: T[]): T[] {
  const s = new Set<T>();
  const out: T[] = [];
  for (const v of arr) if (!s.has(v)) { s.add(v); out.push(v); }
  return out;
}
