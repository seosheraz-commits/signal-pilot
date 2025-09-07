// lib/symbols.ts
export type Exchange = 'binance' | 'mexc';
export type Market = 'spot' | 'futures';

/**
 * Normalizes symbol list by exchange & quotes.
 * For MEXC futures we reuse spot list (reliable + compatible klines).
 */
export async function listSymbols(
  exchange: Exchange,
  quotes: string[] = ['USDT'],
  market: Market = 'spot'
): Promise<string[]> {
  const want = new Set(quotes.map(q => q.toUpperCase()));

  async function fetchJSON(url: string) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  }

  try {
    if (exchange === 'binance') {
      const url =
        market === 'futures'
          ? 'https://fapi.binance.com/fapi/v1/exchangeInfo'
          : 'https://api.binance.com/api/v3/exchangeInfo';
      const j = await fetchJSON(url);
      const list: string[] = (j.symbols || [])
        .filter((s: any) => s.status === 'TRADING' && want.has(String(s.quoteAsset).toUpperCase()))
        .map((s: any) => String(s.symbol).toUpperCase());
      return uniq(list).sort();
    }

    // MEXC: exchangeInfo is flaky on some networks; fallback to ticker/24hr.
    try {
      const j = await fetchJSON('https://api.mexc.com/api/v3/exchangeInfo');
      const list: string[] = (j.symbols || [])
        .filter((s: any) => s.status === 'TRADING' && want.has(String(s.quoteAsset).toUpperCase()))
        .map((s: any) => String(s.symbol).toUpperCase());
      if (list.length > 0) return uniq(list).sort();
    } catch { /* fallback below */ }

    const t = await fetchJSON('https://api.mexc.com/api/v3/ticker/24hr');
    const list2: string[] = (t || [])
      .map((d: any) => String(d.symbol).toUpperCase())
      .filter((sym: string) => {
        const q = getQuote(sym);
        return !!q && want.has(q);
      });
    return uniq(list2).sort();
  } catch {
    // worst-case fallback keeps UI usable
    return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT'];
  }
}

function getQuote(sym: string): string | null {
  const quotes = ['USDT','USDC','FDUSD','TUSD','BUSD'];
  for (const q of quotes) if (sym.endsWith(q)) return q;
  return null;
}

function uniq<T>(arr: T[]): T[] {
  const s = new Set<T>(); const out: T[] = [];
  for (const v of arr) if (!s.has(v)) { s.add(v); out.push(v); }
  return out;
}
