// app/api/klines/route.ts
import { NextResponse } from "next/server";
import { isStdInterval, MEXC_FUTURES_MAP } from "../../../lib/interval";

export const runtime = "nodejs";
export const preferredRegion = "sin1";
export const revalidate = 0;
export const dynamic = "force-dynamic";

type Market = "spot" | "futures";
type Exchange = "binance" | "mexc";

// interval durations for closeTime
const DURATION_MS: Record<string, number> = {
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "6h": 21_600_000,
  "8h": 28_800_000,
  "12h": 43_200_000,
  "1d": 86_400_000,
  "3d": 259_200_000,
  "1w": 604_800_000,
};

async function j(url: string) {
  const r = await fetch(url, { cache: "no-store", headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const exchange = ((u.searchParams.get("exchange") || "binance").toLowerCase()) as Exchange;
    const market   = ((u.searchParams.get("market")   || "spot").toLowerCase()) as Market;
    const symbol   = (u.searchParams.get("symbol") || "BTCUSDT").toUpperCase();
    const interval = (u.searchParams.get("interval") || "5m").toLowerCase();
    const limit    = Math.min(parseInt(u.searchParams.get("limit") || "500", 10), 1500);

    if (!isStdInterval(interval)) {
      return NextResponse.json({ error: "invalid interval" }, { status: 400 });
    }

    const cacheHdr = { "cache-control": "no-store" };

    // BINANCE spot
    if (exchange === "binance" && market === "spot") {
      const raw = await j(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
      return NextResponse.json({ candles: raw }, { headers: cacheHdr });
    }

    // BINANCE futures
    if (exchange === "binance" && market === "futures") {
      const raw = await j(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
      return NextResponse.json({ candles: raw }, { headers: cacheHdr });
    }

    // MEXC spot
    if (exchange === "mexc" && market === "spot") {
      const raw = await j(`https://api.mexc.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
      // Already shaped like Binance
      return NextResponse.json({ candles: raw }, { headers: cacheHdr });
    }

    // MEXC futures
    if (exchange === "mexc" && market === "futures") {
      const pair = symbol.endsWith("USDT") ? symbol.replace("USDT", "_USDT") : symbol; // BTCUSDT -> BTC_USDT
      const iv = MEXC_FUTURES_MAP[interval as keyof typeof MEXC_FUTURES_MAP] || "Min1";

      // Primary endpoint (query params form)
      let data: any;
      try {
        const d = await j(`https://contract.mexc.com/api/v1/contract/kline?symbol=${pair}&interval=${iv}&limit=${limit}`);
        data = Array.isArray(d?.data) ? d.data : d;
      } catch {
        // Fallback (path param form)
        const d = await j(`https://contract.mexc.com/api/v1/contract/kline/${pair}?interval=${iv}&limit=${limit}`);
        data = Array.isArray(d?.data) ? d.data : d;
      }

      const ms = DURATION_MS[interval] ?? 60_000;
      const candles = (Array.isArray(data) ? data : []).map((c: any[]) => {
        // MEXC returns [time, open, high, low, close, volume] (time in ms)
        const t  = Number(c[0]);
        const o  = Number(c[1]);
        const h  = Number(c[2]);
        const l  = Number(c[3]);
        const cl = Number(c[4]);
        const v  = Number(c[5]);
        return [t, o, h, l, cl, v, t + ms, 0, 0, 0, 0, 0]; // Binance-shaped
      });

      return NextResponse.json({ candles }, { headers: cacheHdr });
    }

    return NextResponse.json({ error: "bad params" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "failed" },
      { status: 500, headers: { "cache-control": "no-store" } }
    );
  }
}
