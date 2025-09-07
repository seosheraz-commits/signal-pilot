// app/api/ticker/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const preferredRegion = "sin1";
export const revalidate = 0;
export const dynamic = "force-dynamic";

type Market = "spot" | "futures";
type Exchange = "binance" | "mexc";

async function j(url: string) {
  const r = await fetch(url, { cache: "no-store", headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}

function pairMexcFutures(symbol: string) {
  return symbol.endsWith("USDT") ? symbol.replace("USDT", "_USDT") : symbol; // BTCUSDT -> BTC_USDT
}

function ok(price: number, exchange: Exchange, market: Market, symbol: string, source: string) {
  return NextResponse.json(
    { price: Number(price), exchange, market, symbol, ts: Date.now(), source },
    { headers: { "cache-control": "no-store" } }
  );
}

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const exchange = ((u.searchParams.get("exchange") || "binance").toLowerCase()) as Exchange;
    const market   = ((u.searchParams.get("market")   || "spot").toLowerCase()) as Market;
    const symbol   = (u.searchParams.get("symbol") || "BTCUSDT").toUpperCase();

    let price: number | null = null;
    let source = "";

    // --- 1) Native ticker endpoints (fast) ---
    try {
      if (exchange === "binance" && market === "spot") {
        const d = await j(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
        price = Number(d?.price); source = "binance spot ticker";
      } else if (exchange === "binance" && market === "futures") {
        const d = await j(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`);
        price = Number(d?.price); source = "binance futures ticker";
      } else if (exchange === "mexc" && market === "spot") {
        const d = await j(`https://api.mexc.com/api/v3/ticker/price?symbol=${symbol}`);
        price = Number(d?.price); source = "mexc spot ticker";
      } else if (exchange === "mexc" && market === "futures") {
        const pair = pairMexcFutures(symbol);
        // Try symbol-specific first (faster)
        try {
          const d = await j(`https://contract.mexc.com/api/v1/contract/ticker?symbol=${pair}`);
          const data = Array.isArray(d?.data) ? d.data[0] : d?.data;
          const p = Number(data?.lastPrice ?? data?.fairPrice ?? data?.indexPrice);
          if (Number.isFinite(p)) { price = p; source = "mexc futures ticker"; }
        } catch {
          // Fallback to all tickers and filter (slower)
          const all = await j(`https://contract.mexc.com/api/v1/contract/ticker`);
          const hit = (all?.data || []).find((t: any) => t?.symbol === pair);
          const p = Number(hit?.lastPrice ?? hit?.fairPrice ?? hit?.indexPrice);
          if (Number.isFinite(p)) { price = p; source = "mexc futures ticker (list)"; }
        }
      }
    } catch {
      // swallow and fallback to klines
    }

    // --- 2) Fallback: our own klines (1 bar) ---
    if (!(price && Number.isFinite(price))) {
      try {
        const k = new URL(req.url);
        k.pathname = "/api/klines";
        k.search = "";
        k.searchParams.set("exchange", exchange);
        k.searchParams.set("market", market);
        k.searchParams.set("symbol", symbol);
        k.searchParams.set("interval", "1m");
        k.searchParams.set("limit", "1");
        const kd = await j(k.toString());
        const candles = kd?.candles;
        if (Array.isArray(candles) && candles.length) {
          const p = Number(candles[candles.length - 1][4]);
          if (Number.isFinite(p)) {
            price = p;
            source = (source ? source + " + " : "") + "klines fallback";
          }
        }
      } catch {
        // ignore
      }
    }

    if (!(price && Number.isFinite(price))) {
      return NextResponse.json({ error: "no price", exchange, market, symbol }, { status: 502 });
    }
    return ok(price, exchange, market, symbol, source);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "failed" },
      { status: 500, headers: { "cache-control": "no-store" } }
    );
  }
}
