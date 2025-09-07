// app/api/scan/route.ts
import { NextResponse } from 'next/server';
import { scanOnce } from '../../../src/engine'; // from app/api/scan -> up 3 = '../../../src/engine'

export const runtime = 'nodejs';
export const preferredRegion = 'sin1';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const interval = (u.searchParams.get('interval') || '5m').toLowerCase();
    const market = (u.searchParams.get('market') || 'spot').toLowerCase() as 'spot' | 'futures' | 'both';
    const lookback = Math.max(120, Math.min(parseInt(u.searchParams.get('lookback') || '150', 10), 200));
    const maxPerExchange = Math.max(24, Math.min(parseInt(u.searchParams.get('max') || '36', 10), 48));

    const out = await scanOnce({ interval, lookback, maxPerExchange, market });
    return NextResponse.json(out, { headers: { 'cache-control': 'no-store' } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 });
  }
}
