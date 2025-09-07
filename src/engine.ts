// src/engine.ts
// Fast scanner for BINANCE + MEXC across SPOT and FUTURES (USDT pairs)
// Uses timeouts, small concurrency, and graceful fallbacks.

import { MEXC_FUTURES_MAP } from '@/lib/interval';

export type Market = 'spot' | 'futures';
export type ExchangeID = 'BINANCE' | 'MEXC';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const last = <T>(arr: T[]) => arr[arr.length - 1];

// —— time-bounded fetch
async function fetchJson(url: string, timeoutMs = 7000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { cache: 'no-store', signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

/* ---------------- TA utils ---------------- */
function ema(values: number[], period: number) {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0] ?? 0;
  for (let i = 0; i < values.length; i++) {
    const v = Number(values[i]);
    if (i === 0) out.push(prev);
    else {
      const next = v * k + prev * (1 - k);
      out.push(next);
      prev = next;
    }
  }
  return out;
}

function rsi(closes: number[], period = 14) {
  if (closes.length < period + 2) return Array(closes.length).fill(null) as (number | null)[];
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  let rs = avgLoss === 0 ? 100 : avgGain / (avgLoss || 1e-12);

  const out: (number | null)[] = Array(period).fill(null);
  out.push(100 - 100 / (1 + rs));

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = Math.max(diff, 0);
    const loss = Math.max(-diff, 0);
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rs = avgLoss === 0 ? 100 : avgGain / (avgLoss || 1e-12);
    out.push(100 - 100 / (1 + rs));
  }
  while (out.length < closes.length) out.unshift(null);
  return out;
}

function atr(highs: number[], lows: number[], closes: number[], period = 14) {
  const trs: number[] = [];
  for (let i = 0; i < highs.length; i++) {
    if (i === 0) trs.push(highs[i] - lows[i]);
    else {
      const hl = highs[i] - lows[i];
      const hc = Math.abs(highs[i] - closes[i - 1]);
      const lc = Math.abs(lows[i] - closes[i - 1]);
      trs.push(Math.max(hl, hc, lc));
    }
  }
  const out: (number | null)[] = Array(highs.length).fill(null);
  let prevATR = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prevATR;
  for (let i = period; i < trs.length; i++) {
    prevATR = (prevATR * (period - 1) + trs[i]) / period;
    out[i] = prevATR;
  }
  return out;
}

function vwap(highs: number[], lows: number[], closes: number[], volumes: number[], period = 30) {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  let cumPV = 0, cumV = 0;
  const tp = (i: number) => (highs[i] + lows[i] + closes[i]) / 3;
  for (let i = 0; i < closes.length; i++) {
    const price = tp(i);
    const vol = volumes[i];
    cumPV += price * vol;
    cumV += vol;
    out[i] = cumV > 0 ? cumPV / cumV : null;
    if ((i + 1) % period === 0) { cumPV = 0; cumV = 0; }
  }
  return out;
}

function macd(closes: number[], fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const line = closes.map((_, i) => emaFast[i] - emaSlow[i]);
  const sigBase = ema(line.slice(slow - 1), signal);
  while (sigBase.length < line.length) sigBase.unshift(null as unknown as number);
  const hist = line.map((v, i) => v - (sigBase[i] ?? 0));
  return { line, signal: sigBase, hist };
}

/* ---------------- Exchanges & endpoints ---------------- */
const BINANCE = {
  id: 'BINANCE' as const,
  spot: {
    klines: (symbol: string, interval: string, limit: number) =>
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
    tickers: `https://api.binance.com/api/v3/ticker/24hr`,
  },
  futures: {
    klines: (symbol: string, interval: string, limit: number) =>
      `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
    tickers: `https://fapi.binance.com/fapi/v1/ticker/24hr`,
  }
};

const MEXC = {
  id: 'MEXC' as const,
  spot: {
    klines: (symbol: string, interval: string, limit: number) =>
      `https://api.mexc.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
    tickers: `https://api.mexc.com/api/v3/ticker/24hr`,
  },
  futures: {
    // Klines require BTC_USDT + Min5/Hour1 etc; we map symbol & interval later.
    klines: (pairUnderscore: string, ivCode: string, limit: number) =>
      `https://contract.mexc.com/api/v1/contract/kline?symbol=${pairUnderscore}&interval=${ivCode}&limit=${limit}`,
    altKlines: (pairUnderscore: string, ivCode: string, limit: number) =>
      `https://contract.mexc.com/api/v1/contract/kline/${pairUnderscore}?interval=${ivCode}&limit=${limit}`,
    tickers: `https://contract.mexc.com/api/v1/contract/ticker`,
  }
};

