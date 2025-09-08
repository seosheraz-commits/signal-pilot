// app/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { listSymbols, type Exchange, type Market } from '../lib/symbols';
import Watchlist from '../components/Watchlist';
import DemoTradePanel from '../components/DemoTradePanel';
import TopSignals, { type Pick as SignalPick } from '../components/TopSignals';
import IndicatorManager from '../components/IndicatorManager';

const CandleChart = dynamic(() => import('../components/CandleChart'), { ssr: false });

type QuotePreset = 'USDT' | 'USDT+USDC' | 'All stables' | 'USDC' | 'FDUSD' | 'TUSD';
const quotesFor = (p: QuotePreset) =>
  p === 'USDT' ? ['USDT'] :
  p === 'USDC' ? ['USDC'] :
  p === 'FDUSD' ? ['FDUSD'] :
  p === 'TUSD' ? ['TUSD'] :
  p === 'USDT+USDC' ? ['USDT','USDC'] :
  ['USDT','USDC','FDUSD','TUSD'];

type Signal = {
  label: string; confidence: number; entry: number; sl: number; tp: number;
  riskPct: number; riskBand: string; reasons: string[];
};

type Config = {
  rsiUpper: number; rsiLower: number; bbwMin: number; donchianLen: number; breakoutBufferPct: number;
  weights: { trend: number; momentum: number; breakout: number; pattern: number; regime: number };
  longScore: number; shortScore: number; slATR: number; tpATR: number;
  riskBands: { lowMax: number; medMax: number };
  overlays: {
    ema: boolean; bollinger: boolean; donchian: boolean; signalLevels: boolean;
    patterns: boolean; nameEveryCandle: boolean; channelSignals: boolean;
    hud: boolean; onBarReasons: boolean; legend: boolean;
  };
};

const DEFAULT_CONFIG: Config = {
  rsiUpper: 55, rsiLower: 45, bbwMin: 0.035, donchianLen: 20, breakoutBufferPct: 0.05,
  weights: { trend: 28, momentum: 28, breakout: 28, pattern: 12, regime: 4 },
  longScore: 22, shortScore: -22, slATR: 1.8, tpATR: 3.2,
  riskBands: { lowMax: 3.5, medMax: 8.0 },
  overlays: {
    ema: true, bollinger: true, donchian: true, signalLevels: true,
    patterns: true, nameEveryCandle: false, channelSignals: true,
    hud: true, onBarReasons: false, legend: true
  },
};

const ALL_TFS = ["1m","3m","5m","15m","30m","1h","2h","4h","6h","8h","12h","1d","3d","1w"] as const;

/* small TA helpers for fallback text (only used for the mini “Signal:” card) */
const emaArr = (arr: number[], p: number) => {
  if (!arr.length) return [] as number[];
  const k = 2 / (p + 1); const out: number[] = []; let prev = arr[0];
  for (let i = 0; i < arr.length; i++) { const v = Number(arr[i]); out.push(i ? v * k + prev * (1 - k) : prev); prev = out[i]; }
  return out;
};
const rsiArr = (c: number[], p = 14) => {
  if (c.length < p + 2) return Array(c.length).fill(null) as (number | null)[];
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; if (d >= 0) g += d; else l -= d; }
  let ag = g / p, al = l / p;
  const out: (number | null)[] = Array(p).fill(null);
  out.push(100 - 100 / (1 + (ag / (al || 1e-12))));
  for (let i = p + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1]; const ga = Math.max(d, 0), lo = Math.max(-d, 0);
    ag = (ag * (p - 1) + ga) / p; al = (al * (p - 1) + lo) / p;
    out.push(100 - 100 / (1 + (ag / (al || 1e-12))));
  }
  while (out.length < c.length) out.unshift(null);
  return out;
};
const maxN = (arr: number[], n: number) => { const s = Math.max(0, arr.length - n); let m = -Infinity; for (let i = s; i < arr.length; i++) if (arr[i] > m) m = arr[i]; return m; };
const minN = (arr: number[], n: number) => { const s = Math.max(0, arr.length - n); let m = Infinity; for (let i = s; i < arr.length; i++) if (arr[i] < m) m = arr[i]; return m; };

