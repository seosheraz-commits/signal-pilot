// app/api/symbols/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function uniq<T>(arr: T[]): T[] { const s = new Set<T>(); const out: T[] = []; for (const v of arr) if (!s.has(v)) { s.add(v); out.push(v); } return out; }

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const ex = (u.searchParams.get('exchange') || 'binance').toLowerCase();
    const market = (u.searchParams.get('market') || 'spot').toLowerCase();
    const quotes = (u.searchParams.get('quotes') || 'USDT').split(',').map(s => s.toUpperCase());
    const want = new Set(quotes);

    if (ex === 'binance') {
      const url = market === 'futures'
        ? 'https://fapi.binance.com/fapi/v1/exchangeInfo'
        : 'https://api.binance.com/api/v3/exchangeInfo';
      const r = await fetch(url, { cache: 'no-store' });
      const j = await r.json();
      const list: string[] = (j.symbols || [])
        .filter((s: any) => s.status === 'TRADING' && want.has(String(s.quoteAsset).toUpperCase()))
        .map((s: any) => String(s.symbol).toUpperCase());
      return NextResponse.json({ symbols: uniq(list).sort() }, { headers: { 'cache-control':'no-store' }});
    }

    // MEXC
    if (market === 'spot') {
      try {
        const r = await fetch('https://api.mexc.com/api/v3/exchangeInfo', { cache: 'no-store' });
        const j = await r.json();
        const list: string[] = (j.symbols || [])
          .filter((s: any) => s.status === 'TRADING' && want.has(String(s.quoteAsset).toUpperCase()))
          .map((s: any) => String(s.symbol).toUpperCase());
        if (list.length) return NextResponse.json({ symbols: uniq(list).sort() }, { headers: { 'cache-control':'no-store' }});
      } catch {}
      // fallback to ticker set
      const t = await fetch('https://api.mexc.com/api/v3/ticker/24hr', { cache: 'no-store' }).then(r => r.json());
      const list2: string[] = (t || [])
        .map((d: any) => String(d.symbol).toUpperCase())
        .filter((sym: string) => !!quotes.find(q => sym.endsWith(q)));
      return NextResponse.json({ symbols: uniq(list2).sort() }, { headers: { 'cache-control':'no-store' }});
    } else {
      // futures: reuse spot list naming (same symbols)
      const t = await fetch('https://api.mexc.com/api/v3/ticker/24hr', { cache: 'no-store' }).then(r => r.json());
      const list2: string[] = (t || [])
        .map((d: any) => String(d.symbol).toUpperCase())
        .filter((sym: string) => !!quotes.find(q => sym.endsWith(q)));
      return NextResponse.json({ symbols: uniq(list2).sort() }, { headers: { 'cache-control':'no-store' }});
    }
  } catch (e: any) {
    // Safe fallback so UI never dies
    return NextResponse.json({ symbols: ['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','BNBUSDT'], error: e?.message || 'fallback' }, { status: 200 });
  }
}
