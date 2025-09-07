'use client';
import React from 'react';

type Exchange = 'binance'|'mexc';
type Market = 'spot'|'futures';

type SymbolInfo = {
  exchange: Exchange;
  market: Market;
  symbol: string;
  base: string;
  quote: string;
  status: string;
};

export default function Watchlist(props: {
  exchange?: Exchange;
  market?: Market;
  quote?: string;
  onSelect?: (symbol: string) => void;
}) {
  const ex: Exchange = (props.exchange ?? 'binance');
  const mk: Market = (props.market ?? 'spot');
  const quote = (props.quote ?? 'USDT').toUpperCase();

  const exq = ex.toLowerCase();
  const mkq = mk.toLowerCase();

  const [symbols, setSymbols] = React.useState<SymbolInfo[]>([]);
  const [prices, setPrices] = React.useState<Record<string, number>>({});
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetch(`/api/symbols?exchange=${exq}&market=${mkq}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        if (!alive) return;
        const list: SymbolInfo[] = (d.symbols || []).filter((s: SymbolInfo) => s.quote === quote);
        setSymbols(list);
        setLoading(false);
      })
      .catch(e => { if (alive) { setError(String(e)); setLoading(false); } });
    return () => { alive = false; };
  }, [exq, mkq, quote]);

  React.useEffect(() => {
    if (!symbols.length) return;
    let alive = true;
    const tick = async () => {
      try {
        const next: Record<string, number> = {};
        const batch = 40;
        for (let i = 0; i < symbols.length; i += batch) {
          const part = symbols.slice(i, i + batch);
          const res = await Promise.all(part.map(s =>
            fetch(`/api/ticker?exchange=${s.exchange}&market=${s.market}&symbol=${s.symbol}`, { cache: 'no-store' })
              .then(r => r.json()).then(d => ({ sym: s.symbol, price: Number(d.price) })).catch(() => ({ sym: s.symbol, price: NaN }))
          ));
          for (const r of res) next[r.sym] = r.price;
          if (!alive) return;
        }
        if (alive) setPrices(next);
      } catch {}
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(id); };
  }, [symbols]);

  if (loading) return <div className="p-2 text-sm text-zinc-400">Loading watchlist…</div>;
  if (error) return <div className="p-2 text-sm text-red-400">Error: {error}</div>;

  return (
    <div className="h-full overflow-y-auto">
      <div className="sticky top-0 z-10 bg-black/70 backdrop-blur p-2 text-xs text-zinc-400">
        {ex.toUpperCase()} • {mk.toUpperCase()} • {symbols.length} pairs
      </div>
      <ul>
        {symbols.map(s => {
          const p = prices[s.symbol];
          return (
            <li key={`${s.exchange}:${s.market}:${s.symbol}`}
                className="px-3 py-2 hover:bg-zinc-900 cursor-pointer flex items-center justify-between"
                onClick={() => props.onSelect?.(s.symbol)}>
              <span className="text-zinc-200">{s.symbol}</span>
              <span className="text-zinc-400">{Number.isFinite(p) ? p : '—'}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