function isUsdtSym(sym: string) {
  // Exclude leveraged tokens patterns on spot; for futures this is typically fine as-is
  return sym.endsWith('USDT') && !sym.includes('UP') && !sym.includes('DOWN') && !sym.includes('BULL') && !sym.includes('BEAR');
}

type Ticker = { symbol: string; lastPrice: number; quoteVolume: number };

async function getTickers(ex: typeof BINANCE | typeof MEXC, market: Market): Promise<Ticker[]> {
  try {
    if (ex.id === 'BINANCE') {
      const url = market === 'spot' ? ex.spot.tickers : ex.futures.tickers;
      const arr = await fetchJson(url, 7000) as any[];
      return arr.map(d => ({
        symbol: String(d.symbol),
        lastPrice: Number(d.lastPrice ?? d.c ?? d.last ?? 0),
        quoteVolume: Number(d.quoteVolume ?? d.q ?? d.volume ?? 0),
      }));
    } else {
      if (market === 'spot') {
        const arr = await fetchJson(ex.spot.tickers, 7000) as any[];
        return arr.map(d => ({
          symbol: String(d.symbol),
          lastPrice: Number(d.lastPrice ?? d.c ?? d.last ?? 0),
          quoteVolume: Number(d.quoteVolume ?? d.q ?? d.volume ?? 0),
        }));
      }
      // futures: contract ticker returns { data: [...] } with symbol: 'BTC_USDT'
      const d = await fetchJson(ex.futures.tickers, 8000) as any;
      const arr = Array.isArray(d?.data) ? d.data : [];
      return arr.map((t: any) => {
        const raw = String(t?.symbol || '');              // BTC_USDT
        const sym = raw.endsWith('_USDT') ? raw.replace('_', '') : raw; // BTCUSDT
        const price = Number(t?.lastPrice ?? t?.fairPrice ?? t?.indexPrice ?? 0);
        const qv = Number(t?.turnover24h ?? t?.turnover ?? t?.amount24h ?? t?.quoteVolume ?? t?.volume ?? 0);
        return { symbol: sym, lastPrice: price, quoteVolume: qv };
      });
    }
  } catch {
    return [];
  }
}

async function getKlines(
  ex: typeof BINANCE | typeof MEXC,
  market: Market,
  symbol: string,
  interval: string,
  limit: number
) {
  if (ex.id === 'BINANCE') {
    const url = market === 'spot'
      ? ex.spot.klines(symbol, interval, limit)
      : ex.futures.klines(symbol, interval, limit);
    const raw = await fetchJson(url, 7000) as any[];
    const o: number[] = [], h: number[] = [], l: number[] = [], c: number[] = [], v: number[] = [], t: number[] = [];
    for (const k of raw) {
      o.push(Number(k[1])); h.push(Number(k[2])); l.push(Number(k[3])); c.push(Number(k[4])); v.push(Number(k[5])); t.push(Number(k[0]));
    }
    return { o, h, l, c, v, t };
  }

  // MEXC
  if (market === 'spot') {
    const raw = await fetchJson(ex.spot.klines(symbol, interval, limit), 7000) as any[];
    const o: number[] = [], h: number[] = [], l: number[] = [], c: number[] = [], v: number[] = [], t: number[] = [];
    for (const k of raw) {
      o.push(Number(k[1])); h.push(Number(k[2])); l.push(Number(k[3])); c.push(Number(k[4])); v.push(Number(k[5])); t.push(Number(k[0]));
    }
    return { o, h, l, c, v, t };
  } else {
    // futures
    const pair = symbol.endsWith('USDT') ? symbol.replace('USDT', '_USDT') : symbol;
    const iv = (MEXC_FUTURES_MAP as any)[interval] || 'Min1';
    let data: any;
    try {
      const d = await fetchJson(ex.futures.klines(pair, iv, limit), 8000);
      data = Array.isArray(d?.data) ? d.data : d;
    } catch {
      const d = await fetchJson(ex.futures.altKlines(pair, iv, limit), 8000);
      data = Array.isArray(d?.data) ? d.data : d;
    }
    const o: number[] = [], h: number[] = [], l: number[] = [], c: number[] = [], v: number[] = [], t: number[] = [];
    for (const k of (Array.isArray(data) ? data : [])) {
      t.push(Number(k[0])); o.push(Number(k[1])); h.push(Number(k[2])); l.push(Number(k[3])); c.push(Number(k[4])); v.push(Number(k[5]));
    }
    return { o, h, l, c, v, t };
  }
}

function topUsdtFrom(ticks: Ticker[], limit: number) {
  return ticks
    .filter(t => isUsdtSym(t.symbol))
    .sort((a, b) => b.quoteVolume - a.quoteVolume)
    .slice(0, limit)
    .map(t => t.symbol);
}

