// app/api/ticker/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const ex = (u.searchParams.get('exchange') || 'binance').toLowerCase();
    const market = (u.searchParams.get('market') || 'spot').toLowerCase();
    const symbol = (u.searchParams.get('symbol') || 'BTCUSDT').toUpperCase();

    if (ex === 'binance') {
      const url = market === 'futures'
        ? `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`
        : `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`;
      const r = await fetch(url, { cache: 'no-store' });
      const j = await r.json();
      const price = Number(j?.price ?? j?.p ?? 0);
      return NextResponse.json({ price }, { headers: { 'cache-control':'no-store' }});
    }

    if (market === 'futures') {
      const pair = symbol.endsWith('USDT') ? symbol.replace('USDT','_USDT') : symbol;
      const r = await fetch('https://contract.mexc.com/api/v1/contract/ticker', { cache: 'no-store' });
      const j = await r.json();
      const row = (Array.isArray(j?.data) ? j.data : []).find((d: any) => String(d?.symbol) === pair);
      const price = Number(row?.lastPrice ?? row?.fairPrice ?? row?.indexPrice ?? 0);
      return NextResponse.json({ price }, { headers: { 'cache-control':'no-store' }});
    } else {
      const r = await fetch(`https://api.mexc.com/api/v3/ticker/price?symbol=${symbol}`, { cache:'no-store' });
      const j = await r.json();
      const price = Number(j?.price ?? 0);
      return NextResponse.json({ price }, { headers: { 'cache-control':'no-store' }});
    }
  } catch (e: any) {
    return NextResponse.json({ price: null, error: e?.message || 'failed' }, { status: 200 });
  }
}
