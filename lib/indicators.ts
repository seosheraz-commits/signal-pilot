// lib/indicators.ts

export function sma(arr: number[], p: number): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    if (i >= p) sum -= arr[i - p];
    out.push(i >= p - 1 ? sum / p : arr[i]);
  }
  return out;
}

export function ema(arr: number[], p: number): number[] {
  const out: number[] = [];
  const k = 2 / (p + 1);
  let prev = arr[0] ?? 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i] * k + prev * (1 - k);
    out.push(v);
    prev = v;
  }
  return out;
}

export function rsi(closes: number[], p = 14): number[] {
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    gains.push(Math.max(0, ch));
    losses.push(Math.max(0, -ch));
  }
  const avgG = sma(gains, p);
  const avgL = sma(losses, p);
  const out: number[] = [50];
  for (let i = 0; i < avgG.length; i++) {
    const rs = (avgL[i] ?? 0) === 0 ? 100 : (avgG[i] ?? 0) / (avgL[i] || 1e-9);
    out.push(100 - 100 / (1 + rs));
  }
  while (out.length < closes.length) out.unshift(out[0]);
  return out.slice(0, closes.length);
}

export function macd(closes: number[], fast = 12, slow = 26, signal = 9) {
  const f = ema(closes, fast);
  const s = ema(closes, slow);
  const mac = f.map((v, i) => v - (s[i] ?? v));
  const sig = ema(mac, signal);
  const hist = mac.map((v, i) => v - (sig[i] ?? 0));
  return { mac, sig, hist };
}

export function atr(highs: number[], lows: number[], closes: number[], p = 14): number[] {
  const tr: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    tr.push(
      Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      )
    );
  }
  return sma(tr, p);
}

export function donchian(highs: number[], lows: number[], p = 20) {
  const upper: number[] = [];
  const lower: number[] = [];
  for (let i = 0; i < highs.length; i++) {
    const s = Math.max(0, i - p + 1);
    const e = i + 1;
    upper.push(Math.max(...highs.slice(s, e)));
    lower.push(Math.min(...lows.slice(s, e)));
  }
  return { upper, lower };
}

function rollingStd(arr: number[], p: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    const s = Math.max(0, i - p + 1);
    const win = arr.slice(s, i + 1);
    const m = win.reduce((a, b) => a + b, 0) / win.length;
    const v = win.reduce((a, b) => a + (b - m) ** 2, 0) / win.length;
    out.push(Math.sqrt(v));
  }
  return out;
}

export function bollingerBandwidth(closes: number[], p = 20, k = 2) {
  const mean = sma(closes, p);
  const sd = rollingStd(closes, p);
  const upper = mean.map((m, i) => m + k * (sd[i] ?? 0));
  const lower = mean.map((m, i) => m - k * (sd[i] ?? 0));
  const bbw = upper.map((u, i) => {
    const l = lower[i] ?? u;
    const m = mean[i] ?? u;
    return m ? (u - l) / m : 0;
  });
  return { upper, lower, mean, bbw };
}