async function buildUniverse(market: Market, maxPerExchange = 36) {
  const [bt, mt] = await Promise.all([getTickers(BINANCE, market), getTickers(MEXC, market)]);
  const bSet = new Set(bt.filter(t => isUsdtSym(t.symbol)).map(t => t.symbol));
  const mSet = new Set(mt.filter(t => isUsdtSym(t.symbol)).map(t => t.symbol));
  const common = [...bSet].filter(s => mSet.has(s));

  if (common.length > 0) {
    const volMap = new Map<string, number>();
    for (const t of bt) if (bSet.has(t.symbol)) volMap.set(t.symbol, (volMap.get(t.symbol) ?? 0) + (t.quoteVolume || 0));
    for (const t of mt) if (mSet.has(t.symbol)) volMap.set(t.symbol, (volMap.get(t.symbol) ?? 0) + (t.quoteVolume || 0));
    return common
      .map(s => ({ s, v: volMap.get(s) ?? 0 }))
      .sort((a, b) => b.v - a.v)
      .slice(0, maxPerExchange)
      .map(x => x.s);
  }

  // no intersection available, fallback to whichever responded
  if (bt.length) return topUsdtFrom(bt, maxPerExchange);
  if (mt.length) return topUsdtFrom(mt, maxPerExchange);
  return [];
}

type EvalOut = {
  exchange: ExchangeID;
  market: Market;
  symbol: string;
  side: 'LONG' | 'SHORT' | 'NEUTRAL';
  confidencePercent: number;
  riskPercent: number;
  price: number;
  entry: number;
  stop: number;
  takeProfit: number;
  meta: { quoteVolume?: number; atrPct: number; rsi: number; macdHist: number };
  reasoning: string;
};

function evaluateSymbol(args: {
  exchange: typeof BINANCE | typeof MEXC;
  market: Market;
  symbol: string;
  series: { o: number[]; h: number[]; l: number[]; c: number[]; v: number[]; t: number[] };
  meta: { quoteVolume?: number };
}): EvalOut | null {
  const { exchange, market, symbol, series, meta } = args;
  const { h, l, c, v } = series;
  const price = last(c);
  const ema20 = ema(c, 20);
  const ema50 = ema(c, 50);
  const r = rsi(c, 14);
  const a = atr(h, l, c, 14);
  const vw = vwap(h, l, c, v, 30);
  const m = macd(c, 12, 26, 9);

  const ema20v = last(ema20);
  const ema50v = last(ema50);
  const rsiv = (last(r) ?? 50) as number;
  const atrv = (last(a) ?? 0) as number;
  const vwapv = (last(vw) ?? price) as number;
  const macdHist = (last(m.hist) ?? 0) as number;

  const minPrice = 0.005;
  const minVolUSD = 1_500_000;
  if (price < minPrice) return null;
  if ((meta.quoteVolume || 0) < minVolUSD) return null;

  const trendLong = price > ema20v && ema20v > ema50v;
  const trendShort = price < ema20v && ema20v < ema50v;
  const momLong = rsiv > 55 && macdHist > 0;
  const momShort = rsiv < 45 && macdHist < 0;
  const vwapLong = price > vwapv;
  const vwapShort = price < vwapv;

  let dir: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
  if (Number(trendLong) + Number(momLong) + Number(vwapLong) >= 2) dir = 'LONG';
  else if (Number(trendShort) + Number(momShort) + Number(vwapShort) >= 2) dir = 'SHORT';
  if (dir === 'NEUTRAL') return null;

  const sTrend = 0.35 * Number(trendLong || trendShort);
  const sMom = 0.35 * Number(momLong || momShort);
  const vwapDist = Math.abs(price - vwapv) / price;
  const sVwap = vwapDist < 0.008 ? 0.15 : vwapDist < 0.015 ? 0.10 : 0.04;

  const atrPct = atrv / price;
  const volScore = 1 - Math.max(0, Math.min(1, (atrPct - 0.002) / (0.03 - 0.002)));
  const sVol = 0.15 * Math.max(0, Math.min(1, volScore));

  let raw = sTrend + sMom + sVwap + sVol;

  const liq = Math.log10((meta.quoteVolume || 1) + 1) / 8;
  raw *= 0.8 + 0.2 * Math.max(0.5, Math.min(1, liq));

  const confidencePercent = Math.round(100 * Math.max(0, Math.min(1, raw)));
  const riskBase = Math.min(0.4, Math.max(0.06, atrPct * 2.2));
  const riskPercent = Math.round(100 * riskBase);

  const atrMultSL = 1.4;
  const atrMultTP = 1.2;
  const entry = price;
  const stop = dir === 'LONG' ? Math.max(0, price - atrv * atrMultSL) : price + atrv * atrMultSL;
  const takeProfit = dir === 'LONG' ? price + atrv * atrMultTP : Math.max(0, price - atrv * atrMultTP);

  const reasoning = [
    trendLong ? 'EMA20 above EMA50 and price above EMAs' : 'EMA20 below EMA50 and price below EMAs',
    momLong ? 'RSI and MACD momentum up' : 'RSI and MACD momentum down',
    vwapLong ? 'Holding above VWAP' : 'Trading below VWAP',
    `ATR ${(atrPct * 100).toFixed(2)}% gives risk estimate`
  ].join(' | ');

  return {
    exchange: exchange.id,
    market,
    symbol,
    side: dir,
    confidencePercent,
    riskPercent,
    price: Number(price.toFixed(8)),
    entry: Number(entry.toFixed(8)),
    stop: Number(stop.toFixed(8)),
    takeProfit: Number(takeProfit.toFixed(8)),
    meta: {
      quoteVolume: (meta as any).quoteVolume,
      atrPct: Number((atrPct * 100).toFixed(2)),
      rsi: Number((rsiv || 0).toFixed(2)),
      macdHist: Number((macdHist || 0).toFixed(6)),
    },
    reasoning
  };
}

