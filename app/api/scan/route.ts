// app/api/scan/route.ts
import { NextResponse } from 'next/server';
import { scanOnce } from '../../../src/engine';

// Force Node runtime and avoid cache
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const interval = searchParams.get('interval') || '1m';
  const lookback = Number(searchParams.get('lookback') ?? 150);
  const maxPerExchange = Number(searchParams.get('maxPerExchange') ?? 36);

  try {
    const result = await scanOnce({
      interval,
      lookback: Math.min(200, Math.max(120, lookback)),
      maxPerExchange: Math.min(48, Math.max(24, maxPerExchange)),
    });
    return NextResponse.json(result, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