type Fallback =
  | { kind: 'ready' | 'soft'; side: 'LONG'|'SHORT'; entry: number; sl: number; tp: number; conf: number; riskPct: number; reasons: string[]; support: number; resistance: number; rsi: number; ema20: number; ema50: number; };

export default function Page() {
  const [exchange, setExchange] = useState<Exchange>('binance');
  const [market, setMarket]     = useState<Market>('spot');
  const [preset, setPreset]     = useState<QuotePreset>('USDT');

  const [symbols, setSymbols]   = useState<string[]>(['BTCUSDT']);
  const [symbol,  setSymbol]    = useState('BTCUSDT');

  const [interval, setInterval] = useState<typeof ALL_TFS[number]>('5m');
  const [cfg, setCfg]           = useState<Config>(DEFAULT_CONFIG);
  const [filter, setFilter]     = useState('');
  const [showInd, setShowInd]   = useState(false);

  const [signal, setSignal]     = useState<Signal | null>(null);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [fallback, setFallback] = useState<Fallback | null>(null);

  // also keep last pick from TopSignals to seed DemoTradePanel
  const [lastPick, setLastPick] = useState<{ entry: number; stop: number; tp: number } | null>(null);

  const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 8 });
  const sessionRef = useRef(0);
  useEffect(() => { sessionRef.current += 1; setLivePrice(null); setSignal(null); setFallback(null); }, [exchange, market, symbol, interval]);

  // FULL symbol list via /api/symbols (server)
  useEffect(() => {
    (async () => {
      try {
        const list = await listSymbols(exchange, quotesFor(preset), market);
        setSymbols(list);
        setSymbol((prev) => (list.includes(prev) ? prev : (list[0] ?? 'BTCUSDT')));
      } catch {
        setSymbols(['BTCUSDT']); setSymbol('BTCUSDT');
      }
    })();
  }, [exchange, preset, market]);

  // TF tweak for BBW gate
  useEffect(() => {
    setCfg((c) => {
      if (['1m','3m'].includes(interval)) return { ...c, bbwMin: Math.max(0.04, c.bbwMin) };
      if (['1h','2h','4h','6h','8h','12h','1d','3d','1w'].includes(interval)) return { ...c, bbwMin: Math.min(0.03, c.bbwMin) };
      return { ...c, bbwMin: 0.035 };
    });
  }, [interval]);

  const allowed = useMemo(() => {
    const q = filter.trim().toUpperCase();
    return q ? symbols.filter(s => s.includes(q)) : symbols;
  }, [symbols, filter]);

  // fallback mini-signal (keeps the little “Signal:” card informative)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ru = new URL('/api/klines', window.location.origin);
        ru.searchParams.set('exchange', exchange);
        ru.searchParams.set('market', market);
        ru.searchParams.set('symbol', symbol);
        ru.searchParams.set('interval', interval);
        ru.searchParams.set('limit', '220');
        const r = await fetch(ru.toString(), { cache: 'no-store' });
        const d = await r.json();
        const raw: any[] = Array.isArray(d?.candles) ? d.candles : [];
        if (!raw.length) return;

        const o = raw.map((k) => Number(k[1]));
        const h = raw.map((k) => Number(k[2]));
        const l = raw.map((k) => Number(k[3]));
        const c = raw.map((k) => Number(k[4]));

        const last = c.length - 1, confIdx = last - 1, touchIdx = confIdx - 1;
        const closes = c.slice(0, confIdx + 1);
        const highs  = h.slice(0, confIdx + 1);
        const lows   = l.slice(0, confIdx + 1);

        const support = minN(lows, 50);
        const resistance = maxN(highs, 50);

        const e20 = emaArr(closes, 20)[closes.length - 1];
        const e50 = emaArr(closes, 50)[closes.length - 1];
        const r14 = rsiArr(closes, 14)[closes.length - 1] as number | null;

        const loTouch = l[touchIdx], hiTouch = h[touchIdx];
        const confClose = c[confIdx], confOpen = o[confIdx];
        const bull = confClose >= confOpen, bear = !bull;

        const tol = 0.0015, buf = 0.0020;
        const touchedSup = loTouch <= support * (1 + tol);
        const touchedRes = hiTouch >= resistance * (1 - tol);
        const confAbove = confClose >= support * (1 + buf);
        const confBelow = confClose <= resistance * (1 - buf);

        const riskPct = (e: number, s: number) => Math.abs(e - s) / e * 100;

        if (touchedSup && bull && confAbove) {
          const entry = confClose, sl = Math.min(support * (1 - tol), loTouch);
          const risk = Math.max(1e-12, entry - sl); const room = (resistance - entry) / entry;
          const tp = room >= 0.1 ? resistance : entry + 2 * risk;
          const conf = Math.min(95, 65 + (entry > e20 ? 8 : 0) + (e20 > e50 ? 7 : 0) + Math.min(10, Math.max(0, (r14 ?? 50) - 50)));
          if (!cancelled) setFallback({ kind:'ready', side:'LONG', entry, sl, tp, conf: Math.round(conf), riskPct: riskPct(entry, sl),
            reasons:['Support touch + 1 bull confirm','EMA20≥EMA50'], support, resistance, rsi: Number((r14 ?? 0).toFixed(2)), ema20: e20, ema50: e50 });
          return;
        }
        if (touchedRes && bear && confBelow) {
          const entry = confClose, sl = Math.max(resistance * (1 + tol), hiTouch);
          const risk = Math.max(1e-12, sl - entry); const room = (entry - support) / entry;
          const tp = room >= 0.1 ? support : entry - 2 * risk;
          const conf = Math.min(95, 65 + (entry < e20 ? 8 : 0) + (e20 < e50 ? 7 : 0) + Math.min(10, Math.max(0, 50 - (r14 ?? 50))));
          if (!cancelled) setFallback({ kind:'ready', side:'SHORT', entry, sl, tp, conf: Math.round(conf), riskPct: riskPct(entry, sl),
            reasons:['Resistance touch + 1 bear confirm','EMA20≤EMA50'], support, resistance, rsi: Number((r14 ?? 0).toFixed(2)), ema20: e20, ema50: e50 });
          return;
        }

        const price = confClose;
        const biasLong  = price > e20 && e20 > e50;
        const biasShort = price < e20 && e20 < e50;
        const roomLong  = (resistance - price) / price;
        const roomShort = (price - support) / price;
        const side: 'LONG' | 'SHORT' = biasLong && !biasShort ? 'LONG' : biasShort && !biasLong ? 'SHORT' : (roomLong >= roomShort ? 'LONG' : 'SHORT');

        let entry = price, sl: number, tp: number, confNum: number, rPct: number;
        const tolSoft = 0.0018;
        if (side === 'LONG') {
          sl = support * (1 - tolSoft);
          const risk = Math.max(1e-12, entry - sl);
          const tpPct = Math.max(1.4 * (risk / entry), Math.min(roomLong, 0.12));
          tp = entry * (1 + tpPct);
          confNum = 40 + (biasLong ? 8 : 0) + Math.min(10, Math.max(0, (r14 ?? 50) - 48)) + Math.min(7, roomLong * 50);
          rPct = (risk / entry) * 100;
        } else {
          sl = resistance * (1 + tolSoft);
          const risk = Math.max(1e-12, sl - entry);
          const tpPct = Math.max(1.4 * (risk / entry), Math.min(roomShort, 0.12));
          tp = entry * (1 - tpPct);
          confNum = 40 + (biasShort ? 8 : 0) + Math.min(10, Math.max(0, 52 - (r14 ?? 50))) + Math.min(7, roomShort * 50);
          rPct = (risk / entry) * 100;
        }
        confNum = Math.max(35, Math.min(65, Math.round(confNum)));
        if (!cancelled) setFallback({
          kind:'soft', side, entry, sl, tp, conf: confNum, riskPct: rPct,
          reasons:['Low-confidence candidate (no confirm)','Based on EMA bias + S/R room'],
          support, resistance, rsi: Number((r14 ?? 0).toFixed(2)), ema20: e20, ema50: e50
        });
      } catch { if (!cancelled) setFallback(null); }
    })();
    return () => { cancelled = true; };
  }, [exchange, market, symbol, interval]);

  function setOverlay(key: keyof Config['overlays'], on?: boolean) {
    setCfg(c => ({ ...c, overlays: { ...c.overlays, [key]: on ?? !(c.overlays as any)[key] } }));
  }
  const ov = cfg.overlays;
  const ToolbarBtn = ({ label, active, onClick, title }: { label: string; active?: boolean; onClick: () => void; title?: string }) => (
    <button title={title} onClick={onClick}
      className={`w-full rounded-lg border border-neutral-900 py-2 text-lg hover:bg-neutral-900 ${active ? 'bg-neutral-900' : ''}`}>
      {label}
    </button>
  );

  const sess = sessionRef.current;

  // Prefer precise trade levels for DemoTradePanel:
  const lastForPanel = useMemo(() => {
    if (signal) return { entry: signal.entry, sl: signal.sl, tp: signal.tp };
    if (lastPick) return { entry: lastPick.entry, sl: lastPick.stop, tp: lastPick.tp };
    if (fallback) return { entry: fallback.entry, sl: fallback.sl, tp: fallback.tp };
    return null;
  }, [signal, lastPick, fallback]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#fefce8]">
      {/* HEADER */}
      <div className="sticky top-0 z-30 border-b border-neutral-900 bg-[#0b0b0b]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 p-2">
          <div className="flex items-center gap-3">
            <div className="text-sm font-semibold md:text-base">📈 TV Clone</div>
            <select value={symbol} onChange={(e)=>setSymbol(e.target.value)} className="rounded bg-[#0e0f12] px-2 py-1 text-sm border border-neutral-800">
              {allowed.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <select value={interval} onChange={(e)=>setInterval(e.target.value as typeof ALL_TFS[number])}
              className="rounded bg-[#0e0f12] px-2 py-1 text-sm border border-neutral-800">
              {ALL_TFS.map(tf => <option key={tf} value={tf}>{tf}</option>)}
            </select>
            <button onClick={()=>setShowInd(v=>!v)} className="rounded border border-neutral-800 px-2 py-1 text-sm hover:bg-neutral-900">Indicators</button>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select value={exchange} onChange={(e)=>setExchange(e.target.value as Exchange)}
              className="rounded bg-[#0e0f12] px-2 py-1 text-sm border border-neutral-800">
              <option value="binance">Binance</option>
              <option value="mexc">MEXC</option>
            </select>
            <select value={market} onChange={(e)=>setMarket(e.target.value as Market)}
              className="rounded bg-[#0e0f12] px-2 py-1 text-sm border border-neutral-800">
              <option value="spot">Spot</option>
              <option value="futures">Futures</option>
            </select>
            <select value={preset} onChange={(e)=>setPreset(e.target.value as QuotePreset)}
              className="rounded bg-[#0e0f12] px-2 py-1 text-sm border border-neutral-800">
              <option>USDT</option><option>USDT+USDC</option><option>All stables</option>
              <option>USDC</option><option>FDUSD</option><option>TUSD</option>
            </select>
            <input value={filter} onChange={(e)=>setFilter(e.target.value)} placeholder="Find symbol (e.g. BTC)"
              className="w-40 rounded border border-neutral-800 bg-[#0e0f12] px-2 py-1 text-sm md:w-60" />
          </div>
        </div>
      </div>

      {/* BODY */}
      <div className="mx-auto grid max-w-7xl grid-cols-12 gap-2 p-2">
        {/* LEFT toolbar */}
        <aside className="col-span-1 hidden flex-col items-center gap-2 md:flex">
          <ToolbarBtn label="🖱" title="Toggle HUD" active={ov.hud} onClick={()=>setOverlay('hud')} />
          <ToolbarBtn label="➕" title="Add/Manage Indicators" onClick={()=>setShowInd(true)} />
          <ToolbarBtn label="➖" title="Bollinger Bands" active={ov.bollinger} onClick={()=>setOverlay('bollinger')} />
          <ToolbarBtn label="📏" title="Donchian Channel" active={ov.donchian} onClick={()=>setOverlay('donchian')} />
          <ToolbarBtn label="📐" title="EMAs" active={ov.ema} onClick={()=>setOverlay('ema')} />
          <ToolbarBtn label="✏️" title="Patterns" active={ov.patterns} onClick={()=>setOverlay('patterns')} />
          <ToolbarBtn label="⬛" title="Signal Levels" active={ov.signalLevels} onClick={()=>setOverlay('signalLevels')} />
          <ToolbarBtn label="🔗" title="Channel Signals" active={ov.channelSignals} onClick={()=>setOverlay('channelSignals')} />
          <ToolbarBtn label="⚙️" title="Legend / Settings" active={ov.legend} onClick={()=>setOverlay('legend')} />
        </aside>

        {/* CENTER */}
        <main className="col-span-12 flex flex-col gap-2 md:col-span-8">
          <section className="rounded-xl border border-neutral-900">
            <div className="flex items-center justify-between border-b border-neutral-900 px-3 py-2">
              <div className="text-sm font-semibold">{symbol} • {interval}</div>
              <div className="text-xs opacity-70">{exchange.toUpperCase()} • {market.toUpperCase()}</div>
            </div>
            <CandleChart
              key={`${exchange}-${market}-${symbol}-${interval}-${JSON.stringify(cfg.overlays)}`}
              exchange={exchange}
              market={market}
              symbol={symbol}
              interval={interval}
              config={cfg}
              onSignal={(s)=>{ if (sessionRef.current === sess) setSignal(s); }}
              onLivePrice={(p)=>{ if (sessionRef.current === sess) setLivePrice(p); }}
            />
          </section>

          <section className="rounded-xl border border-neutral-900 p-3">
            <div className="text-sm font-semibold">
              {signal
                ? `Signal: ${signal.label} • Confidence ${signal.confidence}%`
                : fallback
                ? `Signal: ${fallback.kind === 'soft' ? 'Candidate (low confidence)' : 'Setup ready'} • ${fallback.side} • Confidence ${fallback.conf}% • Risk ${fallback.riskPct.toFixed(2)}%`
                : 'Signal: —'}
            </div>
            {signal ? (
              <>
                <div className="mt-1 text-sm opacity-90">
                  Entry <span className="font-semibold text-yellow-300">{nf.format(signal.entry)}</span> •
                  SL <span className="font-semibold text-red-400">{nf.format(signal.sl)}</span> •
                  TP <span className="font-semibold text-green-400">{nf.format(signal.tp)}</span>
                </div>
                <div className="text-xs opacity-70">{signal.reasons.join(' • ')}</div>
              </>
            ) : fallback ? (
              <>
                <div className="mt-1 text-sm opacity-90">
                  Entry <span className="font-semibold text-yellow-300">{nf.format(fallback.entry)}</span> •
                  SL <span className="font-semibold text-red-400">{nf.format(fallback.sl)}</span> •
                  TP <span className="font-semibold text-green-400">{nf.format(fallback.tp)}</span>
                </div>
                <div className="text-xs opacity-70">{fallback.reasons.join(' • ')}</div>
              </>
            ) : (
              <div className="text-sm opacity-60">Loading…</div>
            )}
          </section>

          {/* Demo Trade Panel uses either the live signal, last TopSignals pick, or the fallback */}
          <DemoTradePanel
            key={`${exchange}-${market}-${symbol}`}
            exchange={exchange}
            market={market}
            symbol={symbol}
            livePrice={livePrice}
            lastSignal={lastForPanel}
          />

          {/* Top Signals — Engine first, fallback to builtin. Clicking a pick syncs the view. */}
          <TopSignals
            source="auto"
            interval={interval}
            exchange={exchange as any}
            market={market as any}
            mode="strong"
            onSelect={(p: SignalPick) => {
              setExchange(p.exchange as Exchange);
              setMarket(p.market as Market);
              setSymbol(p.symbol);
              setLastPick({ entry: p.entry, stop: p.stop, tp: p.tp });
            }}
          />
        </main>

        {/* RIGHT */}
        <aside className="col-span-12 md:col-span-3">
          <Watchlist exchange={exchange} allowedSymbols={allowed} selected={symbol} onSelect={setSymbol} />
        </aside>
      </div>

      {showInd && (
        <IndicatorManager
          overlays={cfg.overlays}
          onToggle={(k, v)=>setCfg(c => ({ ...c, overlays: { ...c.overlays, [k]: v ?? !(c.overlays as any)[k] } }))}
          onClose={()=>setShowInd(false)}
        />
      )}
    </div>
  );
}
