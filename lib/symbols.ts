// lib/symbols.ts
export type Exchange = 'binance' | 'mexc';
export type Market = 'spot' | 'futures';

/**
 * Robust symbol listing for BINANCE + MEXC with graceful fallbacks.
 * - Handles spot & futures
 * - Supports quote filters (USDT, USDC, FDUSD, TUSD, etc.)
 * - Uses multiple endpoints/mirrors to avoid regional/CORS hiccups
 */

const KNOWN_QUOTES = ['USDT', 'USDC', 'FDUSD', 'TUSD', 'BUSD'] as const;
type KnownQuote = typeof KNOWN_QUOTES[number];

function getQuote(sym: string): KnownQuote | null {
  const up = sym.toUpperCase();
  for (const q of KNOWN_QUOTES) if (up.endsWith(q)) return q;
  return null;
}

function uniq<T>(arr: T[]): T[] {
  const s = new Set<T>(); const out: T[] = [];
  for (const v of arr) if (!s.has(v)) { s.add(v); out.push(v); }
  return out;
}

async function getJSON(url: string) {
  const r = await fetch(url, { cache: 'no-store', headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

async function tryMany<T = any>(urls: string[]): Promise<T> {
  let lastErr: any;
  for (const u of urls) {
    try { return await getJSON(u); } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('all endpoints failed');
}

/* ---------------- BINANCE ---------------- */
async function binanceSymbols(quotes: string[], market: Market): Promise<string[]> {
  const want = new Set(quotes.map(q => q.toUpperCase()));
  // Primary + mirrors
  const urls =
    market === 'futures'
      ? [
          'https://fapi.binance.com/fapi/v1/exchangeInfo',
          'https://data-api.binance.vision/fapi/v1/exchangeInfo',
        ]
      : [
          'https://api.binance.com/api/v3/exchangeInfo',
          'https://data-api.binance.vision/api/v3/exchangeInfo',
        ];

  try {
    const d: any = await tryMany(urls);
    const list: string[] = (d?.symbols || [])
      .filter((s: any) => String(s?.status).toUpperCase() === 'TRADING')
      .filter((s: any) => want.has(String(s?.quoteAsset).toUpperCase()))
      .map((s: any) => String(s?.symbol).toUpperCase());
    if (list.length) return uniq(list).sort();
  } catch { /* fallbacks below */ }

  // Fallback: ticker lists
  const tickUrls =
    market === 'futures'
      ? [
          'https://fapi.binance.com/fapi/v1/ticker/24hr',
          'https://data-api.binance.vision/fapi/v1/ticker/24hr',
        ]
      : [
          'https://api.binance.com/api/v3/ticker/24hr',
          'https://data-api.binance.vision/api/v3/ticker/24hr',
        ];
  try {
    const arr: any[] = await tryMany(tickUrls);
    const syms = arr
      .map(x => String(x?.symbol || '').toUpperCase())
      .filter(s => {
        const q = getQuote(s);
        return !!q && want.has(q);
      });
    if (syms.length) return uniq(syms).sort();
  } catch { /* ignore */ }

  // Worst case keep UI usable
  return ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];
}

/* ---------------- MEXC ---------------- */
async function mexcSymbols(quotes: string[], market: Market): Promise<string[]> {
  const want = new Set(quotes.map(q => q.toUpperCase()));
  if (market === 'spot') {
    // Try exchangeInfo → ticker/24hr
    try {
      const d: any = await getJSON('https://api.mexc.com/api/v3/exchangeInfo');
      const list: string[] = (d?.symbols || [])
        .filter((s: any) => String(s?.status).toUpperCase() === 'TRADING')
        .map((s: any) => String(s?.symbol || '').toUpperCase())
        .filter((sym) => {
          const q = getQuote(sym);
          return !!q && want.has(q);
        });
      if (list.length) return uniq(list).sort();
    } catch { /* fallback below */ }

    try {
      const arr: any[] = await getJSON('https://api.mexc.com/api/v3/ticker/24hr');
      const list2 = arr
        .map((d: any) => String(d?.symbol || '').toUpperCase())
        .filter((sym: string) => {
          const q = getQuote(sym);
          return !!q && want.has(q);
        });
      if (list2.length) return uniq(list2).sort();
    } catch { /* ignore */ }

    return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT'];
  }

  // Futures: contract API uses BTC_USDT etc. Normalize to BTCUSDT.
  try {
    const d: any = await getJSON('https://contract.mexc.com/api/v1/contract/detail');
    const list: string[] = (d?.data || [])
      .map((x: any) => String(x?.symbol || '').toUpperCase()) // BTC_USDT
      .filter((raw: string) => raw.endsWith('_USDT') || raw.endsWith('_USDC') || raw.endsWith('_FDUSD') || raw.endsWith('_TUSD'))
      .map((raw: string) => raw.replace('_', '')) // BTCUSDT
      .filter((sym: string) => {
        const q = getQuote(sym);
        return !!q && want.has(q!);
      });
    if (list.length) return uniq(list).sort();
  } catch { /* fallback below */ }

  try {
    const d: any = await getJSON('https://contract.mexc.com/api/v1/contract/ticker');
    const list: string[] = (d?.data || [])
      .map((t: any) => String(t?.symbol || '').toUpperCase())
      .filter((raw: string) => raw.endsWith('_USDT') || raw.endsWith('_USDC') || raw.endsWith('_FDUSD') || raw.endsWith('_TUSD'))
      .map((raw: string) => raw.replace('_', ''))
      .filter((sym: string) => {
        const q = getQuote(sym);
        return !!q && want.has(q!);
      });
    if (list.length) return uniq(list).sort();
  } catch { /* ignore */ }

  return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT'];
}

/* ---------------- PUBLIC API ---------------- */
export async function listSymbols(
  exchange: Exchange,
  quotes: string[] = ['USDT'],
  market: Market = 'spot'
): Promise<string[]> {
  try {
    if (exchange === 'binance') return await binanceSymbols(quotes, market);
    return await mexcSymbols(quotes, market);
  } catch {
    // ultra fallback to keep UI alive
    return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT'];
  }
}
