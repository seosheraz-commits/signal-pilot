'use client';

import { useEffect, useRef, useState } from 'react';
import { MEXC_FUTURES_MAP } from '@/lib/interval';

type Exchange = 'binance' | 'mexc';
type Market = 'spot' | 'futures';
type Bar = { time: number; open: number; high: number; low: number; close: number };

export type Config = {
  rsiUpper: number;
  rsiLower: number;
  bbwMin: number;
  donchianLen: number;
  breakoutBufferPct: number;
  weights: { trend: number; momentum: number; breakout: number; pattern: number; regime: number };
  longScore: number;
  shortScore: number;
  slATR: number;
  tpATR: number;
  riskBands: { lowMax: number; medMax: number };
  overlays: {
    ema: boolean;
    bollinger: boolean;
    donchian: boolean;
    signalLevels: boolean;
    patterns: boolean;
    nameEveryCandle: boolean;
    channelSignals: boolean;
    hud: boolean;
    onBarReasons: boolean;
    legend: boolean;
  };
};

export type Signal = {
  label: 'Long' | 'Short' | 'No Trade';
  confidence: number;
  entry: number;
  sl: number;
  tp: number;
  riskPct: number;
  riskBand: 'Low' | 'Medium' | 'High';
  reasons: string[];
};

function loadLW(): Promise<any> {
  return new Promise((resolve, reject) => {
    if ((window as any).LightweightCharts) return resolve((window as any).LightweightCharts);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/lightweight-charts@4/dist/lightweight-charts.standalone.production.min.js';
    s.async = true;
    s.onload = () => resolve((window as any).LightweightCharts);
    s.onerror = () => reject(new Error('Failed to load Lightweight-Charts'));
    document.head.appendChild(s);
  });
}

/* --- light TA used only to draw overlays/levels locally --- */
function ema(values: number[], period: number) {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0] ?? 0;
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[i] : values[i] * k + prev * (1 - k);
    out.push(prev);
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
  const out: (number | null)[] = Array(period).fill(null);
  out.push(100 - 100 / (1 + (avgGain / (avgLoss || 1e-12))));
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const G = Math.max(diff, 0), L = Math.max(-diff, 0);
    avgGain = (avgGain * (period - 1) + G) / period;
    avgLoss = (avgLoss * (period - 1) + L) / period;
    out.push(100 - 100 / (1 + (avgGain / (avgLoss || 1e-12)))));
  }
  while (out.length < closes.length) out.unshift(null);
  return out;
}
function atr(highs: number[], lows: number[], closes: number[], period = 14) {
  const trs: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i === 0) trs.push(highs[i] - lows[i]);
    else trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const out: (number | null)[] = Array(closes.length).fill(null);
  let prev = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < trs.length; i++) {
    prev = (prev * (period - 1) + trs[i]) / period;
    out[i] = prev;
  }
  return out;
}

