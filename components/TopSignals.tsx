// components/TopSignals.tsx
'use client';
import React from 'react';

export type Mode = 'strong'|'balanced'|'wide'|'all';
export type Exchange = 'binance'|'mexc'|'both';
export type Market = 'spot'|'futures'|'both';

export type Pick = {
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

type Source = 'auto' | 'engine' | 'builtin';

export default function TopSignals({
  mode = 'strong',
  exchange = 'both',
  market = 'both',
  interval = '5m',
  auto = true,
  source = 'auto',
  onSelect,
}: {
  mode?: Mode;
  exchange?: Exchange;
  market?: Market;
  interval?: string;
  auto?: boolean;
  source?: Source;
  onSelect?: (p: Pick) => void;
}) {
  const [picks, setPicks] = React.useState<Pick[]>([]);
  const [err, setErr] = React.useState<string | null>(null);
  const [ts, setTs] = React.useState<Date | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [used, setUsed] = React.useState<Source>('builtin');

  const run = React.useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      let data: any = null;
      let usedSource: Source = 'builtin';

      // 1) Try ENGINE if allowed
      if (source !== 'builtin') {
        const engUrl = `/api/engine/scan?interval=${interval}&market=${market}`;
        try {
          const r = await fetch(engUrl, { cache: 'no-store' });
          const d = await r.json();
          if (!d.error && Array.isArray(d.picks)) {
            data = d;
            usedSource = 'engine';
          }
        } catch { /* fall back */ }
      }

      // 2) Fallback to BUILTIN if needed
      if ((!data || !Array.isArray(data.picks)) && source !== 'engine') {
        const url = `/api/top-signals?mode=${mode}&exchange=${exchange}&market=${market}&interval=${interval}&cap=400`;
        const r = await fetch(url, { cache: 'no-store' });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        data = d;
        usedSource = 'builtin';
      }

      let out: Pick[] = (data?.picks || []).map((p: any) => ({
        exchange: String(p.exchange || '').toLowerCase() === 'mexc' ? 'mexc' : 'binance',
        market:   String(p.market   || '').toLowerCase().includes('fut') ? 'futures' : 'spot',
        symbol:   String(p.symbol || ''),
        side:     String(p.side   || '').toLowerCase() === 'short' ? 'short' : 'long',
        confidencePercent: Number(p.confidencePercent ?? 0),
        riskPercent:       Number(p.riskPercent ?? 0),
        entry: Number(p.entry ?? p.price ?? 0),
        stop:  Number(p.stop  ?? p.stopLoss ?? 0),
        tp:    Number(p.tp    ?? p.takeProfit ?? 0),
        reason: String(p.reason || p.reasoning || p.note || ''),
      }));

      // Client-side filter for user-chosen exchange/market
      if (exchange !== 'both') out = out.filter(p => p.exchange === exchange);
      if (market   !== 'both') out = out.filter(p => p.market   === market);

      setPicks(out);
      setTs(new Date());
      setUsed(usedSource);
    } catch (e: any) {
      setErr(String(e?.message || e));
      setPicks([]);
    } finally {
      setBusy(false);
    }
  }, [mode, exchange, market, interval, source]);

  React.useEffect(() => {
    run();
    if (!auto) return;
    const id = setInterval(run, 90_000);
    return () => clearInterval(id);
  }, [run, auto]);

  return (
    <div className="rounded-xl border border-zinc-800 p-3 bg-black/30">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold text-zinc-100">Top Signals</h3>
        <div className="text-xs text-zinc-400">
          {used === 'engine' ? `Engine` : `Mode ${mode}`} • {ts ? ts.toLocaleTimeString() : '—'}
        </div>
      </div>

      {err && <div className="mb-3 text-sm text-red-400">Failed: {err}</div>}

      {picks.length === 0 && !err && (
        <div className="text-sm text-zinc-300">WAIT • No qualified signals right now</div>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        {picks.map((p) => (
          <button
            key={`${p.exchange}:${p.market}:${p.symbol}`}
            onClick={() => onSelect?.(p)}
            className="rounded-lg border border-zinc-800 p-3 text-left hover:bg-zinc-900/40"
            type="button"
          >
            <div className="text-sm text-zinc-400">
              {p.exchange.toUpperCase()} • {p.market.toUpperCase()}
            </div>
            <div className="text-lg font-semibold text-zinc-100">
              {p.symbol} • {p.side.toUpperCase()}
            </div>
            <div className="mt-1 text-xs text-zinc-400">{p.reason}</div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
              <div>
                <div className="text-xs text-zinc-500">Conf</div>
                {p.confidencePercent}%
              </div>
              <div>
                <div className="text-xs text-zinc-500">Risk</div>
                {p.riskPercent}%
              </div>
              <div>
                <div className="text-xs text-zinc-500">Live</div>
                {p.entry}
              </div>
              <div>
                <div className="text-xs text-zinc-500">Entry</div>
                {p.entry}
              </div>
              <div>
                <div className="text-xs text-zinc-500">SL</div>
                {p.stop}
              </div>
              <div>
                <div className="text-xs text-zinc-500">TP</div>
                {p.tp}
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="mt-3">
        <button
          onClick={run}
          disabled={busy}
          className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 disabled:opacity-50"
        >
          {busy ? 'Scanning…' : 'Refresh now'}
        </button>
      </div>
    </div>
  );
}
