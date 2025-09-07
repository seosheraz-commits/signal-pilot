// Simple in-memory bridge from the runtime adapter to the UI
const { createKlineAdapter } = require('../../signals/runtime/wire');

let lastSignal = null;

const adapter = createKlineAdapter({
  onSignal: (sig, meta) => { if (!meta.preview) lastSignal = sig; }
});

// Example: subscribe BTCUSDT 1m/5m/15m/1h on server start (like the demo)
const WebSocket = require('ws');
const sym = 'BTCUSDT';
const streams = [`${sym.toLowerCase()}@kline_1m`,`${sym.toLowerCase()}@kline_5m`,`${sym.toLowerCase()}@kline_15m`,`${sym.toLowerCase()}@kline_1h`].join('/');
const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
ws.on('message', raw => {
  try {
    const k = JSON.parse(raw)?.data?.k;
    if (!k) return;
    adapter.onKlineUpdate({ exchange:'binance', symbol:k.s, timeframe:k.i,
      kline: { t:k.t,o:k.o,h:k.h,l:k.l,c:k.c,v:k.v,x:k.x }});
  } catch {}
});

module.exports = (req, res) => {
  res.setHeader('Cache-Control','no-store');
  res.status(200).json(lastSignal || { status: 'warming_up' });
};
