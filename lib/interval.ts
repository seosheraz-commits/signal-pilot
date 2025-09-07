// lib/interval.ts

// Standard intervals your app supports
export type StdInterval =
  | "1m" | "3m" | "5m" | "15m" | "30m"
  | "1h" | "2h" | "4h" | "6h" | "8h" | "12h"
  | "1d" | "3d" | "1w";

export const VALID_INTERVALS: readonly StdInterval[] = [
  "1m","3m","5m","15m","30m",
  "1h","2h","4h","6h","8h","12h",
  "1d","3d","1w"
] as const;

export function isStdInterval(x: string): x is StdInterval {
  return VALID_INTERVALS.includes(x as StdInterval);
}

// MEXC futures interval mapping (contract API expects these codes)
export const MEXC_FUTURES_MAP: Record<StdInterval, string> = {
  "1m":  "Min1",
  "3m":  "Min3",
  "5m":  "Min5",
  "15m": "Min15",
  "30m": "Min30",
  "1h":  "Hour1",
  "2h":  "Hour2",
  "4h":  "Hour4",
  "6h":  "Hour6",
  "8h":  "Hour8",
  "12h": "Hour12",
  "1d":  "Day1",
  "3d":  "Day3",
  "1w":  "Week1"
};
