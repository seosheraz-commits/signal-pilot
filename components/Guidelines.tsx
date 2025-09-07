'use client';

import { useMemo, useState } from 'react';

export default function Guidelines({ interval }: { interval: string }) {
  const [balance, setBalance] = useState<number>(500);
  const [riskPct, setRiskPct] = useState<number>(2);
  const [lev, setLev] = useState<number>(3);

  const advice = useMemo(() => {
    // simple mapping for display
    const map: Record<string, { look: string; risk: 'High'|'Medium'|'Low' }> = {
      '1m':  { look: '15–30 minutes of data', risk: 'High' },
      '3m':  { look: '45–90 minutes of data', risk: 'High' },
      '5m':  { look: '1–2 hours of data',    risk: 'Medium' },
      '15m': { look: '4–6 hours of data',    risk: 'Medium' },
      '30m': { look: '6–12 hours of data',   risk: 'Medium' },
      '1h':  { look: '1–2 days of data',     risk: 'Low' },
      '4h':  { look: '3–5 days of data',     risk: 'Low' },
    };
    const m = map[interval] || map['5m'];
    const maxLev = interval === '1m' ? 5 : interval === '3m' ? 5 : interval === '5m' ? 10 : 10;
    const tradeRisk = (balance * (riskPct / 100));
    const position = tradeRisk * (lev || 1);
    return { ...m, maxLev, tradeRisk, position };
  }, [interval, balance, riskPct, lev]);

  return (
    <div className="rounded-xl border border-[#1b1b1b] p-3">
      <div className="font-semibold mb-2">Trading Recommendations</div>
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <div className="text-xs opacity-70">Account Balance</div>
          <input className="bg-[#0e0f12] border border-[#1b1b1b] rounded-lg px-2 py-1 w-32"
                 value={balance} onChange={e=>setBalance(Number(e.target.value)||0)} />
        </div>
        <div>
          <div className="text-xs opacity-70">Risk per Trade (%)</div>
          <input className="bg-[#0e0f12] border border-[#1b1b1b] rounded-lg px-2 py-1 w-24"
                 value={riskPct} onChange={e=>setRiskPct(Number(e.target.value)||0)} />
        </div>
        <div>
          <div className="text-xs opacity-70">Leverage (x)</div>
          <input className="bg-[#0e0f12] border border-[#1b1b1b] rounded-lg px-2 py-1 w-20"
                 value={lev} onChange={e=>setLev(Number(e.target.value)||0)} />
        </div>
      </div>

      <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3 mt-3 text-sm">
        <div className="rounded-lg border border-[#1b1b1b] p-2">
          <div className="opacity-70">Timeframe</div>
          <div className="font-medium">{interval}</div>
        </div>
        <div className="rounded-lg border border-[#1b1b1b] p-2">
          <div className="opacity-70">Analyze</div>
          <div className="font-medium">{advice.look}</div>
        </div>
        <div className="rounded-lg border border-[#1b1b1b] p-2">
          <div className="opacity-70">Risk Level</div>
          <div className="font-medium">{advice.risk}</div>
        </div>
        <div className="rounded-lg border border-[#1b1b1b] p-2">
          <div className="opacity-70">Recommended Leverage</div>
          <div className="font-medium">{Math.min(lev || 1, advice.maxLev)}x</div>
        </div>
        <div className="rounded-lg border border-[#1b1b1b] p-2">
          <div className="opacity-70">Position Size (est.)</div>
          <div className="font-medium">${advice.position.toFixed(2)}</div>
        </div>
        <div className="rounded-lg border border-[#1b1b1b] p-2">
          <div className="opacity-70">Max Risk</div>
          <div className="font-medium">${advice.tradeRisk.toFixed(2)}</div>
        </div>
      </div>

      <div className="mt-3 text-sm leading-relaxed">
        <div>💡 <b>Trading Guidelines</b></div>
        <ul className="list-disc ml-5 opacity-90">
          <li>For <b>{interval}</b> trading, monitor {advice.look} before entering.</li>
          <li>Never risk more than <b>2%</b> of account per trade.</li>
          <li>Use tighter stops for shorter timeframes.</li>
          <li>Higher leverage ⇒ higher risk — size down accordingly.</li>
          <li>Always plan exits (TP/SL) before you enter.</li>
        </ul>
      </div>
    </div>
  );
}
