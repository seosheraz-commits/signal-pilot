// lib/safeJson.ts
export async function safeJson<T>(res: Response, fallback: T): Promise<T> {
  const text = await res.text();
  if (!text || !text.trim()) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    console.error("Invalid JSON from", res.url, text);
    return fallback;
  }
}
