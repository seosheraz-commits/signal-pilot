'use client';

import { useEffect, useState } from 'react';

type NewsItem = { title: string; url: string; ts: number; source: string };

export default function NewsTicker() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      setErr(null);
      const r = await fetch('/api/news', { cache: 'no-store' });
      const j = await r.json();
      setItems(j.items || []);
    } catch (e: any) {
      setErr(e?.message || 'news failed');
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 30000); // 30s
    return () => clearInterval(id);
  }, []);

  return (
    <div className="rounded-xl border border-[#1b1b1b] p-3 overflow-x-auto">
      <div className="font-semibold mb-2">Live Crypto News</div>
      {err && <div className="text-red-400 text-sm mb-2">{err}</div>}
      <div className="flex gap-4 flex-wrap">
        {items.slice(0, 3).map((n, idx) => (
          <a
            key={idx}
            className="text-sm opacity-90 hover:opacity-100 underline underline-offset-4"
            href={n.url}
            target="_blank"
            rel="noreferrer"
          >
            [{n.source}] {n.title}
          </a>
        ))}
      </div>
    </div>
  );
}
