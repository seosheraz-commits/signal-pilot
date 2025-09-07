// app/api/scan/route.ts
import { NextResponse } from 'next/server';
import { scanOnce } from '../../../src/engine'; // ← relative import

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const interval = (u.searchParams.get('interval') || '5m').toLowerCase();
    const marketQ = (u.searchParams.get('market') || 'spot').toLowerCase();
    const market: 'spot' | 'futures' | 'both' =
      marketQ === 'both' ? 'both' : marketQ === 'futures' ? 'futures' : 'spot';
    const lookback = Math.max(120, Math.min(parseInt(u.searchParams.get('lookback') || '150', 10), 200));
    const maxPerExchange = Math.max(24, Math.min(parseInt(u.searchParams.get('max') || '36', 10), 48));

    const out = await scanOnce({ market, interval, lookback, maxPerExchange });

    return NextResponse.json(
      {
        picks: (out?.picks || []).slice(0, 3),
        scanned: out?.universeCount ?? 0,
        interval: out?.interval ?? interval,
        market,
        engine: true,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 });
  }
}
