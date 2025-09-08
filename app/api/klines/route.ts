// app/api/klines/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MEXC_FUTURES_MAP: Record<string, string> = {
  '1m': 'Min1','3m': 'Min3','5m': 'Min5','15m': 'Min15','30m': 'Min30',
  '1h': 'Hour1','2h': 'Hour2','4h': 'Hour4','6h': 'Hour6','8h': 'Hour8','12h': 'Hour12',
  '1d': 'Day1','3d': 'Day3','1w': 'Week1',
};

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const ex = (u.searchParams.get('exchange') || 'binance').toLowerCase();
    const market = (u.searchParams.get('market') || 'spot').toLowerCase();
    const symbol = (u.searchParams.get('symbol') || 'BTCUSDT').toUpperCase();
    const interval = (u.searchParams.get('interval') || '5m');
    const limit = Math.min(1000, Math.max(50, parseInt(u.searchParams.get('limit')||'500',10)));

    // BINANCE
    if (ex === 'binance') {
      const url = market === 'futures'
        ? `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
        : `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      const r = await fetch(url, { cache: 'no-store', headers: { accept: 'application/json' }});
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const arr = await r.json();
      if (!Array.isArray(arr)) throw new Error('bad response');
      return NextResponse.json({ candles: arr }, { headers: { 'cache-control':'no-store' }});
    }

    // MEXC
    if (market === 'futures') {
      const pair = symbol.endsWith('USDT') ? symbol.replace('USDT','_USDT') : symbol;
      const iv = MEXC_FUTURES_MAP[interval] || 'Min1';

      const primary = `https://contract.mexc.com/api/v1/contract/kline?symbol=${pair}&interval=${iv}&limit=${limit}`;
      const alt     = `https://contract.mexc.com/api/v1/contract/kline/${pair}?interval=${iv}&limit=${limit}`;

      async function load(url: string) {
        const r = await fetch(url, { cache: 'no-store', headers: { accept:'application/json' }});
        const j = await r.json();
        const data = Array.isArray(j?.data) ? j.data : j;
        if (!Array.isArray(data)) return [];
        // MEXC futures kline shape: [t, o, h, l, c, v]
        return data.map((k: any) => [Number(k[0]), Number(k[1]), Number(k[2]), Number(k[3]), Number(k[4]), Number(k[5])]);
      }

      let candles = await load(primary);
      if (!candles.length) candles = await load(alt);

      if (!candles.length) throw new Error('no futures data');
      return NextResponse.json({ candles }, { headers: { 'cache-control':'no-store' }});
    } else {
      const url = `https://api.mexc.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      const r = await fetch(url, { cache: 'no-store', headers: { accept:'application/json' }});
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const arr = await r.json();
      if (!Array.isArray(arr)) throw new Error('bad response');
      return NextResponse.json({ candles: arr }, { headers: { 'cache-control':'no-store' }});
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 });
  }
}
