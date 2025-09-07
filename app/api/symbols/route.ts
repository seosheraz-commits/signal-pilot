// app/api/symbols/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const preferredRegion = "sin1";
export const revalidate = 0;
export const dynamic = "force-dynamic"; // never cache; always fetch fresh

type Market = "spot" | "futures";
type Exchange = "binance" | "mexc";

export interface SymbolInfo {
  exchange: Exchange;
  market: Market;
  symbol: string;  // e.g. BTCUSDT
  base: string;
  quote: string;   // USDT
  status: string;  // TRADING/ONLINE/...
}

async function get<T>(url: string) {
  const r = await fetch(url, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json() as Promise<T>;
}

/* ---------------- BINANCE ---------------- */
async function binanceSpot(): Promise<SymbolInfo[]> {
  const d = await get<any>("https://api.binance.com/api/v3/exchangeInfo");
  return (d.symbols || [])
    .filter((s: any) => s?.quoteAsset === "USDT")
    .map((s: any) => ({
      exchange: "binance" as const,
      market: "spot" as const,
      symbol: String(s.symbol),
      base: String(s.baseAsset),
      quote: "USDT",
      status: String(s.status || "TRADING"),
    }));
}

async function binanceFutures(): Promise<SymbolInfo[]> {
  const d = await get<any>("https://fapi.binance.com/fapi/v1/exchangeInfo");
  return (d.symbols || [])
    .filter((s: any) => s?.quoteAsset === "USDT" && String(s?.contractType || "") === "PERPETUAL")
    .map((s: any) => ({
      exchange: "binance" as const,
      market: "futures" as const,
      symbol: String(s.symbol),
      base: String(s.baseAsset),
      quote: "USDT",
      status: String(s.status || "TRADING"),
    }));
}

/* ---------------- MEXC (aggressive + resilient) ----------------
   Union multiple endpoints and de-dup to avoid truncated lists.
-----------------------------------------------------------------*/

// MEXC SPOT sources (on api.mexc.com):
// 1) /api/v3/exchangeInfo
// 2) /api/v3/ticker/bookTicker
// 3) /api/v3/ticker/price
async function mexcSpot(): Promise<SymbolInfo[]> {
  const out = new Map<string, SymbolInfo>();

  // 1) exchangeInfo (structure similar to Binance)
  try {
    const d = await get<any>("https://api.mexc.com/api/v3/exchangeInfo");
    for (const s of d?.symbols ?? []) {
      const sym = String(s?.symbol || "").toUpperCase();
      if (!sym || !sym.endsWith("USDT")) continue;
      const base = String(s?.baseAsset || sym.replace(/USDT$/, "")).toUpperCase();
      out.set(sym, {
        exchange: "mexc",
        market: "spot",
        symbol: sym,
        base,
        quote: "USDT",
        status: String(s?.status || "TRADING"),
      });
    }
  } catch { /* ignore */ }

  // 2) bookTicker (usually complete)
  try {
    const arr = await get<any[]>("https://api.mexc.com/api/v3/ticker/bookTicker");
    for (const t of arr ?? []) {
      const sym = String(t?.symbol || "").toUpperCase();
      if (!sym || !sym.endsWith("USDT")) continue;
      if (!out.has(sym)) {
        out.set(sym, {
          exchange: "mexc",
          market: "spot",
          symbol: sym,
          base: sym.replace(/USDT$/, ""),
          quote: "USDT",
          status: "TRADING",
        });
      }
    }
  } catch { /* ignore */ }

  // 3) price list (fallback)
  try {
    const arr = await get<any[]>("https://api.mexc.com/api/v3/ticker/price");
    for (const t of arr ?? []) {
      const sym = String(t?.symbol || "").toUpperCase();
      if (!sym || !sym.endsWith("USDT")) continue;
      if (!out.has(sym)) {
        out.set(sym, {
          exchange: "mexc",
          market: "spot",
          symbol: sym,
          base: sym.replace(/USDT$/, ""),
          quote: "USDT",
          status: "TRADING",
        });
      }
    }
  } catch { /* ignore */ }

  return [...out.values()];
}

// MEXC FUTURES sources (contract API):
// 1) /api/v1/contract/detail
// 2) /api/v1/contract/ticker
async function mexcFutures(): Promise<SymbolInfo[]> {
  const out = new Map<string, SymbolInfo>();

  // 1) detail
  try {
    const d = await get<any>("https://contract.mexc.com/api/v1/contract/detail");
    for (const s of d?.data ?? []) {
      const raw = String(s?.symbol || "");
      if (!raw.endsWith("_USDT")) continue;
      const sym = raw.replace("_", ""); // BTC_USDT -> BTCUSDT
      const base = sym.replace(/USDT$/, "");
      out.set(sym, {
        exchange: "mexc",
        market: "futures",
        symbol: sym,
        base,
        quote: "USDT",
        status: String(s?.state || "ONLINE"),
      });
    }
  } catch { /* ignore */ }

  // 2) ticker (huge list; reliable)
  try {
    const d = await get<any>("https://contract.mexc.com/api/v1/contract/ticker");
    for (const x of d?.data ?? []) {
      const raw = String(x?.symbol || "");
      if (!raw.endsWith("_USDT")) continue;
      const sym = raw.replace("_", "");
      if (!out.has(sym)) {
        out.set(sym, {
          exchange: "mexc",
          market: "futures",
          symbol: sym,
          base: sym.replace(/USDT$/, ""),
          quote: "USDT",
          status: "ONLINE",
        });
      }
    }
  } catch { /* ignore */ }

  return [...out.values()];
}

/* ---------------- ROUTE ---------------- */
export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const exRaw = (sp.get("exchange") || "all").toLowerCase();
    const mkRaw = (sp.get("market") || "all").toLowerCase();

    const exchange = (["binance", "mexc", "all"].includes(exRaw) ? exRaw : "all") as
      | "binance"
      | "mexc"
      | "all";
    const market = (["spot", "futures", "all"].includes(mkRaw) ? mkRaw : "all") as
      | "spot"
      | "futures"
      | "all";

    const need = (ex: Exchange, mk: Market) =>
      (exchange === "all" || ex === exchange) && (market === "all" || mk === market);

    const tasks: Promise<SymbolInfo[]>[] = [];
    if (need("binance", "spot")) tasks.push(binanceSpot());
    if (need("binance", "futures")) tasks.push(binanceFutures());
    if (need("mexc", "spot")) tasks.push(mexcSpot());
    if (need("mexc", "futures")) tasks.push(mexcFutures());

    const settled = await Promise.allSettled(tasks);
    const list = settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));

    // De-dup + keep USDT only
    const map = new Map<string, SymbolInfo>();
    for (const s of list) {
      if (s.quote !== "USDT") continue;
      map.set(`${s.exchange}:${s.market}:${s.symbol}`, s);
    }

    const symbols = [...map.values()].sort((a, b) => {
      if (a.exchange !== b.exchange) return a.exchange.localeCompare(b.exchange);
      if (a.market !== b.market) return a.market.localeCompare(b.market);
      return a.symbol.localeCompare(b.symbol);
    });

    return NextResponse.json(
      { count: symbols.length, symbols },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}
