'use client';
import React from 'react';

type Mode = 'strong'|'balanced'|'wide'|'all';
type Exchange = 'binance'|'mexc'|'both';
type Market = 'spot'|'futures'|'both';

type Pick = {
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
};

export default function TopSignals({
  mode = 'strong',
  exchange = 'both',
  market = 'both',
  interval = '5m',
  auto = true
}: {
  mode?: Mode, exchange?: Exchange, market?: Market, interval?: string, auto?: boolean
}) {
  const [picks, setPicks] = React.useState<Pick[]>([]);
  const [err, setErr] = React.useState<string | null>(null);
  const [ts, setTs] = React.useState<Date | null>(null);
  const [busy, setBusy] = React.useState(false);

  const run = React.useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const url = `/api/top-signals?mode=${mode}&exchange=${exchange}&market=${market}&interval=${interval}&cap=400`;
      const r = await fetch(url, { cache: 'no-store' });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setPicks(d.picks || []);
      setTs(new Date());
    } catch (e: any) {
      setErr(String(e?.message || e));
      setPicks([]);
    } finally {
      setBusy(false);
    }
  }, [mode, exchange, market, interval]);

  React.useEffect(() => {
    run();
    if (!auto) return;
    const id = setInterval(run, 90_000);
    return () => clearInterval(id);
  }, [run, auto]);

  return (
    <div className="rounded-xl border border-zinc-800 p-3 bg-black/30">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-zinc-100 font-semibold">Top Signals</h3>
        <div className="text-xs text-zinc-400">
          Mode {mode} • {ts ? ts.toLocaleTimeString() : '—'}
        </div>
      </div>

      {err && <div className="mb-3 text-sm text-red-400">Failed: {err}</div>}

      {picks.length === 0 && !err && (
        <div className="text-zinc-300 text-sm">WAIT • No qualified signals right now</div>
      )}

      <div className="grid md:grid-cols-3 gap-3">
        {picks.map((p) => (
          <div key={`${p.exchange}:${p.market}:${p.symbol}`}
               className="rounded-lg border border-zinc-800 p-3">
            <div className="text-sm text-zinc-400">{p.exchange.toUpperCase()} • {p.market.toUpperCase()}</div>
            <div className="text-lg text-zinc-100 font-semibold">{p.symbol} • {p.side.toUpperCase()}</div>
            <div className="text-xs text-zinc-400 mt-1">{p.reason}</div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
              <div><div className="text-zinc-500 text-xs">Conf</div>{p.confidencePercent}%</div>
              <div><div className="text-zinc-500 text-xs">Risk</div>{p.riskPercent}%</div>
              <div><div className="text-zinc-500 text-xs">Live</div>{p.entry}</div>
              <div><div className="text-zinc-500 text-xs">Entry</div>{p.entry}</div>
              <div><div className="text-zinc-500 text-xs">SL</div>{p.stop}</div>
              <div><div className="text-zinc-500 text-xs">TP</div>{p.tp}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3">
        <button onClick={run} disabled={busy} className="px-3 py-1.5 rounded-md bg-zinc-800 text-zinc-100 text-sm">
          {busy ? 'Scanning…' : 'Refresh now'}
        </button>
      </div>
    </div>
  );
}
