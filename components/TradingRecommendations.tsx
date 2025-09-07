"use client";

export default function TradingRecommendations({
  items = [],
}: {
  items?: Array<{ symbol: string; note: string }>;
}) {
  if (!items.length) {
    items = [
      { symbol: "BTCUSDT", note: "EMA fast > slow, RSI 48→55. Only cautious scalps. Tight SL." },
      { symbol: "ETHUSDT", note: "BB squeeze forming. Wait for break + volume. No trade until breakout." },
    ];
  }
  return (
    <section className="w-full">
      <h2 className="h2">Trading Recommendations</h2>
      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map((x, i) => (
          <div key={i} className="card">
            <div className="font-medium">{x.symbol}</div>
            <div className="text-sm text-neutral-300 mt-1">{x.note}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
