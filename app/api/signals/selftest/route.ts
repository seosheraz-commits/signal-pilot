// app/api/signals/selftest/route.ts
import { NextResponse } from 'next/server';
import { loadScanAll, loadSignalEngine, loadConfig, loadIndicators } from '@/lib/signals/wire';

export const runtime = 'nodejs';
export const preferredRegion = 'sin1';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const out: any = { ok: true, parts: {} };

    try { const scanAll = await loadScanAll(); out.parts.scanAll = typeof scanAll === 'function'; }
    catch (e: any) { out.parts.scanAll = false; out.scanAllErr = e?.message; }

    try { const engine = await loadSignalEngine(); out.parts.signalEngine = !!engine; }
    catch (e: any) { out.parts.signalEngine = false; out.signalEngineErr = e?.message; }

    try { const cfg = await loadConfig(); out.parts.config = !!cfg; }
    catch (e: any) { out.parts.config = false; out.configErr = e?.message; }

    try { const ind = await loadIndicators(); out.parts.indicators = Object.keys(ind).length > 0; }
    catch (e: any) { out.parts.indicators = false; out.indicatorsErr = e?.message; }

    return NextResponse.json(out, { headers: { 'cache-control': 'no-store' } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}
