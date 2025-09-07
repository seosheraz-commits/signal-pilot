// components/DemoTradePanel.tsx
'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

type Side = 'LONG' | 'SHORT';
type Exchange = 'binance' | 'mexc';
type Market = 'spot' | 'futures';

type OpenPos = {
  side: Side;
  entry: number;
  qty: number;
  sl: number;
  tp: number;
  fee: number; // taker fee per side (e.g., 0.0004 = 0.04%)
  t: number;   // opened at
};

type LastSignal = { entry?: number; sl?: number; tp?: number } | null;

type Props = {
  // Optional seeds from parent; panel still lets user change them
  symbol?: string;
  exchange?: Exchange;
  market?: Market;

  // Optional live price from parent; if omitted the panel polls /api/ticker
  livePrice?: number | null;

  // Optional signal to prefill entry / SL / TP
  lastSignal?: LastSignal;

  // Optional lifter
  onState?: (s: {
    exchange: Exchange;
    market: Market;
    symbol: string;
    live: number | null;
    pos: OpenPos | null;
  }) => void;
};

const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 8 });
const pf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

type SymbolRow = {
  exchange: Exchange;
  market: Market;
  symbol: string;
  base: string;
  quote: string;
  status?: string;
};

export default function DemoTradePanel(p: Props) {
  // Selectors (seed from props)
  const [exchange, setExchange] = useState<Exchange>(p.exchange || 'binance');
  const [market, setMarket] = useState<Market>(p.market || 'futures');
  const [symbol, setSymbol] = useState<string>(p.symbol || 'BTCUSDT');

  // Universe list
  const [universe, setUniverse] = useState<SymbolRow[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [search, setSearch] = useState('');

  // Live price
  const [live, setLive] = useState<number | null>(p.livePrice ?? null);

  // Trading inputs
  const [entry, setEntry] = useState(0);
  const [margin, setMargin] = useState(30);
  const [lev, setLev] = useState(30);
  const [fee, setFee] = useState(0.0004); // taker per side
  const [slPct, setSlPct] = useState(10);
  const [tpPct, setTpPct] = useState(10);

  // Position + UI
  const [pos, setPos] = useState<OpenPos | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const userChangedEntry = useRef(false);

  // Keep in sync if parent changes seeds
  useEffect(() => { if (p.exchange && p.exchange !== exchange) setExchange(p.exchange); }, [p.exchange]);
  useEffect(() => { if (p.market && p.market !== market) setMarket(p.market); }, [p.market]);
  useEffect(() => { if (p.symbol && p.symbol !== symbol) setSymbol(p.symbol); }, [p.symbol]);

  // Load combined symbol list (Binance+MEXC, Spot+Futures) from your /api/symbols
  useEffect(() => {
    let gone = false;
    const run = async () => {
      try {
        setLoadingList(true);
        const r = await fetch('/api/symbols?exchange=all&market=all', { cache: 'no-store' });
        const d = await r.json();
        const rows: SymbolRow[] = Array.isArray(d.symbols) ? d.symbols : [];
        const usdt = rows.filter(x => x.quote === 'USDT' && String(x.status || '').toUpperCase() !== 'OFFLINE');
        // Dedup key
        const key = (x: SymbolRow) => `${x.exchange}:${x.market}:${x.symbol}`;
        const map = new Map<string, SymbolRow>();
        for (const s of usdt) map.set(key(s), s);
        if (!gone) setUniverse(Array.from(map.values()));
      } catch {
        // ignore
      } finally {
        if (!gone) setLoadingList(false);
      }
    };
    run();
    return () => { gone = true; };
  }, []);

  // Prefer lastSignal.entry -> livePrice (prop) -> polled live
  useEffect(() => {
    if (userChangedEntry.current) return;
    if (p.lastSignal?.entry)      { setEntry(Number(p.lastSignal.entry)); return; }
    if (p.livePrice && p.livePrice > 0) { setEntry(Number(p.livePrice)); return; }
    if (live && live > 0)         { setEntry(live); return; }
  }, [symbol, p.lastSignal?.entry, p.livePrice, live]);

  const onEntryEdit = (v: string) => { userChangedEntry.current = true; setEntry(Number(v) || 0); };
  useEffect(() => { userChangedEntry.current = false; }, [symbol, exchange, market]);

  // Map lastSignal SL/TP into percentage sliders
  useEffect(() => {
    if (!p.lastSignal || !p.lastSignal.entry || !p.lastSignal.sl || !p.lastSignal.tp) return;
    const e = Number(p.lastSignal.entry);
    const slp = Math.abs((e - Number(p.lastSignal.sl)) / e) * 100;
    const tpp = Math.abs((Number(p.lastSignal.tp) - e) / e) * 100;
    if (slp > 0.01) setSlPct(Number(slp.toFixed(2)));
    if (tpp > 0.01) setTpPct(Number(tpp.toFixed(2)));
  }, [p.lastSignal?.entry, p.lastSignal?.sl, p.lastSignal?.tp]);

  // Sync live from parent if provided
  useEffect(() => { if (p.livePrice !== undefined) setLive(p.livePrice ?? null); }, [p.livePrice]);

  // Poll our own live price using /api/ticker (fallback to klines if needed)
  useEffect(() => {
    if (p.livePrice !== undefined) return; // parent controls
    let stop = false;
    const poll = async () => {
      try {
        const url = `/api/ticker?exchange=${exchange}&market=${market}&symbol=${symbol}`;
        const r = await fetch(url, { cache: 'no-store' });
        const d = await r.json();
        let price = Number(d?.price);
        if (!Number.isFinite(price)) {
          // fallback to klines last close
          const k = await fetch(`/api/klines?exchange=${exchange}&market=${market}&symbol=${symbol}&interval=1m&limit=1`, { cache: 'no-store' });
          const kd = await k.json();
          const candles = kd?.candles;
          if (Array.isArray(candles) && candles.length) price = Number(candles[candles.length - 1][4]);
        }
        if (!stop && Number.isFinite(price)) setLive(price);
      } catch {
        // ignore one-tick failures
      }
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => { stop = true; clearInterval(id); };
  }, [exchange, market, symbol, p.livePrice]);

  // Derived values
  const notional = useMemo(() => margin * lev, [margin, lev]);
  const qty = useMemo(() => (entry > 0 ? notional / entry : 0), [notional, entry]);

  const longSL = useMemo(() => entry > 0 ? entry * (1 - slPct / 100) : 0, [entry, slPct]);
  const longTP = useMemo(() => entry > 0 ? entry * (1 + tpPct / 100) : 0, [entry, tpPct]);
  const shortSL = useMemo(() => entry > 0 ? entry * (1 + slPct / 100) : 0, [entry, slPct]);
  const shortTP = useMemo(() => entry > 0 ? entry * (1 - tpPct / 100) : 0, [entry, tpPct]);

  function pnlNow(op: OpenPos, price: number) {
    const gross = op.side === 'LONG' ? (price - op.entry) * op.qty : (op.entry - price) * op.qty;
    const fees = (op.entry * op.qty * op.fee) + (price * op.qty * op.fee);
    const pnlAbs = gross - fees;
    const pnlPct = notional > 0 ? (pnlAbs / notional) * 100 : 0;
    return { pnlAbs, pnlPct, fees };
  }

  // Open/Close — entry is locked at the moment of opening
  function open(side: Side) {
    if (!(entry > 0 && qty > 0)) { setNote('Set entry (live) first.'); return; }
    const openPos: OpenPos = {
      side,
      entry, // locked
      qty,
      sl: side === 'LONG' ? longSL : shortSL,
      tp: side === 'LONG' ? longTP : shortTP,
      fee,
      t: Date.now(),
    };
    setPos(openPos);
    setNote(`Opened ${side} ${symbol} on ${exchange.toUpperCase()} ${market.toUpperCase()} • Qty ${nf.format(qty)}`);
  }

  function closeAtLive() {
    if (!pos || !live) return;
    const { pnlAbs, fees } = pnlNow(pos, live);
    const net = pnlAbs;
    setNote(`Closed • PnL ${net >= 0 ? '+' : ''}${nf.format(net)} (fees ${nf.format(fees)})`);
    setPos(null);
  }

  // Optional auto-close on SL/TP touches
  useEffect(() => {
    if (!pos || !live) return;
    if (pos.side === 'LONG' && (live <= pos.sl || live >= pos.tp)) closeAtLive();
    if (pos.side === 'SHORT' && (live >= pos.sl || live <= pos.tp)) closeAtLive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  // Lift state up if requested
  useEffect(() => { p.onState?.({ exchange, market, symbol, live, pos }); }, [exchange, market, symbol, live, pos]); // eslint-disable-line react-hooks/exhaustive-deps

  const posPnL = pos && live ? pnlNow(pos, live) : null;

  // Filter list by current exchange+market and search
  const filtered = useMemo(() => {
    const term = search.trim().toUpperCase();
    return universe
      .filter(x => x.exchange === exchange && x.market === market)
      .filter(x => !term || x.symbol.includes(term))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [universe, exchange, market, search]);

  // If exchange/market change and current symbol not in filtered, pick first available
  useEffect(() => {
    if (!filtered.length) return;
    const exists = filtered.some(s => s.symbol === symbol);
    if (!exists) setSymbol(filtered[0].symbol);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered.length, exchange, market]);

  return (
    <section className="rounded-xl border border-neutral-900 p-3">
      {/* Selection row */}
      <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-5">
        <div className="rounded-lg border border-neutral-800 p-3">
          <div className="text-xs opacity-70">Exchange</div>
          <select
            value={exchange}
            onChange={(e) => setExchange(e.target.value as Exchange)}
            className="mt-1 w-full rounded bg-[#0e0f12] px-2 py-1"
            disabled={!!pos}
          >
            <option value="binance">Binance</option>
            <option value="mexc">MEXC</option>
          </select>
        </div>

        <div className="rounded-lg border border-neutral-800 p-3">
          <div className="text-xs opacity-70">Market</div>
          <select
            value={market}
            onChange={(e) => setMarket(e.target.value as Market)}
            className="mt-1 w-full rounded bg-[#0e0f12] px-2 py-1"
            disabled={!!pos}
          >
            <option value="futures">Futures</option>
            <option value="spot">Spot</option>
          </select>
        </div>

        <div className="rounded-lg border border-neutral-800 p-3 md:col-span-2">
          <div className="text-xs opacity-70">Symbol</div>
          <div className="mt-1 flex gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search USDT pairs"
              className="w-full rounded bg-[#0e0f12] px-2 py-1"
              disabled={!!pos}
            />
            <select
              value={`${exchange}:${market}:${symbol}`}
              onChange={(e) => {
                const [, , sym] = e.target.value.split(':');
                setSymbol(sym);
              }}
              className="rounded bg-[#0e0f12] px-2 py-1 min-w-[180px]"
              disabled={!!pos}
            >
              {loadingList && <option>Loading…</option>}
              {!loadingList && filtered.map((s) => (
                <option key={`${s.exchange}:${s.market}:${s.symbol}`} value={`${s.exchange}:${s.market}:${s.symbol}`}>
                  {s.symbol}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="rounded-lg border border-neutral-800 p-3">
          <div className="text-xs opacity-70">Live</div>
          <div className="mt-1 font-semibold">{live ? nf.format(live) : '—'}</div>
          <div className="text-xs opacity-70 mt-0.5">
            {exchange.toUpperCase()} • {market.toUpperCase()}
          </div>
        </div>
      </div>

      {/* Planning row */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        <div className="rounded-lg border border-neutral-800 p-3">
          <div className="text-xs opacity-70">Entry (locks on open)</div>
          <input
            value={entry ? String(entry) : ''}
            onChange={(e) => onEntryEdit(e.target.value)}
            placeholder="0.000000"
            className="mt-1 w-full rounded bg-[#0e0f12] px-2 py-1"
            inputMode="decimal"
            disabled={!!pos}
          />
        </div>

        <div className="rounded-lg border border-neutral-800 p-3">
          <div className="text-xs opacity-70">Margin ($)</div>
          <input
            value={margin}
            onChange={(e) => setMargin(Number(e.target.value) || 0)}
            className="mt-1 w-full rounded bg-[#0e0f12] px-2 py-1"
            inputMode="decimal"
            disabled={!!pos}
          />
        </div>

        <div className="rounded-lg border border-neutral-800 p-3">
          <div className="text-xs opacity-70">Leverage (x)</div>
          <input
            value={lev}
            onChange={(e) => setLev(Number(e.target.value) || 1)}
            className="mt-1 w-full rounded bg-[#0e0f12] px-2 py-1"
            inputMode="numeric"
            disabled={!!pos}
          />
        </div>

        <div className="rounded-lg border border-neutral-800 p-3">
          <div className="text-xs opacity-70">Fee (taker / side)</div>
          <input
            value={fee}
            onChange={(e) => setFee(Number(e.target.value) || 0)}
            className="mt-1 w-full rounded bg-[#0e0f12] px-2 py-1"
            inputMode="decimal"
            disabled={!!pos}
          />
        </div>

        <div className="rounded-lg border border-neutral-800 p-3">
          <div className="text-xs opacity-70">TP / SL (%)</div>
          <div className="mt-1 flex items-center gap-2">
            <input
              value={tpPct}
              onChange={(e) => setTpPct(Number(e.target.value) || 0)}
              className="w-full rounded bg-[#0e0f12] px-2 py-1"
              inputMode="decimal"
              disabled={!!pos}
            />
            <span className="opacity-50">/</span>
            <input
              value={slPct}
              onChange={(e) => setSlPct(Number(e.target.value) || 0)}
              className="w-full rounded bg-[#0e0f12] px-2 py-1"
              inputMode="decimal"
              disabled={!!pos}
            />
          </div>
        </div>
      </div>

      {/* Derived row */}
      <div className="mt-2 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <div className="rounded-lg border border-neutral-800 p-2">
          Qty <span className="float-right font-semibold">{nf.format(qty)}</span>
        </div>
        <div className="rounded-lg border border-neutral-800 p-2">
          Notional <span className="float-right font-semibold">${nf.format(margin * lev)}</span>
        </div>
        <div className="rounded-lg border border-neutral-800 p-2">
          Long SL/TP <span className="float-right">{nf.format(longSL)} / {nf.format(longTP)}</span>
        </div>
        <div className="rounded-lg border border-neutral-800 p-2">
          Short SL/TP <span className="float-right">{nf.format(shortSL)} / {nf.format(shortTP)}</span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="mt-3 flex flex-wrap gap-3">
        <button
          onClick={() => open('LONG')}
          className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold hover:bg-green-600 disabled:opacity-50"
          disabled={!!pos}
        >
          Open Long
        </button>
        <button
          onClick={() => open('SHORT')}
          className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold hover:bg-red-600 disabled:opacity-50"
          disabled={!!pos}
        >
          Open Short
        </button>
        <button
          onClick={closeAtLive}
          disabled={!pos || !live}
          className="rounded-lg bg-neutral-800 px-4 py-2 text-sm hover:bg-neutral-700 disabled:opacity-50"
        >
          Close @ Live
        </button>
      </div>

      {/* Position + PnL */}
      <div className="mt-3 rounded-lg border border-neutral-800 p-3 text-sm">
        {pos ? (
          <>
            <div className="font-semibold">Open Position</div>
            <div className="mt-1 grid grid-cols-2 gap-2 md:grid-cols-4">
              <div>Side <span className="float-right font-semibold">{pos.side}</span></div>
              <div>Entry <span className="float-right font-semibold">{nf.format(pos.entry)}</span></div>
              <div>SL <span className="float-right">{nf.format(pos.sl)}</span></div>
              <div>TP <span className="float-right">{nf.format(pos.tp)}</span></div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
              <div>Live <span className="float-right">{live ? nf.format(live) : '—'}</span></div>
              <div className={`${posPnL && posPnL.pnlAbs >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                PnL <span className="float-right font-semibold">
                  {posPnL ? `${posPnL.pnlAbs >= 0 ? '+' : ''}${nf.format(posPnL.pnlAbs)}` : '—'}
                </span>
              </div>
              <div className={`${posPnL && posPnL.pnlAbs >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                PnL % <span className="float-right font-semibold">
                  {posPnL ? `${posPnL.pnlPct >= 0 ? '+' : ''}${pf.format(posPnL.pnlPct)}%` : '—'}
                </span>
              </div>
              <div>Fee/side <span className="float-right">{fee}</span></div>
            </div>
          </>
        ) : (
          <div className="opacity-70">No open position.</div>
        )}
      </div>

      {note && <div className="mt-2 text-xs opacity-70">{note}</div>}
    </section>
  );
}
