// app/api/symbols/route.ts
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type Market = 'spot' | 'futures';
type Exchange = 'binance' | 'mexc';

export interface SymbolInfo {
  exchange: Exchange;
  market: Market;
  symbol: string;  // e.g. BTCUSDT
  base: string;
  quote: string;   // USDT
  status: string;  // TRADING/ONLINE/...
}

async function getJson(url: string) {
  const r = await fetch(url, {
    cache: 'no-store',
    headers: { accept: 'application/json' },
    next: { revalidate: 0 },
  });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}

async function tryMany<T>(urls: string[]): Promise<T> {
  let lastErr: any;
  for (const u of urls) {
    try { return await getJson(u) as T; } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

/* ---------------- BINANCE (with fallbacks) ---------------- */
async function binanceSpot(): Promise<SymbolInfo[]> {
  const d = await tryMany<any>([
    'https://api.binance.com/api/v3/exchangeInfo',
    'https://api1.binance.com/api/v3/exchangeInfo',
    'https://api3.binance.com/api/v3/exchangeInfo',
    'https://data-api.binance.vision/api/v3/exchangeInfo',
  ]);
  return (d.symbols || [])
    .filter((s: any) => s.quoteAsset === 'USDT')
    .map((s: any) => ({
      exchange: 'binance' as const,
      market: 'spot' as const,
      symbol: s.symbol,
      base: s.baseAsset,
      quote: s.quoteAsset,
      status: s.status,
    }));
}

async function binanceFutures(): Promise<SymbolInfo[]> {
  const d = await tryMany<any>([
    'https://fapi.binance.com/fapi/v1/exchangeInfo',
    'https://data-api.binance.vision/fapi/v1/exchangeInfo',
  ]);
  return (d.symbols || [])
    .filter((s: any) => s.quoteAsset === 'USDT')
    .map((s: any) => ({
      exchange: 'binance' as const,
      market: 'futures' as const,
      symbol: s.symbol,
      base: s.baseAsset,
      quote: s.quoteAsset,
      status: s.status,
    }));
}

/* ---------------- MEXC (aggressive + resilient) ---------------- */
async function mexcSpot(): Promise<SymbolInfo[]> {
  const out = new Map<string, SymbolInfo>();

  try {
    const d = await getJson<any>('https://api.mexc.com/api/v3/exchangeInfo');
    for (const s of d?.symbols ?? []) {
      if (!s?.symbol) continue;
      const sym = String(s.symbol).toUpperCase();
      if (!sym.endsWith('USDT')) continue;
      const base = String(s.baseAsset ?? sym.replace(/USDT$/, '')).toUpperCase();
      out.set(sym, {
        exchange: 'mexc',
        market: 'spot',
        symbol: sym,
        base,
        quote: 'USDT',
        status: String(s.status ?? 'TRADING'),
      });
    }
  } catch {}

  try {
    const arr = await getJson<any[]>('https://api.mexc.com/api/v3/ticker/bookTicker');
    for (const t of arr ?? []) {
      const sym = String(t?.symbol ?? '').toUpperCase();
      if (!sym || !sym.endsWith('USDT')) continue;
      if (!out.has(sym)) {
        out.set(sym, {
          exchange: 'mexc',
          market: 'spot',
          symbol: sym,
          base: sym.replace(/USDT$/, ''),
          quote: 'USDT',
          status: 'TRADING',
        });
      }
    }
  } catch {}

  try {
    const arr = await getJson<any[]>('https://api.mexc.com/api/v3/ticker/price');
    for (const t of arr ?? []) {
      const sym = String(t?.symbol ?? '').toUpperCase();
      if (!sym || !sym.endsWith('USDT')) continue;
      if (!out.has(sym)) {
        out.set(sym, {
          exchange: 'mexc',
          market: 'spot',
          symbol: sym,
          base: sym.replace(/USDT$/, ''),
          quote: 'USDT',
          status: 'TRADING',
        });
      }
    }
  } catch {}

  return [...out.values()];
}

async function mexcFutures(): Promise<SymbolInfo[]> {
  const out = new Map<string, SymbolInfo>();

  try {
    const d = await getJson<any>('https://contract.mexc.com/api/v1/contract/detail');
    for (const s of d?.data ?? []) {
      const raw = String(s?.symbol ?? '');
      if (!raw.endsWith('_USDT')) continue;
      const sym = raw.replace('_', '');
      const base = sym.replace(/USDT$/, '');
      out.set(sym, {
        exchange: 'mexc',
        market: 'futures',
        symbol: sym,
        base,
        quote: 'USDT',
        status: String(s?.state ?? 'ONLINE'),
      });
    }
  } catch {}

  try {
    const d = await getJson<any>('https://contract.mexc.com/api/v1/contract/ticker');
    for (const x of d?.data ?? []) {
      const raw = String(x?.symbol ?? '');
      if (!raw.endsWith('_USDT')) continue;
      const sym = raw.replace('_', '');
      if (!out.has(sym)) {
        out.set(sym, {
          exchange: 'mexc',
          market: 'futures',
          symbol: sym,
          base: sym.replace(/USDT$/, ''),
          quote: 'USDT',
          status: 'ONLINE',
        });
      }
    }
  } catch {}

  return [...out.values()];
}

/* ---------------- ROUTE ---------------- */
export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const exRaw = (sp.get('exchange') || 'all').toLowerCase();
    const mkRaw = (sp.get('market') || 'all').toLowerCase();
    const exchange = (['binance', 'mexc', 'all'].includes(exRaw) ? exRaw : 'all') as 'binance'|'mexc'|'all';
    const market = (['spot', 'futures', 'all'].includes(mkRaw) ? mkRaw : 'all') as 'spot'|'futures'|'all';

    const want = (ex: Exchange, mk: Market) =>
      (exchange === 'all' || ex === exchange) && (market === 'all' || mk === market);

    const tasks: Promise<SymbolInfo[]>[] = [];
    if (want('binance', 'spot')) tasks.push(binanceSpot());
    if (want('binance', 'futures')) tasks.push(binanceFutures());
    if (want('mexc', 'spot')) tasks.push(mexcSpot());
    if (want('mexc', 'futures')) tasks.push(mexcFutures());

    const settled = await Promise.allSettled(tasks);
    const list = settled.flatMap(s => (s.status === 'fulfilled' ? s.value : []));

    const map = new Map<string, SymbolInfo>();
    for (const s of list) map.set(`${s.exchange}:${s.market}:${s.symbol}`, s);
    const symbols = [...map.values()].sort((a, b) =>
      a.exchange === b.exchange ? a.symbol.localeCompare(b.symbol) : a.exchange.localeCompare(b.exchange),
    );

    return NextResponse.json(
      { count: symbols.length, symbols },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 });
  }
}
