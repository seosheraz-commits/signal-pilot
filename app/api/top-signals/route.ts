// app/api/top-signals/route.ts
import { NextResponse } from 'next/server';
import { isStdInterval, MEXC_FUTURES_MAP } from '@/lib/interval';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Market = 'spot' | 'futures' | 'both';
type Exchange = 'binance' | 'mexc' | 'both';

interface Pick {
  exchange: 'binance'|'mexc';
  market: 'spot'|'futures';
  symbol: string;
  side: 'long'|'short';
  confidencePercent: number;
  riskPercent: number;
  entry: number;
  stop: number;
  tp: number;
  reason: string;
}

function clamp(n: number, a: number, b: number) { return Math.max(a, Math.min(b, n)); }

async function j(url: string, timeoutMs = 9000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { cache:'no-store', signal: ctrl.signal, headers: { accept:'application/json' } });
    if (!r.ok) throw new Error(`${url} ${r.status}`);
    return r.json();
  } finally { clearTimeout(t); }
}

/* ---------------- TA utils ---------------- */
function ema(vals: number[], p: number) {
  const k = 2 / (p + 1);
  const out: number[] = [];
  let prev = vals[0] ?? 0;
  for (let i=0;i<vals.length;i++) {
    prev = i === 0 ? vals[i] : vals[i]*k + prev*(1-k);
    out.push(prev);
  }
  return out;
}
function rsi(vals: number[], period = 14) {
  if (vals.length < period + 2) return new Array(vals.length).fill(NaN);
  let g = 0, l = 0;
  for (let i=1;i<=period;i++) {
    const d = vals[i]-vals[i-1];
    if (d>=0) g+=d; else l-=d;
  }
  let ag=g/period, al=l/period;
  const out: number[] = Array(period).fill(NaN);
  out.push(al===0 ? 100 : 100 - 100/(1+ag/(al||1e-12)));
  for (let i=period+1;i<vals.length;i++) {
    const d = vals[i]-vals[i-1];
    const G = Math.max(d,0), L = Math.max(-d,0);
    ag = (ag*(period-1)+G)/period;
    al = (al*(period-1)+L)/period;
    out.push(al===0 ? 100 : 100 - 100/(1+ag/(al||1e-12)));
  }
  while (out.length < vals.length) out.unshift(NaN);
  return out;
}
function atr(h: number[], l: number[], c: number[], period=14) {
  const tr: number[] = [];
  for (let i=0;i<c.length;i++) {
    if (i===0) tr.push(h[i]-l[i]);
    else tr.push(Math.max(h[i]-l[i], Math.abs(h[i]-c[i-1]), Math.abs(l[i]-c[i-1])));
  }
  const out: number[] = Array(c.length).fill(NaN);
  let prev = tr.slice(0,period).reduce((a,b)=>a+b,0)/period;
  out[period-1]=prev;
  for (let i=period;i<tr.length;i++) {
    prev = (prev*(period-1)+tr[i])/period;
    out[i]=prev;
  }
  return out;
}

/* ---------------- SYMBOL DISCOVERY (no internal /api calls) ---------------- */
type SymbolInfo = { exchange: 'binance'|'mexc'; market: 'spot'|'futures'; symbol: string; base: string; quote: string; status: string };

