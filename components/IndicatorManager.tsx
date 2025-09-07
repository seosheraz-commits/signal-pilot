'use client';

type Overlays = {
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

type Props = {
  overlays: Overlays;
  onToggle: (key: keyof Overlays, value?: boolean) => void;
  onClose: () => void;
};

export default function IndicatorManager({ overlays, onToggle, onClose }: Props) {
  const items: Array<{ key: keyof Overlays; label: string; hint?: string }> = [
    { key: 'ema', label: 'EMAs', hint: 'EMA20/EMA50 trend context' },
    { key: 'bollinger', label: 'Bollinger Bands', hint: 'Volatility & squeezes' },
    { key: 'donchian', label: 'Donchian Channel', hint: 'High/Low channels' },
    { key: 'signalLevels', label: 'Signal Levels', hint: 'Entry/SL/TP lines' },
    { key: 'patterns', label: 'Patterns', hint: 'Basic pattern markers' },
    { key: 'channelSignals', label: 'Channel Signals', hint: 'Breakouts/touches' },
    { key: 'hud', label: 'HUD (Why/Confidence)', hint: 'Reasoning overlay' },
    { key: 'legend', label: 'Legend', hint: 'Overlay legend' },
    { key: 'nameEveryCandle', label: 'Name Every Candle', hint: 'Verbose labels' },
    { key: 'onBarReasons', label: 'On-bar Reasons (legacy)', hint: 'Legacy debug text' },
  ];

  function setAll(v: boolean) {
    items.forEach(it => onToggle(it.key, v));
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <button
        aria-label="Close"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      {/* Panel */}
      <div className="relative w-full max-w-xl rounded-2xl border border-neutral-800 bg-[#0b0b0b] p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-base font-semibold">Indicators</div>
          <div className="flex items-center gap-2">
            <button
              className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-900"
              onClick={() => setAll(true)}
            >
              Select all
            </button>
            <button
              className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-900"
              onClick={() => setAll(false)}
            >
              Clear all
            </button>
            <button
              className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-900"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {items.map(({ key, label, hint }) => {
            const checked = overlays[key];
            return (
              <label
                key={String(key)}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-800 p-3 hover:bg-[#0e0f12]"
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={!!checked}
                  onChange={(e) => onToggle(key, e.target.checked)}
                />
                <span>
                  <div className="text-sm font-medium">{label}</div>
                  {hint && <div className="text-xs opacity-60">{hint}</div>}
                </span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}
