'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type Props = {
  symbol: string;
  exchange: string;
  livePrice: number | null;
  lastSignal: any | null;
};

type Side = 'LONG' | 'SHORT';
type OpenPos = {
  side: Side; entry: number; qty: number; sl: number; tp: number; fee: number; t: number;
};

const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 8 });

export default function DemoTradePanel({ symbol, exchange, livePrice, lastSignal }: Props) {
  const [entry, setEntry] = useState(0);
  const [margin, setMargin] = useState(30);
  const [lev, setLev] = useState(30);
  const [fee, setFee] = useState(0.0004);   // taker per side
  const [slPct, setSlPct] = useState(10);
  const [tpPct, setTpPct] = useState(10);
  const [pos, setPos] = useState<OpenPos | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const userChangedEntry = useRef(false);

  // prefer signal.entry → livePrice (so entry never sits at 0)
  useEffect(() => {
    if (userChangedEntry.current) return;
    if (lastSignal?.entry)       { setEntry(Number(lastSignal.entry)); return; }
    if (livePrice && livePrice > 0) { setEntry(Number(livePrice)); return; }
  }, [symbol, lastSignal?.entry, livePrice]);

  function onEntryEdit(v: string) { userChangedEntry.current = true; setEntry(Number(v) || 0); }
  useEffect(() => { userChangedEntry.current = false; }, [symbol]);

  const notional = useMemo(() => margin * lev, [margin, lev]);
  const qty = useMemo(() => (entry > 0 ? notional / entry : 0), [notional, entry]);

  const longSL = useMemo(() => entry > 0 ? entry * (1 - slPct / 100) : 0, [entry, slPct]);
  const longTP = useMemo(() => entry > 0 ? entry * (1 + tpPct / 100) : 0, [entry, tpPct]);
  const shortSL = useMemo(() => entry > 0 ? entry * (1 + slPct / 100) : 0, [entry, slPct]);
  const shortTP = useMemo(() => entry > 0 ? entry * (1 - tpPct / 100) : 0, [entry, tpPct]);

  // adapt SL/TP% from lastSignal if available
  useEffect(() => {
    if (!lastSignal || !lastSignal.entry || !lastSignal.sl || !lastSignal.tp) return;
    const e = Number(lastSignal.entry);
    const slp = Math.abs((e - Number(lastSignal.sl)) / e) * 100;
    const tpp = Math.abs((Number(lastSignal.tp) - e) / e) * 100;
    if (slp > 0.01) setSlPct(Number(slp.toFixed(2)));
    if (tpp > 0.01) setTpPct(Number(tpp.toFixed(2)));
  }, [lastSignal?.entry, lastSignal?.sl, lastSignal?.tp]);

  function open(side: Side) {
    if (!(entry > 0 && qty > 0)) { setNote('Set entry (live price) first.'); return; }
    const openPos: OpenPos = {
      side, entry, qty,
      sl: side === 'LONG' ? longSL : shortSL,
      tp: side === 'LONG' ? longTP : shortTP,
      fee, t: Date.now(),
    };
    setPos(openPos);
    setNote(`Opened ${side} ${symbol} • Qty ${nf.format(qty)}`);
  }

  function closeAtLive() {
    if (!pos || !livePrice) return;
    const { pnlAbs } = pnlNow(pos, livePrice);
    const fees = (pos.entry * pos.qty * fee) + (livePrice * pos.qty * fee);
    const net = pnlAbs - fees;
    setNote(`Closed • PnL ${net >= 0 ? '+' : ''}${nf.format(net)} (fees ${nf.format(fees)})`);
    setPos(null);
  }

  function pnlNow(p: OpenPos, price: number) {
    const gross = p.side === 'LONG' ? (price - p.entry) * p.qty : (p.entry - price) * p.qty;
    const fees = (p.entry * p.qty * p.fee) + (price * p.qty * p.fee);
    const pnlAbs = gross - fees;
    const pnlPct = notional > 0 ? (pnlAbs / notional) * 100 : 0;
    return { pnlAbs, pnlPct };
  }

  const live = livePrice ?? 0;
  const showingEntry = entry || live || 0;
  const posPnL = pos && live ? pnlNow(pos, live) : null;

  return (
    <section className="rounded-xl border border-neutral-900 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">Live Trade (Demo)</div>
        <div className="text-xs opacity-70">{exchange.toUpperCase()} • {symbol} • Live {live ? nf.format(live) : '—'}</div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        <div className="rounded-lg border border-neutral-800 p-3">
          <div className="text-xs opacity-70">Entry</div>
          <input
            value={showingEntry ? String(showingEntry) : ''}
            onChange={(e)=>onEntryEdit(e.target.value)}
            placeholder="0.000000"
            className="mt-1 w-full rounded bg-[#0e0f12] px-2 py-1"
            inputMode="decimal"
          />
        </div>

        <div className="rounded-lg border border-neutral-800 p-3">
          <div className="text-xs opacity-70">Margin ($)</div>
          <input value={margin} onChange={(e)=>setMargin(Number(e.target.value)||0)} className="mt-1 w-full rounded bg-[#0e0f12] px-2 py-1" inputMode="decimal" />
        </div>

        <div className="rounded-lg border border-neutral-800 p-3">
          <div className="text-xs opacity-70">Leverage (x)</div>
          <input value={lev} onChange={(e)=>setLev(Number(e.target.value)||1)} className="mt-1 w-full rounded bg-[#0e0f12] px-2 py-1" inputMode="numeric" />
        </div>

        <div className="rounded-lg border border-neutral-800 p-3">
          <div className="text-xs opacity-70">Fee (taker / side)</div>
          <input value={fee} onChange={(e)=>setFee(Number(e.target.value)||0)} className="mt-1 w-full rounded bg-[#0e0f12] px-2 py-1" inputMode="decimal" />
        </div>

        <div className="rounded-lg border border-neutral-800 p-3">
          <div className="text-xs opacity-70">TP / SL (%)</div>
          <div className="mt-1 flex items-center gap-2">
            <input value={tpPct} onChange={(e)=>setTpPct(Number(e.target.value)||0)} className="w-full rounded bg-[#0e0f12] px-2 py-1" inputMode="decimal" />
            <span className="opacity-50">/</span>
            <input value={slPct} onChange={(e)=>setSlPct(Number(e.target.value)||0)} className="w-full rounded bg-[#0e0f12] px-2 py-1" inputMode="decimal" />
          </div>
        </div>
      </div>

      {/* Derived row */}
      <div className="mt-2 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <div className="rounded-lg border border-neutral-800 p-2">Qty <span className="float-right font-semibold">{nf.format(qty)}</span></div>
        <div className="rounded-lg border border-neutral-800 p-2">Notional <span className="float-right font-semibold">${nf.format(notional)}</span></div>
        <div className="rounded-lg border border-neutral-800 p-2">Long SL/TP <span className="float-right">{nf.format(longSL)} / {nf.format(longTP)}</span></div>
        <div className="rounded-lg border border-neutral-800 p-2">Short SL/TP <span className="float-right">{nf.format(shortSL)} / {nf.format(shortTP)}</span></div>
      </div>

      {/* Action buttons */}
      <div className="mt-3 flex flex-wrap gap-3">
        <button onClick={()=>open('LONG')} className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold hover:bg-green-600">Open Long</button>
        <button onClick={()=>open('SHORT')} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold hover:bg-red-600">Open Short</button>
        <button onClick={closeAtLive} disabled={!pos || !live} className="rounded-lg bg-neutral-800 px-4 py-2 text-sm hover:bg-neutral-700 disabled:opacity-50">
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
                PnL <span className="float-right font-semibold">{posPnL ? `${posPnL.pnlAbs >= 0 ? '+' : ''}${nf.format(posPnL.pnlAbs)}` : '—'}</span>
              </div>
              <div className={`${posPnL && posPnL.pnlAbs >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                PnL % <span className="float-right font-semibold">{posPnL ? `${posPnL.pnlPct >= 0 ? '+' : ''}${posPnL.pnlPct.toFixed(2)}%` : '—'}</span>
              </div>
              <div>Fee/side <span className="float-right">{pos.fee}</span></div>
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
