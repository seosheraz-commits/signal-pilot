// lib/strategy.ts
export const BINANCE_STYLE_TFS = [
  "1m","3m","5m","15m","30m",
  "1h","2h","4h","6h","8h","12h",
  "1d","3d","1w",
] as const;
export type Interval = typeof BINANCE_STYLE_TFS[number];

export type ComputedSignal = {
  side: "LONG" | "SHORT";
  confidence: number;
  entry: number;
  tp: number;
  sl: number;
  riskPct: number;
  reason: string;
};

const clamp = (x:number, lo:number, hi:number)=> Math.max(lo, Math.min(hi, x));
function ema(a:number[], n:number){ const k=2/(n+1); let e=a[0]; return a.map((v,i)=> i? (e=v*k+e*(1-k)) : v); }
function rsi(c:number[], n=14){
  if (c.length < n+1) return Array(c.length).fill(NaN);
  const g:number[]=[], l:number[]=[];
  for (let i=1;i<c.length;i++){ const ch=c[i]-c[i-1]; g.push(Math.max(0,ch)); l.push(Math.max(0,-ch)); }
  let ag=g.slice(0,n).reduce((a,b)=>a+b,0)/n, al=l.slice(0,n).reduce((a,b)=>a+b,0)/n;
  const out:number[] = Array(n).fill(NaN);
  for (let i=n;i<g.length;i++){ ag=(ag*(n-1)+g[i])/n; al=(al*(n-1)+l[i])/n; const rs=al===0?100:ag/al; out.push(100-100/(1+rs)); }
  while(out.length<c.length) out.unshift(NaN); return out;
}
function bbWidth(c:number[], n=20, k=2){
  const w:number[]=[]; for(let i=0;i<c.length;i++){ if(i<n-1){w.push(NaN); continue;}
    const slice=c.slice(i-n+1,i+1); const mean=slice.reduce((a,b)=>a+b,0)/n;
    const sd=Math.sqrt(slice.reduce((s,v)=>s+(v-mean)**2,0)/n); const up=mean+k*sd; const lo=mean-k*sd;
    w.push((up-lo)/mean);
  } return w;
}
function donchian(h:number[], l:number[], n=20){
  const up:number[]=[], lo:number[]=[];
  for(let i=0;i<h.length;i++){
    if(i<n-1){up.push(NaN); lo.push(NaN); continue;}
    up.push(Math.max(...h.slice(i-n+1,i+1)));
    lo.push(Math.min(...l.slice(i-n+1,i+1)));
  }
  return {up, lo};
}
function macdFS(c:number[], f=12, s=26, sig=9){
  const ef=ema(c,f), es=ema(c,s); const m=c.map((_,i)=>ef[i]-es[i]); const sg=ema(m,sig);
  const hist=m.map((v,i)=>v-sg[i]); return {m, hist};
}
function tinyPattern(open:number[], close:number[]){
  const n=close.length; if(n<3) return "Neutral";
  const c1=close[n-2], c2=close[n-1], o1=open[n-2], o2=open[n-1];
  const bull = (c2>o2) && (o2<=c1) && (c2>=o1) && (c1<o1);
  const bear = (c2<o2) && (o2>=c1) && (c2<=o1) && (c1>o1);
  return bull? "Bullish Engulfing" : bear? "Bearish Engulfing" : "Neutral";
}

