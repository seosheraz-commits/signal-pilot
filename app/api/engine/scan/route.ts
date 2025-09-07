// app/api/engine/scan/route.ts
import { NextResponse } from 'next/server';
import { scanOnce } from '@/src/engine';

export const runtime = 'nodejs';
export const preferredRegion = 'sin1';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type PickOut = {
  exchange: 'binance' | 'mexc';
  market: 'spot' | 'futures';
  symbol: string;
  side: 'long' | 'short';
  confidencePercent: number;
  riskPercent: number;
  entry: number;
  stop: number;
  tp: number;
  reason: string;
};

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const interval = (u.searchParams.get('interval') || '5m').toLowerCase();
    const marketParam = (u.searchParams.get('market') || 'spot').toLowerCase();
    const market = (['spot', 'futures', 'both'].includes(marketParam) ? marketParam : 'spot') as 'spot' | 'futures' | 'both';
    const lookback = Math.max(120, Math.min(parseInt(u.searchParams.get('lookback') || '150', 10), 200));
    const maxPerExchange = Math.max(24, Math.min(parseInt(u.searchParams.get('max') || '36', 10), 48));

    const out = await scanOnce({ market, interval, lookback, maxPerExchange });

    const picks: PickOut[] = (Array.isArray((out as any)?.picks) ? (out as any).picks : [])
      .map((p: any) => {
        const ex = String(p?.exchange || '').toLowerCase();
        const exchange: 'binance' | 'mexc' = ex.includes('mexc') ? 'mexc' : 'binance';

        const mkRaw = String(p?.market || market).toLowerCase();
        const marketNorm: 'spot' | 'futures' = mkRaw.includes('fut') ? 'futures' : 'spot';

        const sideStr = String(p?.side || '').toLowerCase();
        const side: 'long' | 'short' | null = sideStr === 'short' ? 'short' : sideStr === 'long' ? 'long' : null;
        if (!side) return null;

        return {
          exchange,
          market: marketNorm,
          symbol: String(p.symbol || ''),
          side,
          confidencePercent: Number(p.confidencePercent ?? 60),
          riskPercent: Number(p.riskPercent ?? 2.5),
          entry: Number(p.entry ?? p.price ?? 0),
          stop: Number(p.stop ?? p.stopLoss ?? 0),
          tp: Number(p.takeProfit ?? p.tp ?? 0),
          reason: String(p.reasoning ?? p.reason ?? 'engine'),
        } as PickOut;
      })
      .filter(Boolean) as PickOut[];

    return NextResponse.json(
      {
        picks: picks.slice(0, 3),
        scanned: (out as any)?.universeCount ?? 0,
        interval: (out as any)?.interval ?? interval,
        market,
        engine: true,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 });
  }
}