async function binanceSpot(): Promise<SymbolInfo[]> {
  const d = await j('https://api.binance.com/api/v3/exchangeInfo');
  return (d.symbols || [])
    .filter((s: any) => s.quoteAsset === 'USDT' && s.status === 'TRADING')
    .map((s: any) => ({ exchange:'binance', market:'spot', symbol:s.symbol, base:s.baseAsset, quote:s.quoteAsset, status:s.status }));
}
async function binanceFutures(): Promise<SymbolInfo[]> {
  const d = await j('https://fapi.binance.com/fapi/v1/exchangeInfo');
  return (d.symbols || [])
    .filter((s: any) => s.quoteAsset === 'USDT' && s.status === 'TRADING')
    .map((s: any) => ({ exchange:'binance', market:'futures', symbol:s.symbol, base:s.baseAsset, quote:s.quoteAsset, status:s.status }));
}
async function mexcSpot(): Promise<SymbolInfo[]> {
  const out = new Map<string, SymbolInfo>();
  try {
    const d = await j('https://api.mexc.com/api/v3/exchangeInfo');
    for (const s of d?.symbols ?? []) {
      const sym = String(s?.symbol || '').toUpperCase();
      if (!sym.endsWith('USDT')) continue;
      out.set(sym, { exchange:'mexc', market:'spot', symbol:sym, base:String(s.baseAsset||'').toUpperCase(), quote:'USDT', status:String(s.status||'TRADING') });
    }
  } catch {}
  try {
    const arr = await j('https://api.mexc.com/api/v3/ticker/bookTicker');
    for (const t of arr ?? []) {
      const sym = String(t?.symbol||'').toUpperCase();
      if (!sym.endsWith('USDT') || out.has(sym)) continue;
      out.set(sym, { exchange:'mexc', market:'spot', symbol:sym, base:sym.replace(/USDT$/,''), quote:'USDT', status:'TRADING' });
    }
  } catch {}
  try {
    const arr = await j('https://api.mexc.com/api/v3/ticker/price');
    for (const t of arr ?? []) {
      const sym = String(t?.symbol||'').toUpperCase();
      if (!sym.endsWith('USDT') || out.has(sym)) continue;
      out.set(sym, { exchange:'mexc', market:'spot', symbol:sym, base:sym.replace(/USDT$/,''), quote:'USDT', status:'TRADING' });
    }
  } catch {}
  return [...out.values()];
}
async function mexcFutures(): Promise<SymbolInfo[]> {
  const out = new Map<string, SymbolInfo>();
  try {
    const d = await j('https://contract.mexc.com/api/v1/contract/detail');
    for (const s of d?.data ?? []) {
      const raw = String(s?.symbol||''); if (!raw.endsWith('_USDT')) continue;
      const sym = raw.replace('_','');
      out.set(sym, { exchange:'mexc', market:'futures', symbol:sym, base:sym.replace(/USDT$/,''), quote:'USDT', status:String(s?.state||'ONLINE') });
    }
  } catch {}
  try {
    const d = await j('https://contract.mexc.com/api/v1/contract/ticker');
    for (const x of d?.data ?? []) {
      const raw = String(x?.symbol||''); if (!raw.endsWith('_USDT')) continue;
      const sym = raw.replace('_','');
      if (!out.has(sym)) out.set(sym, { exchange:'mexc', market:'futures', symbol:sym, base:sym.replace(/USDT$/,''), quote:'USDT', status:'ONLINE' });
    }
  } catch {}
  return [...out.values()];
}

/* ---------------- KLINES (direct to exchanges; no internal /api) ---------------- */
async function fetchKlines(s: SymbolInfo, interval: string): Promise<number[][]> {
  const lim = 200;
  const norm = (arr: any[]): number[][] => {
    const out: number[][] = [];
    for (const k of arr) {
      const t = Number(k[0]), o = Number(k[1]), h = Number(k[2]), l = Number(k[3]), c = Number(k[4]), v = Number(k[5]);
      if (t && (o||h||l||c)) out.push([t, o, h, l, c, v]);
    }
    return out;
  };

  if (s.exchange === 'binance') {
    if (s.market === 'spot') {
      const urls = [
        `https://api.binance.com/api/v3/klines?symbol=${s.symbol}&interval=${interval}&limit=${lim}`,
        `https://data-api.binance.vision/api/v3/klines?symbol=${s.symbol}&interval=${interval}&limit=${lim}`,
      ];
      for (const u of urls) {
        try { const d = await j(u, 9000); const arr = norm(Array.isArray(d) ? d : []); if (arr.length) return arr; } catch {}
      }
    } else {
      const u = `https://fapi.binance.com/fapi/v1/klines?symbol=${s.symbol}&interval=${interval}&limit=${lim}`;
      const d = await j(u, 9000); return norm(Array.isArray(d) ? d : []);
    }
  } else {
    if (s.market === 'spot') {
      const u = `https://api.mexc.com/api/v3/klines?symbol=${s.symbol}&interval=${interval}&limit=${lim}`;
      const d = await j(u, 9000); return norm(Array.isArray(d) ? d : []);
    } else {
      const pair = s.symbol.replace('USDT','_USDT');
      const iv = MEXC_FUTURES_MAP[interval as keyof typeof MEXC_FUTURES_MAP] || 'Min1';
      const urls = [
        `https://contract.mexc.com/api/v1/contract/kline?symbol=${pair}&interval=${iv}&limit=${lim}`,
        `https://contract.mexc.com/api/v1/contract/kline/${pair}?interval=${iv}&limit=${lim}`,
      ];
      for (const u of urls) {
        try {
          const d = await j(u, 10000);
          const arrSrc: any[] = Array.isArray(d?.data) ? d.data : Array.isArray(d) ? d : [];
          const out: number[][] = [];
          for (const k of arrSrc) {
            const t = Number(k[0]), o = Number(k[1]), h = Number(k[2]), l = Number(k[3]), c = Number(k[4]), v = Number(k[5]);
            if (t && (o||h||l||c)) out.push([t, o, h, l, c, v]);
          }
          if (out.length) return out;
        } catch {}
      }
    }
  }
  return [];
}