export function tfParams(tf: Interval) {
  switch (tf) {
    case "1m":  return { slPct: 0.30, tpPct: 0.45, donLen: 20, bbwStrong: 0.035 };
    case "3m":  return { slPct: 0.35, tpPct: 0.55, donLen: 20, bbwStrong: 0.035 };
    case "5m":  return { slPct: 0.40, tpPct: 0.60, donLen: 20, bbwStrong: 0.035 };
    case "15m": return { slPct: 0.55, tpPct: 0.90, donLen: 20, bbwStrong: 0.032 };
    case "30m": return { slPct: 0.70, tpPct: 1.10, donLen: 20, bbwStrong: 0.030 };
    case "1h":  return { slPct: 0.90, tpPct: 1.40, donLen: 20, bbwStrong: 0.028 };
    case "2h":  return { slPct: 1.10, tpPct: 1.70, donLen: 20, bbwStrong: 0.026 };
    case "4h":  return { slPct: 1.40, tpPct: 2.20, donLen: 20, bbwStrong: 0.024 };
    case "6h":  return { slPct: 1.70, tpPct: 2.60, donLen: 20, bbwStrong: 0.022 };
    case "8h":  return { slPct: 2.00, tpPct: 3.00, donLen: 20, bbwStrong: 0.020 };
    case "12h": return { slPct: 2.40, tpPct: 3.80, donLen: 20, bbwStrong: 0.019 };
    case "1d":  return { slPct: 3.50, tpPct: 5.50, donLen: 20, bbwStrong: 0.017 };
    case "3d":  return { slPct: 4.50, tpPct: 7.50, donLen: 20, bbwStrong: 0.015 };
    case "1w":  return { slPct: 6.00, tpPct: 9.50, donLen: 20, bbwStrong: 0.013 };
    default:    return { slPct: 0.60, tpPct: 0.90, donLen: 20, bbwStrong: 0.03 };
  }
}

export function computeSignal(
  open: number[], high: number[], low: number[], close: number[], live: number, tf: Interval
): ComputedSignal {
  const i = close.length - 1;
  const price = Number.isFinite(live) ? live : close[i];
  const ema20 = ema(close, 20)[i];
  const ema50 = ema(close, 50)[i];
  const emaDist = (ema20 - ema50) / price;

  const r = rsi(close, 14)[i];
  const rsiBias = r >= 55 ? 1 : r <= 45 ? -1 : 0;

  const { donLen, bbwStrong, slPct, tpPct } = tfParams(tf);
  const { up: dUp, lo: dLo } = donchian(high, low, donLen);
  const ch = price > dUp[i] ? 1 : price < dLo[i] ? -1 : 0;

  const bbw = bbWidth(close, 20, 2)[i];
  const regime = (bbw ?? 0) > bbwStrong ? 1 : -1;

  const { m, hist } = macdFS(close);
  const macdBias = m[i] > 0 && hist[i] > 0 ? 1 : m[i] < 0 && hist[i] < 0 ? -1 : 0;

  const raw = 35*Math.sign(emaDist) + 25*rsiBias + 25*ch + 10*macdBias + 5*regime;
  const side: "LONG" | "SHORT" = raw >= 0 ? "LONG" : "SHORT";
  const confidence = clamp(Math.round(Math.min(100, Math.abs(raw))), 0, 100);

  const entry = price;
  const sl = side === "LONG" ? entry * (1 - slPct / 100) : entry * (1 + slPct / 100);
  const tp = side === "LONG" ? entry * (1 + tpPct / 100) : entry * (1 - tpPct / 100);
  const riskPct = Math.abs((entry - sl) / entry) * 100;

  const patt = tinyPattern(open, close);
  const reason =
    `Trend ${emaDist>=0?"+1":"-1"} (EMA20${emaDist>=0?">":"<"}EMA50, ${Math.abs(emaDist*100).toFixed(2)}%) • ` +
    `Momentum ${rsiBias} (RSI ${Number.isFinite(r)?r.toFixed(1):"—"}) • ` +
    `${ch===0? "Inside Channel" : ch>0 ? "Donchian Breakout ↑" : "Donchian Breakdown ↓"} • ` +
    `Pattern ${patt==="Neutral"?"Neutral":patt} • ` +
    `Regime ${regime>0?"strong":"weak"} (BBW ${(bbw ?? 0).toFixed(3)})`;

  return { side, confidence, entry, tp, sl, riskPct, reason };
}
