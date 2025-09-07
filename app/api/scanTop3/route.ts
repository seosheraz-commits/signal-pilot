import { NextResponse } from 'next/server';

// simple indicator helpers inline to keep route self-contained
function ema(values:number[], len:number){ const out=new Array(values.length).fill(null as any); const k=2/(len+1); let prev:null|number=null; for(let i=0;i<values.length;i++){const v=values[i]; if(prev==null){ let sum=0,c=0; for(let j=Math.max(0,i-len+1);j<=i;j++){sum+=values[j]; c++;} prev=sum/c; } else prev=v*k+prev*(1-k); out[i]=prev;} return out; }
function rsi(values:number[], len=14){ const out=new Array(values.length).fill(null as any); if(values.length<len+1) return out; let g=0,l=0; for(let i=1;i<=len;i++){const d=values[i]-values[i-1]; if(d>0) g+=d; else l-=d;} let ag=g/len, al=l/len; out[len]=al===0?100:100-100/(1+ag/al); for(let i=len+1;i<values.length;i++){const d=values[i]-values[i-1]; ag=(ag*(len-1)+(d>0?d:0))/len; al=(al*(len-1)+(d<0?-d:0))/len; out[i]=al===0?100:100-100/(1+ag/al);} return out; }
function atr(h:number[], l:number[], c:number[], len=14){ const out=new Array(c.length).fill(null as any); const tr=new Array(c.length).fill(0); for(let i=0;i<c.length;i++){const t1=h[i]-l[i], t2=Math.abs(h[i]-(i>0?c[i-1]:c[i])), t3=Math.abs(l[i]-(i>0?c[i-1]:c[i])); tr[i]=Math.max(t1,t2,t3);} const a=1/len; let prev:number|null=null; for(let i=0;i<tr.length;i++){const v=tr[i]; if(prev==null) prev=v; else prev=prev+a*(v-prev); if(i>=len-1) out[i]=prev;} return out; }
function donchian(h:number[], l:number[], len:number){ const n=h.length; const upper=new Array(n).fill(null as any), lower=new Array(n).fill(null as any); for(let i=0;i<n;i++){ if(i<len-1) continue; let hi=-Infinity, lo=Infinity; for(let j=i-len+1;j<=i;j++){ if(h[j]>hi) hi=h[j]; if(l[j]<lo) lo=l[j]; } upper[i]=hi; lower[i]=lo; } return {upper,lower}; }

const BINANCE_LIST = ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','DOGEUSDT','ADAUSDT','LINKUSDT','AVAXUSDT','MATICUSDT','DOTUSDT','TRXUSDT'];
const MEXC_LIST    = ['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','DOGEUSDT','ADAUSDT','LINKUSDT','AVAXUSDT','MATICUSDT','DOTUSDT','TONUSDT','OPUSDT'];

async function klines(ex:'binance'|'mexc', sym:string, interval:string){
  const core=`api/v3/klines?symbol=${encodeURIComponent(sym)}&interval=${encodeURIComponent(interval)}&limit=300`;
  const urls = ex==='mexc'
    ? [`https://api.mexc.com/${core}`, `https://corsproxy.io/?https://api.mexc.com/${core}`]
    : [`https://api.binance.com/${core}`, `https://data-api.binance.vision/${core}`, `https://corsproxy.io/?https://api.binance.com/${core}`];
  for(const u of urls){
    try { const r=await fetch(u, { cache:'no-store' }); if(!r.ok) continue;
      const arr=await r.json() as any[];
      return arr.map(k=>({ t:k[0], o:+k[1], h:+k[2], l:+k[3], c:+k[4], v:+k[5] }));
    } catch {}
  }
  return [];
}

