"use client";
import { useState } from "react";

export default function ExchangeBar({
  onFilter,
  onTfChange,
}: {
  onFilter?: (q: string) => void;
  onTfChange?: (tf: string) => void;
}) {
  const [q, setQ] = useState("");
  const [tf, setTf] = useState("5m");

  return (
    <section className="w-full">
      <h2 className="h2">Exchange</h2>

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card">
          <div className="text-xs text-neutral-400">Exchange</div>
          <div className="mt-1">Binance</div>
        </div>

        <div className="card">
          <div className="text-xs text-neutral-400">Quotes</div>
          <div className="mt-1">USDT</div>
        </div>

        <div className="card">
          <div className="text-xs text-neutral-400">Filter</div>
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              onFilter?.(e.target.value);
            }}
            placeholder="Type & Enter (e.g. BTC, ETH, AI…)"
            className="input mt-1"
          />
        </div>

        <div className="card">
          <div className="text-xs text-neutral-400">TF</div>
          <div className="mt-1 flex gap-2">
            <button
              className={`px-3 py-1 rounded-lg border ${tf==="5m" ? "border-white" : "border-neutral-800"}`}
              onClick={() => { setTf("5m"); onTfChange?.("5m"); }}
            >
              5m
            </button>
          </div>
          <div className="mt-3 text-xs text-neutral-400">Close Tuning • Overlays & Annotations</div>
        </div>
      </div>
    </section>
  );
}