/* ---------------- Grade ---------------- */
function grade(candles: number[][]) {
  const close = candles.map(k => k[4]);
  const high  = candles.map(k => k[2]);
  const low   = candles.map(k => k[3]);
  if (close.length < 60) return null;

  const e20 = ema(close,20);
  const e50 = ema(close,50);
  const r14 = rsi(close,14);
  const a14 = atr(high,low,close,14);

  const n = close.length-1, c = close[n], v20=e20[n], v50=e50[n], r=r14[n], a=a14[n] || 0;

  let side: 'long'|'short'|undefined;
  if (c>v20 && v20>v50 && r>=55) side='long';
  if (c<v20 && v20<v50 && r<=45) side='short';
  if (!side) return null;

  const trend = Math.min(Math.abs(v20-v50)/(a||1e-9), 3);
  const rsiedge = side==='long' ? (r-50)/30 : (50-r)/30;
  const mom = Math.min(Math.abs(c-v20)/(a||1e-9), 3);

  const conf = Math.round(Math.max(0, Math.min(100, trend*22 + rsiedge*40 + mom*18 + 20)));
  const risk = Math.max(0.2, Math.min(3.5, (a/c)*100));
  const stop = side==='long' ? c-1.8*a : c+1.8*a;
  const tp   = side==='long' ? c+2.6*a : c-2.6*a;
  const reason = side==='long'
    ? `Uptrend: price>EMA20>EMA50, RSI ${r.toFixed(1)}, ATR ${a.toFixed(4)}`
    : `Downtrend: price<EMA20<EMA50, RSI ${r.toFixed(1)}, ATR ${a.toFixed(4)}`;

  return { side, conf, risk:+risk.toFixed(2), entry:c, stop, tp, reason };
}

/* ---------------- Route ---------------- */
export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const mode     = (u.searchParams.get('mode') || 'strong').toLowerCase() as 'strong'|'balanced'|'wide'|'all';
    const exchange = (u.searchParams.get('exchange') || 'both').toLowerCase() as Exchange;
    const market   = (u.searchParams.get('market') || 'both').toLowerCase()   as Market;
    const interval = (u.searchParams.get('interval') || '5m').toLowerCase();
    const cap      = clamp(parseInt(u.searchParams.get('cap') || '400', 10), 1, 800);

    if (!isStdInterval(interval)) return NextResponse.json({ error:'invalid interval' }, { status:400 });

    const want = (ex: Exchange, mk: Market) =>
      (exchange === 'both' || ex === exchange) && (market === 'both' || mk === market);

    // Discover symbols directly from exchanges (no /api/symbols call => avoids 401)
    const tasks: Promise<SymbolInfo[]>[] = [];
    if (want('binance','spot'))   tasks.push(binanceSpot());
    if (want('binance','futures'))tasks.push(binanceFutures());
    if (want('mexc','spot'))      tasks.push(mexcSpot());
    if (want('mexc','futures'))   tasks.push(mexcFutures());

    const settled = await Promise.allSettled(tasks);
    const list = settled.flatMap(s => (s.status === 'fulfilled' ? s.value : []));
    const universe = list
      .filter(s => s.quote === 'USDT')
      .slice(0, cap);

    const minConf = mode==='strong' ? 75 : mode==='balanced' ? 65 : mode==='wide' ? 55 : 0;

    const picks: Pick[] = [];
    const batch = 24;

    // Scan in small batches
    for (let i=0;i<universe.length;i+=batch) {
      const chunk = universe.slice(i, i+batch);
      await Promise.all(chunk.map(async (s) => {
        try {
          const candles = await fetchKlines(s, interval);
          if (!Array.isArray(candles) || candles.length < 60) return;
          const g = grade(candles);
          if (!g || g.conf < minConf) return;
          picks.push({
            exchange: s.exchange,
            market:   s.market,
            symbol:   s.symbol,
            side: g.side as 'long'|'short',
            confidencePercent: g.conf,
            riskPercent: g.risk,
            entry: +g.entry.toFixed(6),
            stop:  +g.stop.toFixed(6),
            tp:    +g.tp.toFixed(6),
            reason: g.reason
          });
        } catch {}
      }));
      if (mode==='strong' && picks.length >= 3) break;
    }

    picks.sort((a,b)=>b.confidencePercent - a.confidencePercent);
    return NextResponse.json(
      { picks: picks.slice(0,3), scanned: universe.length, mode, interval },
      { headers:{ 'cache-control':'no-store' } }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'failed' }, { status:500 });
  }
}
