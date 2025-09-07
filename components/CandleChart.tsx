// components/CandleChart.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { ema, rsi, macd, atr, donchian, bollingerBandwidth } from '../lib/indicators';
import { detectPattern, candleName, type Bar as PatBar } from '../lib/patterns';
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

/* ---------- CSS variables helper (w/ fallbacks) ---------- */
function css(name: string, fallback: string) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

/* ---------- Exchange fetchers (spot + futures) ---------- */
async function fetchKlines(ex: Exchange, mk: Market, sym: string, tf: string, limit = 500): Promise<Bar[]> {
  if (ex === 'binance') {
    const base = mk === 'futures' ? 'https://fapi.binance.com' : 'https://api.binance.com';
    const url = `${base}/api/v3/klines?symbol=${encodeURIComponent(sym)}&interval=${encodeURIComponent(tf)}&limit=${limit}`;
    const r = await fetch(url, { cache: 'no-store' });
    const arr = await r.json();
    if (!Array.isArray(arr)) throw new Error('klines bad');
    return arr.map((k: any) => ({ time: Math.floor(+k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4] }));
  }
  // MEXC
  if (mk === 'spot') {
    const url = `https://api.mexc.com/api/v3/klines?symbol=${encodeURIComponent(sym)}&interval=${encodeURIComponent(tf)}&limit=${limit}`;
    const r = await fetch(url, { cache: 'no-store' });
    const arr = await r.json();
    if (!Array.isArray(arr)) throw new Error('klines bad');
    return arr.map((k: any) => ({ time: Math.floor(+k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4] }));
  } else {
    const pair = sym.endsWith('USDT') ? sym.replace('USDT', '_USDT') : sym;
    const code = (MEXC_FUTURES_MAP as any)[tf] || 'Min5';
    async function get(url: string) {
      const r = await fetch(url, { cache: 'no-store' });
      const d = await r.json();
      return Array.isArray(d?.data) ? d.data : d;
    }
    let data: any[] = [];
    try {
      data = await get(`https://contract.mexc.com/api/v1/contract/kline?symbol=${pair}&interval=${code}&limit=${limit}`);
    } catch {
      data = await get(`https://contract.mexc.com/api/v1/contract/kline/${pair}?interval=${code}&limit=${limit}`);
    }
    return (data || []).map((k: any) => ({ time: Math.floor(+k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4] }));
  }
}

async function fetchTicker(ex: Exchange, mk: Market, sym: string): Promise<number | null> {
  try {
    if (ex === 'binance') {
      const base = mk === 'futures' ? 'https://fapi.binance.com' : 'https://api.binance.com';
      const r = await fetch(`${base}/api/v3/ticker/price?symbol=${encodeURIComponent(sym)}`, { cache: 'no-store' });
      const j = await r.json();
      return Number(j?.price ?? 0) || null;
    }
    if (mk === 'spot') {
      const r = await fetch(`https://api.mexc.com/api/v3/ticker/price?symbol=${encodeURIComponent(sym)}`, { cache: 'no-store' });
      const j = await r.json();
      return Number(j?.price ?? 0) || null;
    } else {
      const r = await fetch('https://contract.mexc.com/api/v1/contract/ticker', { cache: 'no-store' });
      const d = await r.json();
      const arr = Array.isArray(d?.data) ? d.data : [];
      const target = arr.find((t: any) => String(t?.symbol || '') === sym.replace('USDT', '_USDT'));
      const p = Number(target?.lastPrice ?? target?.fairPrice ?? target?.indexPrice ?? 0);
      return p || null;
    }
  } catch { return null; }
}

