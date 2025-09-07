// app/api/top-signals/route.ts
import { NextResponse } from "next/server";
import { isStdInterval } from "../../../lib/interval";

export const runtime = "nodejs";
export const preferredRegion = "sin1";
export const revalidate = 0;
export const dynamic = "force-dynamic";

type Mode = "strong" | "balanced" | "wide" | "all";
type Market = "spot" | "futures" | "both";
type Exchange = "binance" | "mexc" | "both";

interface Pick {
  exchange: "binance" | "mexc";
  market: "spot" | "futures";
  symbol: string;
  side: "long" | "short";
  confidencePercent: number;
  riskPercent: number;
  entry: number;
  stop: number;
  tp: number;
  reason: string;
}

async function j<T = any>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store", headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json() as Promise<T>;
}

function ema(vals: number[], p: number) {
  const k = 2 / (p + 1);
  const out: number[] = [];
  let prev = vals[0] ?? 0;
  for (let i = 0; i < vals.length; i++) {
    prev = i === 0 ? vals[i] : vals[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function rsi(vals: number[], period = 14) {
  let g = 0, l = 0;
  const out = new Array(vals.length).fill(NaN);
  for (let i = 1; i <= period; i++) {
    const d = vals[i] - vals[i - 1];
    if (d >= 0) g += d;
    else l -= d;
  }
  let ag = g / period, al = l / period;
  out[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = period + 1; i < vals.length; i++) {
    const d = vals[i] - vals[i - 1];
    const G = Math.max(d, 0), L = Math.max(-d, 0);
    ag = (ag * (period - 1) + G) / period;
    al = (al * (period - 1) + L) / period;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}

function atr(h: number[], l: number[], c: number[], period = 14) {
  const tr: number[] = [];
  for (let i = 0; i < c.length; i++) {
    if (i === 0) tr.push(h[i] - l[i]);
    else tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  }
  const out: number[] = [];
  let prev = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < tr.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

function grade(candles: any[]) {
  const close = candles.map((x: any) => +x[4]);
  const high = candles.map((x: any) => +x[2]);
  const low = candles.map((x: any) => +x[3]);
  if (close.length < 60) return null;

  const e20 = ema(close, 20);
  const e50 = ema(close, 50);
  const r14 = rsi(close, 14);
  const a14 = atr(high, low, close, 14);

  const n = close.length - 1;
  const c = close[n], v20 = e20[n], v50 = e50[n], r = r14[n], a = a14[n] || 0;

  let side: "long" | "short" | undefined;
  if (c > v20 && v20 > v50 && r >= 55) side = "long";
  if (c < v20 && v20 < v50 && r <= 45) side = "short";
  if (!side) return null;

  const trend = Math.min(Math.abs(v20 - v50) / (a || 1e-9), 3);
  const rsiedge = side === "long" ? (r - 50) / 30 : (50 - r) / 30;
  const mom = Math.min(Math.abs(c - v20) / (a || 1e-9), 3);

  const conf = Math.round(Math.max(0, Math.min(100, trend * 22 + rsiedge * 40 + mom * 18 + 20)));
  const risk = Math.max(0.2, Math.min(3.5, (a / c) * 100));
  const stop = side === "long" ? c - 1.8 * a : c + 1.8 * a;
  const tp = side === "long" ? c + 2.6 * a : c - 2.6 * a;
  const reason = side === "long"
    ? `Uptrend: price>EMA20>EMA50, RSI ${r.toFixed(1)}, ATR ${a.toFixed(4)}`
    : `Downtrend: price<EMA20<EMA50, RSI ${r.toFixed(1)}, ATR ${a.toFixed(4)}`;

  return { side, conf, risk: +risk.toFixed(2), entry: c, stop, tp, reason };
}

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const mode = (u.searchParams.get("mode") || "strong").toLowerCase() as Mode;
    const exchange = (u.searchParams.get("exchange") || "both").toLowerCase() as Exchange;
    const market = (u.searchParams.get("market") || "both").toLowerCase() as Market;
    const interval = (u.searchParams.get("interval") || "5m").toLowerCase();
    const cap = Math.min(parseInt(u.searchParams.get("cap") || "400", 10), 800);

    if (!isStdInterval(interval)) {
      return NextResponse.json({ error: "invalid interval" }, { status: 400 });
    }

    // Discover universe from your own symbols endpoint
    const sym = new URL(req.url);
    sym.pathname = "/api/symbols";
    sym.search = "";
    sym.searchParams.set("exchange", exchange === "both" ? "all" : exchange);
    sym.searchParams.set("market", market === "both" ? "all" : market);

    const { symbols } = await j<{ symbols: any[] }>(sym.toString());
    const universe = (symbols || [])
      .filter((s: any) => s.quote === "USDT" && String(s.status || "").toUpperCase() !== "OFFLINE")
      .slice(0, cap);

    const minConf = mode === "strong" ? 75 : mode === "balanced" ? 65 : mode === "wide" ? 55 : 0;

    const picks: Pick[] = [];
    const batch = 24;

    for (let i = 0; i < universe.length; i += batch) {
      const chunk = universe.slice(i, i + batch);
      await Promise.all(
        chunk.map(async (s: any) => {
          try {
            const k = new URL(req.url);
            k.pathname = "/api/klines";
            k.search = "";
            k.searchParams.set("exchange", s.exchange);
            k.searchParams.set("market", s.market);
            k.searchParams.set("symbol", s.symbol);
            k.searchParams.set("interval", interval);
            k.searchParams.set("limit", "300"); // use 300 like your scanner spec

            const { candles } = await j<{ candles: any[] }>(k.toString());
            if (!Array.isArray(candles) || candles.length < 60) return;

            const g = grade(candles);
            if (!g || g.conf < minConf) return;

            picks.push({
              exchange: s.exchange,
              market: s.market,
              symbol: s.symbol,
              side: g.side,
              confidencePercent: g.conf,
              riskPercent: g.risk,
              entry: +g.entry.toFixed(6),
              stop: +g.stop.toFixed(6),
              tp: +g.tp.toFixed(6),
              reason: g.reason
            });
          } catch {
            // ignore single symbol fetch errors
          }
        })
      );
      if (mode === "strong" && picks.length >= 3) break;
    }

    picks.sort((a, b) => b.confidencePercent - a.confidencePercent);
    return NextResponse.json(
      { picks: picks.slice(0, 3), scanned: universe.length, mode, interval },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}