/* --- server helpers --- */
async function fetchKlinesFromServer(exchange: Exchange, market: Market, symbol: string, interval: string, limit = 500): Promise<Bar[]> {
  const u = `/api/klines?exchange=${exchange}&market=${market}&symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
  const r = await fetch(u, { cache: 'no-store' });
  if (!r.ok) throw new Error(`klines ${r.status}`);
  const arr = await r.json() as Array<[number, number, number, number, number, number]>;
  return arr.map(k => ({ time: Math.floor(k[0] / 1000), open: k[1], high: k[2], low: k[3], close: k[4] }));
}
async function fetchLastPrice(exchange: Exchange, market: Market, symbol: string): Promise<number | null> {
  const u = `/api/ticker?exchange=${exchange}&market=${market}&symbol=${encodeURIComponent(symbol)}`;
  try {
    const r = await fetch(u, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    const p = Number(j?.price);
    return Number.isFinite(p) && p > 0 ? p : null;
  } catch { return null; }
}

export default function CandleChart({
  exchange = 'binance',
  market = 'spot',
  symbol = 'BTCUSDT',
  interval = '5m',
  onSignal,
  onLivePrice,
  config,
}: {
  exchange?: Exchange;
  market?: Market;
  symbol?: string;
  interval?: string;
  onSignal?: (s: Signal) => void;
  onLivePrice?: (p: number) => void;
  config: Config;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<any>(null);

  const liveLineRef = useRef<any>(null);
  const entryLineRef = useRef<any>(null);
  const slLineRef = useRef<any>(null);
  const tpLineRef = useRef<any>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const wsTradeRef = useRef<WebSocket | null>(null);
  const pollKRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const barsRef = useRef<Bar[]>([]);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [wsInfo, setWsInfo] = useState('—');
  const [err, setErr] = useState<string | null>(null);

  function setLive(p: number) {
    setLivePrice(p);
    onLivePrice?.(p);
    try { if (liveLineRef.current) seriesRef.current?.removePriceLine(liveLineRef.current); } catch {}
    liveLineRef.current = seriesRef.current?.createPriceLine({ price: p, color: '#60a5fa', lineWidth: 1, title: `Live ${p}` });
  }

  useEffect(() => {
    let disposed = false;

    async function init() {
      setErr(null);

      // cleanup
      try { wsRef.current?.close(); } catch {}
      try { wsTradeRef.current?.close(); } catch {}
      wsRef.current = null; wsTradeRef.current = null;
      if (pollKRef.current) { clearInterval(pollKRef.current); pollKRef.current = null; }
      if (pollTRef.current) { clearInterval(pollTRef.current); pollTRef.current = null; }
      if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }
      barsRef.current = [];
      setLivePrice(null);
      setWsInfo('—');

      const LW = await loadLW();
      if (!wrapRef.current) return;

      // chart
      const chart = LW.createChart(wrapRef.current, {
        layout: { background: { color: '#0a0a0a' }, textColor: '#fefce8' },
        rightPriceScale: { borderVisible: false },
        timeScale: { borderVisible: false },
        grid: { vertLines: { color: '#151515' }, horzLines: { color: '#151515' } },
      });
      const series = chart.addCandlestickSeries({
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderVisible: false,
        wickUpColor: '#22c55e',
        wickDownColor: '#ef4444',
      });
      chartRef.current = chart;
      seriesRef.current = series;

      // seed history via our server (fixes MEXC 1h/2h quirks & futures mapping)
      try {
        const data = await fetchKlinesFromServer(exchange, market, symbol, interval);
        if (disposed) return;
        barsRef.current = data;
        series.setData(data);
      } catch (e: any) {
        setErr(e?.message || 'history failed');
        return;
      }

      // seed live price
      const seed = await fetchLastPrice(exchange, market, symbol);
      if (seed) setLive(seed);

      /* --- live updates ---
         - Binance spot: stream.binance.com
         - Binance futures: fstream.binance.com
         - MEXC spot+futures: poll (WS is different auth/proto)
      */
      if (exchange === 'binance') {
        const sym = symbol.toLowerCase();
        const base = market === 'futures' ? 'wss://fstream.binance.com' : 'wss://stream.binance.com:9443';
        const wsK = new WebSocket(`${base}/ws/${sym}@kline_${interval}`);
        wsRef.current = wsK;
        wsK.onopen = () => { if (wsRef.current === wsK) setWsInfo(`WS ${market.toUpperCase()}`); };
        wsK.onclose = () => { if (wsRef.current === wsK) setWsInfo('WS closed'); };
        wsK.onerror = () => { if (wsRef.current === wsK) setWsInfo('WS error'); };
        wsK.onmessage = (e) => {
          if (wsRef.current !== wsK) return;
          const k = JSON.parse(e.data)?.k;
          if (!k) return;
          const bar: Bar = { time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c };
          if (k.x) {
            const arr = barsRef.current;
            const idx = arr.findIndex((x) => x.time === bar.time);
            if (idx >= 0) arr[idx] = bar; else arr.push(bar);
            series.setData(arr);
          } else {
            series.update(bar);
            setLive(bar.close);
          }
        };
        const wsT = new WebSocket(`${base}/ws/${sym}@trade`);
        wsTradeRef.current = wsT;
        wsT.onmessage = (e) => {
          if (wsTradeRef.current !== wsT) return;
          const p = Number(JSON.parse(e.data)?.p);
          if (p) setLive(p);
        };
      } else {
        // MEXC (spot + futures): reliable + simple polling path via our server route
        setWsInfo('Poll 2s + ticker 1s');
        let lastClosed = barsRef.current[barsRef.current.length - 1]?.time ?? 0;
        pollKRef.current = setInterval(async () => {
          try {
            const arr = await fetchKlinesFromServer(exchange, market, symbol, interval);
            if (!arr.length) return;
            const latest = arr[arr.length - 1];
            barsRef.current = arr;
            series.setData(arr);
            if (latest.time !== lastClosed) lastClosed = latest.time;
          } catch {}
        }, 2000);
        pollTRef.current = setInterval(async () => {
          const p = await fetchLastPrice(exchange, market, symbol);
          if (p) setLive(p);
        }, 1000);
      }
    }

    init();
    return () => {
      try { wsRef.current?.close(); } catch {}
      try { wsTradeRef.current?.close(); } catch {}
      wsRef.current = null; wsTradeRef.current = null;
      if (pollKRef.current) clearInterval(pollKRef.current);
      if (pollTRef.current) clearInterval(pollTRef.current);
      if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }
    };
  }, [exchange, market, symbol, interval, config]);

  return (
    <div>
      <div style={{ display:'flex', gap:12, alignItems:'center', marginBottom:6, flexWrap:'wrap' }}>
        <span style={{ opacity:.85 }}>{wsInfo}</span>
        {livePrice !== null && <span style={{ opacity:.95 }}>• Price {livePrice}</span>}
        {err && <span style={{ color:'#f87171' }}>• {err}</span>}
      </div>
      <div
        ref={wrapRef}
        style={{
          width: '100%',
          height: 'clamp(360px, 65vh, 740px)',
          border: '1px solid #1b1b1b',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      />
    </div>
  );
}