function score(candles:{t:number,o:number,h:number,l:number,c:number,v:number}[]){
  const n=candles.length; if(n<60) return { side:'No Trade' as const, conf:0, entry:null, sl:null, tp:null, reasons:['insufficient'] };
  const c=candles.map(x=>x.c), h=candles.map(x=>x.h), l=candles.map(x=>x.l);
  const e20=ema(c,20), e50=ema(c,50), r=rsi(c,14), a=atr(h,l,c,14);
  const i=n-1;
  const trend = e20[i]!=null && e50[i]!=null ? (e20[i]>e50[i] && c[i]>e20[i] ? 1 : e20[i]<e50[i] && c[i]<e20[i] ? -1 : 0) : 0;
  const mom   = r[i]!=null ? (r[i]>55?1:r[i]<45?-1:0) : 0;
  // simple channel breakout on Donchian(20) with 0.05% buffer
  const dch=donchian(h,l,20); const buf=0.0005;
  const channel = c[i] > (dch.upper[i]||Infinity)*(1+buf) ? 1 : c[i] < (dch.lower[i]||-Infinity)*(1-buf) ? -1 : 0;
  let longScore=0, shortScore=0; const reasons:string[]=[];
  if (trend===1){ longScore+=30; reasons.push('Trend up'); } else if (trend===-1){ shortScore+=30; reasons.push('Trend down'); }
  if (mom===1){ longScore+=25; reasons.push('Momentum up'); } else if (mom===-1){ shortScore+=25; reasons.push('Momentum down'); }
  if (channel===1){ longScore+=35; reasons.push('Channel breakout'); } else if (channel===-1){ shortScore+=35; reasons.push('Channel breakdown'); } else { reasons.push('Inside channel'); }
  const best=Math.max(longScore,shortScore);
  const conf=Math.round(Math.min(100, (best/90)*100));
  let side:'Long'|'Short'|'No Trade'='No Trade';
  if (longScore>shortScore && best>=45) side='Long';
  if (shortScore>longScore && best>=45) side='Short';
  const entry=c[i];
  const atr=a[i]||0;
  const sl = side==='Long' ? entry-1.2*atr : side==='Short' ? entry+1.2*atr : null;
  const tp = side==='Long' ? entry+2*atr : side==='Short' ? entry-2*atr : null;
  return { side, conf, entry: Number(entry.toFixed(6)), sl: sl==null?null:Number(sl.toFixed(6)), tp: tp==null?null:Number(tp.toFixed(6)), reasons };
}

async function price(ex:'binance'|'mexc', sym:string){
  const core=`api/v3/ticker/price?symbol=${encodeURIComponent(sym)}`;
  const urls = ex==='mexc'
    ? [`https://api.mexc.com/${core}`, `https://corsproxy.io/?https://api.mexc.com/${core}`]
    : [`https://api.binance.com/${core}`, `https://data-api.binance.vision/${core}`, `https://corsproxy.io/?https://api.binance.com/${core}`];
  for(const u of urls){
    try{ const r=await fetch(u, { cache:'no-store' }); const j=await r.json(); const p=Number(j?.price); if(Number.isFinite(p)&&p>0) return p; } catch {}
  }
  return null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const interval = url.searchParams.get('interval') || '5m';

  const both = BINANCE_LIST.filter(s => MEXC_LIST.includes(s));

  // pick 6 candidates per exchange to keep fast
  const bCandidates = BINANCE_LIST.slice(0, 8);
  const mCandidates = MEXC_LIST.slice(0, 8);
  const bothCandidates = both.slice(0, 8);

  async function bestOf(ex:'binance'|'mexc', arr:string[]){
    const scored = await Promise.all(arr.map(async sym => {
      const ks = await klines(ex, sym, interval);
      const sc = score(ks);
      const pr = await price(ex, sym);
      return { symbol:sym, exchange: ex, ...sc, price: pr, ts: Date.now() };
    }));
    return scored.sort((a,b)=> (b.conf||0)-(a.conf||0))[0];
  }

  const [bin, mex, bth] = await Promise.all([
    bestOf('binance', bCandidates),
    bestOf('mexc', mCandidates),
    (async ()=>{ const sym = bothCandidates[0] || 'BTCUSDT'; const ks = await klines('binance', sym, interval); const sc = score(ks); const pr = await price('binance', sym); return { symbol:sym, exchange:'both', ...sc, price:pr, ts:Date.now() }; })()
  ]);

  return NextResponse.json({ cards: [bin, mex, bth] });
}