// lightweight fallback patterns so HUD never shows “neutral” forever
function fallbackPattern(prev?: Bar, cur?: Bar) {
  if (!prev || !cur) return { name: '', dir: 0 as 0 | 1 | -1 };
  const body = Math.abs(cur.close - cur.open);
  const range = cur.high - cur.low;
  const up = cur.high - Math.max(cur.close, cur.open);
  const dn = Math.min(cur.close, cur.open) - cur.low;
  if (cur.close > cur.open && prev.close < prev.open && cur.close >= prev.open && cur.open <= prev.close)
    return { name: 'Bull Engulf', dir: 1 };
  if (cur.close < cur.open && prev.close > prev.open && cur.open >= prev.close && cur.close <= prev.open)
    return { name: 'Bear Engulf', dir: -1 };
  if (dn > 2 * body && dn / (range || 1) > 0.6) return { name: 'Hammer', dir: 1 };
  if (up > 2 * body && up / (range || 1) > 0.6) return { name: 'Shooting Star', dir: -1 };
  if (body / (range || 1) < 0.1) return { name: 'Doji', dir: 0 };
  return { name: '', dir: 0 };
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

  const ema20Ref = useRef<any>(null);
  const ema50Ref = useRef<any>(null);
  const bbURef = useRef<any>(null);
  const bbMRef = useRef<any>(null);
  const bbLRef = useRef<any>(null);
  const donURef = useRef<any>(null);
  const donLRef = useRef<any>(null);

  const entryLineRef = useRef<any>(null);
  const slLineRef = useRef<any>(null);
  const tpLineRef = useRef<any>(null);
  const liveLineRef = useRef<any>(null);
  const supportLineRef = useRef<any>(null);
  const resistanceLineRef = useRef<any>(null);

  const wsKlineRef = useRef<WebSocket | null>(null);
  const wsTradeRef = useRef<WebSocket | null>(null);
  const pollKlinesRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const barsRef = useRef<Bar[]>([]);
  const markersRef = useRef<any[]>([]);

  // HUD state
  const [sig, setSig] = useState<Signal | null>(null);
  const [patternTape, setPatternTape] = useState<string[]>([]);
  const [lastPattern, setLastPattern] = useState<string>('—');
  const [lastCandleName, setLastCandleName] = useState<string>('—');
  const [wsInfo, setWsInfo] = useState('WS: -');
  const [clock, setClock] = useState('--:--:--');
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [freezeUntil, setFreezeUntil] = useState<number>(0);

  useEffect(() => {
    const id = setInterval(() => setClock(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(id);
  }, []);

  // freeze Entry/SL/TP for 5s when symbol changes
  useEffect(() => {
    setFreezeUntil(Date.now() + 5000);
  }, [symbol]);

  function setLivePriceLine(p: number) {
    setLivePrice(p);
    onLivePrice?.(p);
    try { if (liveLineRef.current) seriesRef.current?.removePriceLine(liveLineRef.current); } catch {}
    liveLineRef.current = seriesRef.current?.createPriceLine({
      price: p,
      color: css('--live', '#60a5fa'),
      lineWidth: 1,
      title: `Live ${p.toFixed(6)}`
    });
  }

  function computeAndDecorate(hotPrice?: number) {
    const b = barsRef.current;
    if (b.length < Math.max(60, config.donchianLen + 30)) return;

    const i = b.length - 1;
    const closedIdx = hotPrice ? i - 1 : i;
    const closes = b.map((x) => x.close);
    const highs = b.map((x) => x.high);
    const lows = b.map((x) => x.low);
    if (hotPrice && i >= 0) closes[i] = hotPrice;

    const e20 = ema(closes, 20);
    const e50 = ema(closes, 50);
    const r = rsi(closes, 14);
    const m = macd(closes);
    const dch = donchian(highs, lows, config.donchianLen);
    const { upper: bbU, lower: bbL, mean: bbM, bbw } = bollingerBandwidth(closes, 20, 2);
    const _atr = atr(highs, lows, closes, 14);
    const c = closes[i];

    // votes
    const trend =
      e20[i] != null && e50[i] != null
        ? e20[i] > e50[i] && c > e20[i]
          ? 1
          : e20[i] < e50[i] && c < e20[i]
          ? -1
          : 0
        : 0;

    const rsiState = r[i] != null ? (r[i] > config.rsiUpper ? 1 : r[i] < config.rsiLower ? -1 : 0) : 0;
    const macDelta = m.mac[i] != null && m.sig[i] != null ? m.mac[i] - m.sig[i] : 0;
    const macState = macDelta > 0 ? 1 : macDelta < 0 ? -1 : 0;
    const momentum = rsiState !== 0 && macState === rsiState ? rsiState : 0;

    const buf = config.breakoutBufferPct / 100;
    const chU = dch.upper[i] != null ? dch.upper[i] * (1 + buf) : Infinity;
    const chL = dch.lower[i] != null ? dch.lower[i] * (1 - buf) : -Infinity;
    const channel = c > chU ? 1 : c < chL ? -1 : 0;

    // last CLOSED bar for naming/patterns
    let patName = '—',
      patDir: -1 | 0 | 1 = 0,
      canName = '—';
    if (closedIdx >= 1) {
      const libPat = detectPattern(b as unknown as PatBar[], closedIdx);
      if (libPat) {
        patName = libPat.name;
        patDir = libPat.dir === 'bull' ? 1 : libPat.dir === 'bear' ? -1 : 0;
      } else {
        const fb = fallbackPattern(b[closedIdx - 1], b[closedIdx]);
        if (fb.name) {
          patName = fb.name;
          patDir = fb.dir as -1 | 0 | 1;
        }
      }
      canName = candleName(b[closedIdx] as unknown as PatBar) || '—';
      if (!hotPrice) setPatternTape((t) => [patName, ...t].slice(0, 6));
    }
    setLastPattern(patName);
    setLastCandleName(canName);

    const regime = bbw[i] != null && bbw[i] >= config.bbwMin ? 1 : -1;

    const w = config.weights;
    const score = trend * w.trend + momentum * w.momentum + channel * w.breakout + patDir * w.pattern + regime * w.regime;

    const votes = [trend, momentum, channel, patDir];
    const posVotes = votes.filter((v) => v > 0).length;
    const negVotes = votes.filter((v) => v < 0).length;

    let label: Signal['label'] = 'No Trade';
    if (posVotes >= 2) label = 'Long';
    if (negVotes >= 2) label = 'Short';

    const strong = Math.abs(score) >= Math.max(Math.abs(config.longScore), Math.abs(config.shortScore)) * 0.9;
    if (label === 'No Trade' && strong && regime > 0) label = score > 0 ? 'Long' : 'Short';
    if (label !== 'No Trade' && regime < 0 && channel === 0 && patDir === 0) label = 'No Trade';

    const sumW = Math.max(
      1,
      Math.abs(w.trend) + Math.abs(w.momentum) + Math.abs(w.breakout) + Math.abs(w.pattern) + Math.abs(w.regime),
    );
    const confVotes = (label === 'Long' ? posVotes : label === 'Short' ? negVotes : 0) / 4;
    const confScore = Math.min(1, Math.abs(score) / sumW);
    const confidence = Math.round(100 * (0.6 * confVotes + 0.4 * confScore));

    const a = _atr[i] || 0;
    const entry = c;
    const sl = label === 'Long' ? c - config.slATR * a : label === 'Short' ? c + config.slATR * a : c;
    const tp = label === 'Long' ? c + config.tpATR * a : label === 'Short' ? c - config.tpATR * a : c;

    const riskPct = Number((((Math.abs(entry - sl) / (entry || 1)) * 100) || 0).toFixed(2));
    const rb = config.riskBands;
    const riskBand: 'Low' | 'Medium' | 'High' = riskPct <= rb.lowMax ? 'Low' : riskPct <= rb.medMax ? 'Medium' : 'High';

    const reasons: string[] = [
      `Trend ${trend} (EMA20/50 + price)`,
      `Momentum ${momentum} (RSI ${config.rsiLower}/${config.rsiUpper} + MACD)`,
      channel === 1 ? `Channel Breakout +${config.breakoutBufferPct}%` : channel === -1 ? `Channel Breakdown +${config.breakoutBufferPct}%` : `Inside Channel`,
      patDir === 1 ? 'Pattern Bull' : patDir === -1 ? 'Pattern Bear' : 'Pattern Neutral',
      regime > 0 ? `Regime OK (BBW ${bbw[i]?.toFixed(3) ?? '—'})` : `Regime weak (BBW ${bbw[i]?.toFixed(3) ?? '—'})`,
    ];

    // fakeout detection
    if (i >= 2 && dch.upper[i - 1] && dch.lower[i - 1]) {
      const cPrev = closes[i - 1];
      const brokeUp = cPrev > dch.upper[i - 1] * (1 + config.breakoutBufferPct / 100);
      const brokeDn = cPrev < dch.lower[i - 1] * (1 - config.breakoutBufferPct / 100);
      const insideNow = closes[i] < (dch.upper[i] ?? Infinity) && closes[i] > (dch.lower[i] ?? -Infinity);
      if (insideNow && brokeUp) reasons.push('Bull Fakeout (rejection)');
      if (insideNow && brokeDn) reasons.push('Bear Fakeout (reclaim)');
    }

    // freeze Entry/SL/TP for 5s after symbol changes
    let entryF = entry,
      slF = sl,
      tpF = tp;
    if (Date.now() < freezeUntil && sig) {
      entryF = sig.entry;
      slF = sig.sl;
      tpF = sig.tp;
    }

    const signal: Signal = { label, confidence, entry: entryF, sl: slF, tp: tpF, riskPct, riskBand, reasons };

    setSig(signal);
    // push up
    (typeof onSignal === 'function') && onSignal(signal);

    // overlays
    if (config.overlays.ema) {
      ema20Ref.current?.setData(e20.map((v, j) => ({ time: b[j].time, value: v })));
      ema50Ref.current?.setData(e50.map((v, j) => ({ time: b[j].time, value: v })));
    } else {
      ema20Ref.current?.setData([]); ema50Ref.current?.setData([]);
    }
    if (config.overlays.bollinger) {
      bbURef.current?.setData(bbU.map((v, j) => ({ time: b[j].time, value: v })));
      bbMRef.current?.setData(bbM.map((v, j) => ({ time: b[j].time, value: v })));
      bbLRef.current?.setData(bbL.map((v, j) => ({ time: b[j].time, value: v })));
    } else {
      bbURef.current?.setData([]); bbMRef.current?.setData([]); bbLRef.current?.setData([]);
    }
    if (config.overlays.donchian) {
      donURef.current?.setData(dch.upper.map((v, j) => ({ time: b[j].time, value: v })));
      donLRef.current?.setData(dch.lower.map((v, j) => ({ time: b[j].time, value: v })));
    } else {
      donURef.current?.setData([]); donLRef.current?.setData([]);
    }

    // entry/sl/tp lines
    if (config.overlays.signalLevels && (label === 'Long' || label === 'Short')) {
      try { if (entryLineRef.current) seriesRef.current?.removePriceLine(entryLineRef.current); } catch {}
      try { if (slLineRef.current) seriesRef.current?.removePriceLine(slLineRef.current); } catch {}
      try { if (tpLineRef.current) seriesRef.current?.removePriceLine(tpLineRef.current); } catch {}
      entryLineRef.current = seriesRef.current?.createPriceLine({
        price: entryF, color: css('--entry', '#facc15'), lineWidth: 2, title: `Entry ${entryF.toFixed(6)}`
      });
      slLineRef.current = seriesRef.current?.createPriceLine({
        price: slF, color: css('--sl', '#ef4444'), lineWidth: 2, title: `SL ${slF.toFixed(6)}`
      });
      tpLineRef.current = seriesRef.current?.createPriceLine({
        price: tpF, color: css('--tp', '#22c55e'), lineWidth: 2, title: `TP ${tpF.toFixed(6)}`
      });
    }

    // support / resistance from last 20 bars
    let recentHigh = -Infinity, recentLow = Infinity;
    const LBL = 20;
    for (let j = Math.max(0, b.length - LBL); j < b.length; j++) {
      recentHigh = Math.max(recentHigh, b[j].high);
      recentLow = Math.min(recentLow, b[j].low);
    }
    try { if (supportLineRef.current) seriesRef.current?.removePriceLine(supportLineRef.current); } catch {}
    try { if (resistanceLineRef.current) seriesRef.current?.removePriceLine(resistanceLineRef.current); } catch {}
    supportLineRef.current = seriesRef.current?.createPriceLine({
      price: recentLow, color: css('--support', '#06b6d4'), lineWidth: 1, title: `Support ${recentLow.toFixed(6)}`
    });
    resistanceLineRef.current = seriesRef.current?.createPriceLine({
      price: recentHigh, color: css('--resistance', '#a855f7'), lineWidth: 1, title: `Resistance ${recentHigh.toFixed(6)}`
    });

    // closed-bar markers
    if (!hotPrice && closedIdx >= 1) {
      const time = b[closedIdx].time;
      const markers = markersRef.current.slice(-300);
      if (config.overlays.patterns && patName !== '—') {
        markers.push({
          time,
          position: patDir === -1 ? 'aboveBar' : patDir === 1 ? 'belowBar' : 'inBar',
          color: patDir === -1 ? '#ef4444' : patDir === 1 ? '#22c55e' : '#e5e7eb',
          shape: patDir === -1 ? 'arrowDown' : patDir === 1 ? 'arrowUp' : 'circle',
          text: patName,
        });
      }
      if (config.overlays.nameEveryCandle) {
        const nm = canName;
        markers.push({
          time,
          position: nm === 'Bear' ? 'aboveBar' : nm === 'Bull' ? 'belowBar' : 'inBar',
          color: '#9ca3af',
          shape: nm === 'Bear' ? 'arrowDown' : nm === 'Bull' ? 'arrowUp' : 'circle',
          text: nm,
        });
      }
      markersRef.current = markers;
      seriesRef.current?.setMarkers(markers);
    }
  }

  useEffect(() => {
    let disposed = false;

    async function init() {
      setErr(null);

      // cleanup
      try { wsKlineRef.current?.close(); } catch {}
      try { wsTradeRef.current?.close(); } catch {}
      wsKlineRef.current = null;
      wsTradeRef.current = null;
      if (pollKlinesRef.current) { clearInterval(pollKlinesRef.current); pollKlinesRef.current = null; }
      if (pollTickerRef.current) { clearInterval(pollTickerRef.current); pollTickerRef.current = null; }
      if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }
      markersRef.current = [];
      barsRef.current = [];
      setPatternTape([]); setLastPattern('—'); setLastCandleName('—'); setSig(null); setLivePrice(null);
      setWsInfo(market === 'futures' && exchange === 'mexc' ? 'Poll: MEXC futures (2s klines + 1s price)' : 'WS: connecting…');

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

      // overlay series w/ CSS variable colors
      ema20Ref.current = chart.addLineSeries({ color: css('--ema20', '#f59e0b'), lineWidth: 1 });
      ema50Ref.current = chart.addLineSeries({ color: css('--ema50', '#eab308'), lineWidth: 1 });
      bbURef.current = chart.addLineSeries({ color: css('--bb', '#60a5fa'), lineWidth: 1 });
      bbMRef.current = chart.addLineSeries({ color: css('--bb-mid', '#93c5fd'), lineWidth: 1 });
      bbLRef.current = chart.addLineSeries({ color: css('--bb', '#60a5fa'), lineWidth: 1 });
      donURef.current = chart.addLineSeries({ color: css('--donchian', '#10b981'), lineWidth: 1 });
      donLRef.current = chart.addLineSeries({ color: css('--donchian', '#10b981'), lineWidth: 1 });

      // history
      try {
        const data = await fetchKlines(exchange as Exchange, market as Market, symbol, interval, 500);
        if (disposed) return;
        barsRef.current = data;
        series.setData(data);
        computeAndDecorate(); // closed-bar compute
      } catch (e: any) {
        setErr(e?.message || 'history failed');
        return;
      }

      // seed live
      const seed = await fetchTicker(exchange as Exchange, market as Market, symbol);
      if (seed) { setLivePriceLine(seed); computeAndDecorate(seed); }

      // live
      if (exchange === 'binance') {
        const host = market === 'futures' ? 'wss://fstream.binance.com/ws' : 'wss://stream.binance.com:9443/ws';
        const wsK = new WebSocket(`${host}/${symbol.toLowerCase()}@kline_${interval}`);
        wsKlineRef.current = wsK;
        wsK.onopen = () => { if (wsKlineRef.current === wsK) setWsInfo(`WS: live (${symbol})`); };
        wsK.onclose = () => { if (wsKlineRef.current === wsK) setWsInfo('WS: closed'); };
        wsK.onerror = () => { if (wsKlineRef.current === wsK) setWsInfo('WS: error'); };
        wsK.onmessage = (e) => {
          if (wsKlineRef.current !== wsK) return;
          const k = JSON.parse(e.data)?.k;
          if (!k) return;
          const bar: Bar = { time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c };
          if (k.x) {
            const arr = barsRef.current;
            const idx = arr.findIndex((x) => x.time === bar.time);
            if (idx >= 0) arr[idx] = bar; else arr.push(bar);
            series.setData(arr);
            computeAndDecorate(); // closed
          } else {
            series.update(bar);
            setLivePriceLine(bar.close);
            computeAndDecorate(bar.close); // live tick
          }
        };

        const wsT = new WebSocket(`${host}/${symbol.toLowerCase()}@trade`);
        wsTradeRef.current = wsT;
        wsT.onmessage = (e) => {
          if (wsTradeRef.current !== wsT) return;
          const p = Number(JSON.parse(e.data)?.p);
          if (p) { setLivePriceLine(p); computeAndDecorate(p); }
        };
      } else {
        // MEXC: poll (spot & futures)
        setWsInfo(market === 'futures' ? 'Poll: 2s + ticker 1s (futures)' : 'Poll: 2s + ticker 1s');
        let lastClosed = barsRef.current[barsRef.current.length - 1]?.time ?? 0;
        pollKlinesRef.current = setInterval(async () => {
          try {
            const arr = await fetchKlines(exchange as Exchange, market as Market, symbol, interval, 500);
            if (!arr.length) return;
            const latest = arr[arr.length - 1];
            barsRef.current = arr;
            series.setData(arr);
            if (latest.time !== lastClosed) {
              lastClosed = latest.time;
              computeAndDecorate();
            }
          } catch {}
        }, 2000);
        pollTickerRef.current = setInterval(async () => {
          const p = await fetchTicker(exchange as Exchange, market as Market, symbol);
          if (p) { setLivePriceLine(p); computeAndDecorate(p); }
        }, 1000);
      }
    }

    init();
    return () => {
      try { wsKlineRef.current?.close(); } catch {}
      try { wsTradeRef.current?.close(); } catch {}
      wsKlineRef.current = null; wsTradeRef.current = null;
      if (pollKlinesRef.current) clearInterval(pollKlinesRef.current);
      if (pollTickerRef.current) clearInterval(pollTickerRef.current);
      if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }
    };
  }, [exchange, market, symbol, interval, config]);

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{ opacity: 0.85 }}>{clock}</span>
        <span style={{ opacity: 0.85 }}>{wsInfo}</span>
        {livePrice !== null && <span style={{ opacity: 0.95 }}>• Price {livePrice}</span>}
        {err && <span style={{ color: '#f87171' }}>• {err}</span>}
      </div>

      <div
        ref={wrapRef}
        style={{
          width: '100%',
          height: 'clamp(360px, 65vh, 740px)',
          border: '1px solid #1b1b1b',
          borderRadius: 12,
          overflow: 'visible',
        }}
      />

      {/* legend bottom-left */}
      {config.overlays.legend && (
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            left: 14,
            background: 'rgba(10,10,10,.78)',
            border: '1px solid #1b1b1b',
            borderRadius: 10,
            padding: '8px 10px',
            pointerEvents: 'none',
            fontSize: 12,
            lineHeight: 1.4,
            zIndex: 5,
            maxWidth: '45vw',
          }}
        >
          <div><span style={{ background: '#f59e0b', display: 'inline-block', width: 10, height: 10, borderRadius: 2, marginRight: 6 }} />EMA20</div>
          <div><span style={{ background: '#eab308', display: 'inline-block', width: 10, height: 10, borderRadius: 2, marginRight: 6 }} />EMA50</div>
          <div><span style={{ background: '#60a5fa', display: 'inline-block', width: 10, height: 10, borderRadius: 2, marginRight: 6 }} />BB Upper/Lower</div>
          <div><span style={{ background: '#93c5fd', display: 'inline-block', width: 10, height: 10, borderRadius: 2, marginRight: 6 }} />BB Mid</div>
          <div><span style={{ background: '#10b981', display: 'inline-block', width: 10, height: 10, borderRadius: 2, marginRight: 6 }} />Donchian Upper/Lower</div>
          <div><span style={{ background: '#60a5fa', display: 'inline-block', width: 10, height: 2, marginRight: 6 }} />Live</div>
          <div><span style={{ background: '#facc15', display: 'inline-block', width: 10, height: 10, borderRadius: 2, marginRight: 6 }} />Entry</div>
          <div><span style={{ background: '#ef4444', display: 'inline-block', width: 10, height: 10, borderRadius: 2, marginRight: 6 }} />SL</div>
          <div><span style={{ background: '#22c55e', display: 'inline-block', width: 10, height: 10, borderRadius: 2, marginRight: 6 }} />TP</div>
          <div><span style={{ background: '#06b6d4', display: 'inline-block', width: 10, height: 10, borderRadius: 2, marginRight: 6 }} />Support</div>
          <div><span style={{ background: '#a855f7', display: 'inline-block', width: 10, height: 10, borderRadius: 2, marginRight: 6 }} />Resistance</div>
        </div>
      )}

      {/* HUD top-right */}
      {config.overlays.hud && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 6,
            background: 'rgba(10,10,10,.82)',
            border: '1px solid #1b1b1b',
            borderRadius: 10,
            padding: '8px 10px',
            maxWidth: 'min(92vw, 460px)',
            pointerEvents: 'none',
            fontSize: 13,
            wordBreak: 'break-word',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 2 }}>
            {sig ? `Signal: ${sig.label} • Confidence ${sig.confidence}%` : 'Signal: —'}
          </div>
          {sig && (
            <>
              <div style={{ opacity: 0.95 }}>
                Entry <span style={{ color: '#facc15', fontWeight: 600 }}>{sig.entry.toFixed(6)}</span> • SL{' '}
                <span style={{ color: '#ef4444', fontWeight: 600 }}>{sig.sl.toFixed(6)}</span> • TP{' '}
                <span style={{ color: '#22c55e', fontWeight: 600 }}>{sig.tp.toFixed(6)}</span>
              </div>
              <div style={{ opacity: 0.95, marginTop: 2 }}>
                Risk {sig.riskPct.toFixed(2)}% ({sig.riskBand})
              </div>
              <div style={{ opacity: 0.85, marginTop: 2 }}>{sig.reasons.join(' • ')}</div>
            </>
          )}
          <div style={{ opacity: 0.85, marginTop: 6 }}>
            <strong>Last candle:</strong> {lastCandleName} &nbsp;•&nbsp; <strong>Last pattern:</strong> {lastPattern}
          </div>
          {!!patternTape.length && (
            <div style={{ opacity: 0.85, marginTop: 4 }}>
              <strong>Recent patterns:</strong> {patternTape.join(' · ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
