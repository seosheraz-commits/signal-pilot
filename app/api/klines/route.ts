// app/api/klines/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** MEXC futures interval map */
const MEXC_FUTURES_MAP: Record<string, string> = {
  '1m': 'Min1',
  '3m': 'Min3',
  '5m': 'Min5',
  '15m': 'Min15',
  '30m': 'Min30',
  '1h': 'Hour1',
  '2h': 'Hour2',
  '4h': 'Hour4',
  '6h': 'Hour6',
  '8h': 'Hour8',
  '12h': 'Hour12',
  '1d': 'Day1',
  '3d': 'Day3',
  '1w': 'Week1',
  '1M': 'Month1',
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(n, max));
}

async function fetchJson(url: string, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      cache: 'no-store',
      signal: ctrl.signal,
      headers: { accept: 'application/json' },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(id);
  }
}

function toNum(x: any) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

/** Normalize to: [openTimeMs, open, high, low, close, volume] as numbers */
function normArrayKlines(arr: any[]): number[][] {
  const out: number[][] = [];
  for (const k of arr) {
    // Binance/MEXC spot format: [openTime, open, high, low, close, volume, closeTime, ...]
    const t = toNum(k[0]);
    const o = toNum(k[1]);
    const h = toNum(k[2]);
    const l = toNum(k[3]);
    const c = toNum(k[4]);
    const v = toNum(k[5]);
    if (t && (o || h || l || c)) out.push([t, o, h, l, c, v]);
  }
  return out;
}

/** Normalize MEXC futures data (contract API can return {data:[...]} or raw array) */
function normMexcFutures(data: any): number[][] {
  const arr: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  const out: number[][] = [];
  for (const k of arr) {
    // contract kline sometimes returns: [timeMs, open, high, low, close, volume, ...]
    const t = toNum(k[0]);
    const o = toNum(k[1]);
    const h = toNum(k[2]);
    const l = toNum(k[3]);
    const c = toNum(k[4]);
    const v = toNum(k[5]);
    if (t && (o || h || l || c)) out.push([t, o, h, l, c, v]);
  }
  return out;
}

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);

    const exchangeQ = (u.searchParams.get('exchange') || 'binance').toLowerCase();
    const marketQ = (u.searchParams.get('market') || 'spot').toLowerCase();
    const symbol = (u.searchParams.get('symbol') || 'BTCUSDT').toUpperCase();
    const interval = (u.searchParams.get('interval') || '5m').toLowerCase();
    const limit = clamp(parseInt(u.searchParams.get('limit') || '500', 10), 1, 1000);

    const exchange = exchangeQ === 'mexc' ? 'mexc' : 'binance';
    const market: 'spot' | 'futures' = marketQ === 'futures' ? 'futures' : 'spot';

    let candles: number[][] = [];
    let source = '';

    if (exchange === 'binance') {
      if (market === 'spot') {
        // Primary + fallback domain
        const urls = [
          `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
          `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
        ];
        for (const url of urls) {
          try {
            const data = await fetchJson(url, 9000);
            const norm = normArrayKlines(Array.isArray(data) ? data : []);
            if (norm.length) {
              candles = norm;
              source = url;
              break;
            }
          } catch {}
        }
      } else {
        const urls = [
          `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
        ];
        for (const url of urls) {
          try {
            const data = await fetchJson(url, 9000);
            const norm = normArrayKlines(Array.isArray(data) ? data : []);
            if (norm.length) {
              candles = norm;
              source = url;
              break;
            }
          } catch {}
        }
      }
    } else {
      // MEXC
      if (market === 'spot') {
        const urls = [
          `https://api.mexc.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
        ];
        for (const url of urls) {
          try {
            const data = await fetchJson(url, 9000);
            const norm = normArrayKlines(Array.isArray(data) ? data : []);
            if (norm.length) {
              candles = norm;
              source = url;
              break;
            }
          } catch {}
        }
      } else {
        // futures (contract API)
        const pair = symbol.endsWith('USDT') ? symbol.replace('USDT', '_USDT') : symbol;
        const iv = MEXC_FUTURES_MAP[interval] || 'Min1';
        const urls = [
          `https://contract.mexc.com/api/v1/contract/kline?symbol=${pair}&interval=${iv}&limit=${limit}`,
          `https://contract.mexc.com/api/v1/contract/kline/${pair}?interval=${iv}&limit=${limit}`,
        ];
        for (const url of urls) {
          try {
            const data = await fetchJson(url, 10000);
            const norm = normMexcFutures(data);
            if (norm.length) {
              candles = norm;
              source = url;
              break;
            }
          } catch {}
        }
      }
    }

    // If still empty, return a gentle error payload
    if (!candles.length) {
      return NextResponse.json(
        { error: 'no_candles', exchange, market, symbol, interval, candles: [], source },
        { status: 502, headers: { 'cache-control': 'no-store' } }
      );
    }

    // Ensure millisecond timestamps (most providers already are, but keep consistent)
    candles = candles.map(k => {
      const t = Number(k[0]);
      const ms = t < 2_000_000_000 ? t * 1000 : t; // if seconds, convert to ms
      return [ms, +k[1], +k[2], +k[3], +k[4], +k[5]];
    });

    return NextResponse.json(
      { exchange, market, symbol, interval, candles, source },
      { headers: { 'cache-control': 'no-store' } }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 });
  }
}
