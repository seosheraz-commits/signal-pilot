// app/api/klines/route.ts
import { NextResponse } from 'next/server';
import { isStdInterval, MEXC_FUTURES_MAP } from '@/lib/interval';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Exchange = 'binance' | 'mexc';
type Market = 'spot' | 'futures';

async function j(url: string, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { cache: 'no-store', signal: ctrl.signal, headers: { accept:'application/json' } });
    if (!r.ok) throw new Error(`${url} ${r.status}`);
    return r.json();
  } finally { clearTimeout(t); }
}

// normalize to [t,o,h,l,c,v]
function norm(arr: any[]): number[][] {
  const out: number[][] = [];
  for (const k of arr || []) {
    const t = Number(k[0]), o = Number(k[1]), h = Number(k[2]), l = Number(k[3]), c = Number(k[4]), v = Number(k[5]);
    if (t && (o || h || l || c)) out.push([t,o,h,l,c,v]);
  }
  return out;
}

// some MEXC spot intervals are picky; try alternates for “h” buckets
const MEXC_SPOT_ALT: Record<string, string[]> = {
  '1h': ['1h','60m'],
  '2h': ['2h','120m'],
  '6h': ['6h','360m'],
  '8h': ['8h','480m'],
  '12h': ['12h','720m'],
};

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const exchange = (u.searchParams.get('exchange') || 'binance').toLowerCase() as Exchange;
    const market   = (u.searchParams.get('market')   || 'spot').toLowerCase() as Market;
    const symbol   = (u.searchParams.get('symbol')   || 'BTCUSDT').toUpperCase();
    const interval = (u.searchParams.get('interval') || '5m').toLowerCase();
    const limit    = Math.max(50, Math.min(parseInt(u.searchParams.get('limit') || '500',10), 1000));

    if (!isStdInterval(interval)) return NextResponse.json({ error: 'bad interval' }, { status: 400 });

    if (exchange === 'binance') {
      const base = market === 'futures' ? 'https://fapi.binance.com' : 'https://api.binance.com';
      const url = `${base}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`.replace('/api/v3/', market==='futures' ? '/fapi/v1/' : '/api/v3/');
      const arr = await j(url, 10000);
      return NextResponse.json(norm(Array.isArray(arr) ? arr : []), { headers: { 'cache-control': 'no-store' } });
    }

    // MEXC
    if (market === 'spot') {
      // try interval, then alternates for 1h/2h/etc
      const tries = MEXC_SPOT_ALT[interval] ? MEXC_SPOT_ALT[interval] : [interval];
      for (const iv of tries) {
        try {
          const url = `https://api.mexc.com/api/v3/klines?symbol=${symbol}&interval=${iv}&limit=${limit}`;
          const arr = await j(url, 10000);
          const out = norm(Array.isArray(arr) ? arr : []);
          if (out.length) return NextResponse.json(out, { headers: { 'cache-control': 'no-store' } });
        } catch {}
      }
      return NextResponse.json([], { headers: { 'cache-control': 'no-store' } });
    } else {
      // futures: contract API needs BTC_USDT + mapped interval code (Min5/Hour1/etc)
      const pair = symbol.endsWith('USDT') ? symbol.replace('USDT', '_USDT') : symbol;
      const ivCode = MEXC_FUTURES_MAP[interval as keyof typeof MEXC_FUTURES_MAP] || 'Min1';
      const urls = [
        `https://contract.mexc.com/api/v1/contract/kline?symbol=${pair}&interval=${ivCode}&limit=${limit}`,
        `https://contract.mexc.com/api/v1/contract/kline/${pair}?interval=${ivCode}&limit=${limit}`,
      ];
      for (const url of urls) {
        try {
          const d = await j(url, 12000);
          const src: any[] = Array.isArray(d?.data) ? d.data : Array.isArray(d) ? d : [];
          const out: number[][] = [];
          for (const k of src) {
            const t = Number(k[0]), o = Number(k[1]), h = Number(k[2]), l = Number(k[3]), c = Number(k[4]), v = Number(k[5]);
            if (t && (o || h || l || c)) out.push([t,o,h,l,c,v]);
          }
          if (out.length) return NextResponse.json(out, { headers: { 'cache-control': 'no-store' } });
        } catch {}
      }
      return NextResponse.json([], { headers: { 'cache-control': 'no-store' } });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'failed' }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}