// small concurrency pool
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const ret: R[] = new Array(items.length) as any;
  let i = 0;
  const workers = Array(Math.min(limit, items.length)).fill(0).map(async () => {
    for (;;) {
      const idx = i++;
      if (idx >= items.length) return;
      ret[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return ret;
}

async function buildTickerMaps(market: Market) {
  const [bt, mt] = await Promise.all([getTickers(BINANCE, market), getTickers(MEXC, market)]);
  const bMap = new Map(bt.map(t => [t.symbol, t]));
  const mMap = new Map(mt.map(t => [t.symbol, t]));
  return { BINANCE: bMap, MEXC: mMap } as const;
}

async function evaluateBoth(symbol: string, market: Market, interval: string, limit: number, tmap: Awaited<ReturnType<typeof buildTickerMaps>>) {
  const out: ReturnType<typeof evaluateSymbol>[] = [];
  for (const ex of [BINANCE, MEXC] as const) {
    try {
      const series = await getKlines(ex, market, symbol, interval, limit);
      const meta = (ex.id === 'BINANCE' ? tmap.BINANCE : tmap.MEXC).get(symbol) || {};
      const res = evaluateSymbol({ exchange: ex, market, symbol, series, meta });
      if (res && res.side !== 'NEUTRAL') out.push(res);
      await sleep(40);
    } catch {
      // ignore per-exchange error for this symbol
    }
  }
  return out.filter(Boolean) as EvalOut[];
}

async function scanMarket(market: Market, opts?: { interval?: string; lookback?: number; maxPerExchange?: number }) {
  const interval = opts?.interval ?? '5m';
  const lookback = Math.max(120, Math.min(opts?.lookback ?? 150, 200));
  const maxPerExchange = Math.max(24, Math.min(opts?.maxPerExchange ?? 36, 48));

  const [universe, tmap] = await Promise.all([buildUniverse(market, maxPerExchange), buildTickerMaps(market)]);
  const evaluated = await mapPool(universe, 4, async (sym) => evaluateBoth(sym, market, interval, lookback, tmap));
  const all = evaluated.flat();

  all.sort((a, b) => b.confidencePercent - a.confidencePercent || a.riskPercent - b.riskPercent);
  return { universe, candidates: all };
}

export async function scanOnce(opts?: { market?: Market | 'both'; interval?: string; lookback?: number; maxPerExchange?: number }) {
  const market = (opts?.market ?? 'spot') as Market | 'both';

  if (market === 'both') {
    const [spot, fut] = await Promise.all([scanMarket('spot', opts), scanMarket('futures', opts)]);
    const combined = [...spot.candidates, ...fut.candidates];
    combined.sort((a, b) => b.confidencePercent - a.confidencePercent || a.riskPercent - b.riskPercent);
    const picks = combined.slice(0, 3);
    return {
      ranAt: new Date().toISOString(),
      interval: opts?.interval ?? '5m',
      lookback: Math.max(120, Math.min(opts?.lookback ?? 150, 200)),
      universeCount: (spot.universe?.length ?? 0) + (fut.universe?.length ?? 0),
      candidatesCount: combined.length,
      picks: picks.length ? picks : [{ side: 'WAIT', note: 'No qualified opportunities by current gates' }],
    };
  }

  const { universe, candidates } = await scanMarket(market as Market, opts);
  const picks = candidates.slice(0, 3);
  return {
    ranAt: new Date().toISOString(),
    interval: opts?.interval ?? '5m',
    lookback: Math.max(120, Math.min(opts?.lookback ?? 150, 200)),
    universeCount: universe.length,
    candidatesCount: candidates.length,
    picks: picks.length ? picks : [{ side: 'WAIT', note: 'No qualified opportunities by current gates' }],
  };
}
