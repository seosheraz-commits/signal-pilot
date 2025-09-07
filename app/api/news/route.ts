import { NextResponse } from 'next/server';

// Coingecko status updates (no key needed), fallback: CoinDesk RSS via cors proxy
export async function GET() {
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/status_updates?per_page=5', { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      const items = (j.status_updates || []).slice(0, 5).map((x: any) => ({
        title: x.project?.name ? `${x.project.name}: ${x.description}` : x.description,
        url: x.project?.homepage || 'https://www.coingecko.com/en/coins/all',
        ts: Date.parse(x.created_at || '') || Date.now(),
        source: 'CoinGecko',
      }));
      return NextResponse.json({ items: items.slice(0, 3) });
    }
  } catch {}
  // fallback (very small)
  try {
    const r2 = await fetch('https://corsproxy.io/?https://www.coindesk.com/arc/outboundfeeds/rss/', { cache:'no-store' });
    const xml = await r2.text();
    const m = [...xml.matchAll(/<item>[\s\S]*?<title><!\[CDATA\[(.*?)\]\]><\/title>[\s\S]*?<link>(.*?)<\/link>/g)];
    const items = m.slice(0, 3).map(x => ({ title:x[1], url:x[2], ts:Date.now(), source:'CoinDesk' }));
    return NextResponse.json({ items });
  } catch {}
  return NextResponse.json({ items: [] }, { status: 200 });
}
