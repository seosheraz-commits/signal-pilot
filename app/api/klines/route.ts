// app/api/klines/route.ts
import { NextResponse } from 'next/server';
import { isStdInterval, MEXC_FUTURES_MAP } from '../../../lib/interval';

type Market = 'spot' | 'futures';
type Exchange = 'binance' | 'mexc';

async function j(url: string) {
  const r = await fetch(url, { cache: 'no-store', headers: { accept:'application/json' } });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const exchange = ((u.searchParams.get('exchange') || 'binance').toLowerCase()) as Exchange;
    const market   = ((u.searchParams.get('market') || 'spot').toLowerCase()) as Market;
    const symbol   = (u.searchParams.get('symbol') || 'BTCUSDT').toUpperCase();
    const interval = (u.searchParams.get('interval') || '5m').toLowerCase();
    const limit    = Math.min(parseInt(u.searchParams.get('limit') || '500', 10), 1500);

    if (!isStdInterval(interval)) return NextResponse.json({ error:'invalid interval' }, { status:400 });

    if (exchange === 'binance' && market === 'spot') {
      const raw = await j(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
      return NextResponse.json({ candles: raw }, { headers: { 'cache-control':'no-store' } });
    }
    if (exchange === 'binance' && market === 'futures') {
      const raw = await j(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
      return NextResponse.json({ candles: raw }, { headers: { 'cache-control':'no-store' } });
    }
    if (exchange === 'mexc' && market === 'spot') {
      const raw = await j(`https://api.mexc.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
      return NextResponse.json({ candles: raw }, { headers: { 'cache-control':'no-store' } });
    }
    if (exchange === 'mexc' && market === 'futures') {
      const pair = symbol.replace('USDT','_USDT');
      const iv = MEXC_FUTURES_MAP[interval as keyof typeof MEXC_FUTURES_MAP] || 'Min1';
      let raw: any;
      try {
        raw = await j(`https://contract.mexc.com/api/v1/contract/kline/${pair}?interval=${iv}&limit=${limit}`);
      } catch {
        raw = await j(`https://contract.mexc.com/api/v1/contract/kline?symbol=${pair}&interval=${iv}&limit=${limit}`);
      }
      const data = Array.isArray(raw?.data) ? raw.data : raw;
      const candles = data.map((c: any[]) => [
        c[0], c[1], c[2], c[3], c[4], c[5],
        c[0] + 60_000, 0, 0, 0, 0, 0
      ]);
      return NextResponse.json({ candles }, { headers: { 'cache-control':'no-store' } });
    }

    return NextResponse.json({ error:'bad params' }, { status:400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'failed' }, { status:500, headers:{ 'cache-control':'no-store' } });
  }
}
