// lib/patterns.ts
export type Bar = { time: number; open: number; high: number; low: number; close: number };

function body(b: Bar) { return Math.abs(b.close - b.open); }
function range(b: Bar) { return b.high - b.low; }
function upperShadow(b: Bar) { return b.high - Math.max(b.open, b.close); }
function lowerShadow(b: Bar) { return Math.min(b.open, b.close) - b.low; }
function isGreen(b: Bar) { return b.close > b.open; }
function isRed(b: Bar) { return b.open > b.close; }

export function candleName(b: Bar): 'Doji' | 'Bull' | 'Bear' {
  const r = range(b);
  const bod = body(b);
  if (r > 0 && bod / r <= 0.1) return 'Doji';
  return isGreen(b) ? 'Bull' : 'Bear';
}

export type Pattern =
  | { name: 'Bullish Engulfing'; dir: 'bull' }
  | { name: 'Bearish Engulfing'; dir: 'bear' }
  | { name: 'Hammer'; dir: 'bull' }
  | { name: 'Shooting Star'; dir: 'bear' }
  | { name: 'Doji'; dir: 'neutral' };

export function detectPattern(bars: Bar[], i: number): Pattern | null {
  if (i <= 0 || i >= bars.length) return null;
  const p = bars[i - 1];
  const c = bars[i];

  const pr = range(p), pb = body(p);
  const cr = range(c), cb = body(c);
  if (pr === 0 || cr === 0) return null;

  // Doji (neutral)
  if (cb / cr <= 0.1) return { name: 'Doji', dir: 'neutral' };

  // Engulfing
  const bullEngulf =
    isRed(p) && isGreen(c) &&
    c.open <= p.close && c.close >= p.open &&
    cb > pb * 0.8;
  if (bullEngulf) return { name: 'Bullish Engulfing', dir: 'bull' };

  const bearEngulf =
    isGreen(p) && isRed(c) &&
    c.open >= p.close && c.close <= p.open &&
    cb > pb * 0.8;
  if (bearEngulf) return { name: 'Bearish Engulfing', dir: 'bear' };

  // Hammer / Shooting Star
  const u = upperShadow(c);
  const l = lowerShadow(c);
  const hammer = l >= cb * 2 && u <= cb * 0.35 && (c.close > c.open || (c.close >= c.open * 0.995));
  if (hammer) return { name: 'Hammer', dir: 'bull' };

  const star = u >= cb * 2 && l <= cb * 0.35 && (c.close < c.open || (c.close <= c.open * 1.005));
  if (star) return { name: 'Shooting Star', dir: 'bear' };

  return null;
}
