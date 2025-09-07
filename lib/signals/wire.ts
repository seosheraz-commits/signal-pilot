// lib/signals/wire.ts
// Thin wrappers to dynamically import your JS engine regardless of ESM/CJS shape.
export async function loadScanAll() {
  // from /lib/signals to /signals → ../../signals
  const mod: any = await import('../../signals/strategy/scanAll.js');
  // support: named, default, or bare export
  const fn = mod?.scanAll ?? mod?.default ?? mod;
  if (typeof fn !== 'function') throw new Error('scanAll not found or not a function');
  return fn as (...args: any[]) => Promise<any>;
}

export async function loadSignalEngine() {
  const mod: any = await import('../../signals/strategy/signalEngine.js').catch(() => ({}));
  const engine = mod?.signalEngine ?? mod?.default ?? mod;
  if (!engine) throw new Error('signalEngine not found');
  return engine as any;
}

export async function loadConfig() {
  const mod: any = await import('../../signals/config/signalConfig.js').catch(() => ({}));
  return (mod?.default ?? mod) as any;
}

export async function loadIndicators() {
  // load a few common ones; add more if you need
  const [ema, rsi, atr, macd] = await Promise.all([
    import('../../signals/indicators/ema.js').catch(()=>({})),
    import('../../signals/indicators/rsi.js').catch(()=>({})),
    import('../../signals/indicators/atr.js').catch(()=>({})),
    import('../../signals/indicators/macd.js').catch(()=>({})),
  ]);
  return {
    ema: (ema as any).default ?? (ema as any),
    rsi: (rsi as any).default ?? (rsi as any),
    atr: (atr as any).default ?? (atr as any),
    macd: (macd as any).default ?? (macd as any),
  };
}
