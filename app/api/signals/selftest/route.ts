// app/api/signals/selftest/route.ts
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  return NextResponse.json({
    ok: true,
    disabled: true,
    note: 'Legacy signals selftest has been disabled. Use /api/engine/scan or /api/top-signals instead.',
  });
}
