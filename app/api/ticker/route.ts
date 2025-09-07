// app/api/ticker/route.ts
import { NextResponse } from 'next/server';

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

    if (exchange === 'binance' && market === 'spot') {
      const d = await j(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
      return NextResponse.json({ price: Number(d.price) }, { headers: { 'cache-control':'no-store' } });
    }
    if (exchange === 'binance' && market === 'futures') {
      const d = await j(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`);
      return NextResponse.json({ price: Number(d.price) }, { headers: { 'cache-control':'no-store' } });
    }
    if (exchange === 'mexc' && market === 'spot') {
      const d = await j(`https://api.mexc.com/api/v3/ticker/price?symbol=${symbol}`);
      return NextResponse.json({ price: Number(d.price) }, { headers: { 'cache-control':'no-store' } });
    }
    if (exchange === 'mexc' && market === 'futures') {
      const all = await j(`https://contract.mexc.com/api/v1/contract/ticker`);
      const pair = symbol.replace('USDT','_USDT');
      const hit = (all?.data || []).find((t: any) => t.symbol === pair);
      if (!hit) return NextResponse.json({ error:'symbol not found' }, { status:404 });
      const price = Number(hit.fairPrice ?? hit.lastPrice ?? hit.indexPrice);
      return NextResponse.json({ price }, { headers: { 'cache-control':'no-store' } });
    }

    return NextResponse.json({ error:'bad params' }, { status:400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'failed' }, { status:500, headers:{ 'cache-control':'no-store' } });
  }
}
