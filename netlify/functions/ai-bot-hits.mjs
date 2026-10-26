// JSON feed for the "AI Bots" tab on /seo.
// GET /api/ai-bot-hits?days=30  ->  { events: [...], sitemap: [...], bots: [...] }
import { getStore } from "@netlify/blobs";
import { BOTS, STORE_NAME, parseEventKey, normPath } from "../lib/bots.js";

// ---- Access check -------------------------------------------------------
// Same admin password as the rest of /seo (ADMIN_PASSWORD env var).
// The tab sends it in the "x-seo-key" header.
function isAuthorized(req) {
  const expected = Netlify.env.get("ADMIN_PASSWORD");
  if (!expected) return false;
  const given = req.headers.get("x-seo-key") || "";
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function listDay(store, day) {
  const out = [];
  for await (const page of store.list({ prefix: `${day}/`, paginate: true })) {
    for (const b of page.blobs) {
      const e = parseEventKey(b.key);
      if (e) out.push(e);
    }
  }
  return out;
}

async function sitemapPaths(origin) {
  try {
    const r = await fetch(`${origin}/sitemap.xml`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return [];
    const xml = await r.text();
    return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => {
      try { return normPath(new URL(m[1]).pathname); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

export default async (req) => {
  if (!isAuthorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "30", 10) || 30, 1), 90);

  const store = getStore(STORE_NAME);
  const dayKeys = [];
  for (let i = 0; i < days; i++) dayKeys.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));

  const [perDay, sitemap] = await Promise.all([
    Promise.all(dayKeys.map((d) => listDay(store, d))),
    sitemapPaths(url.origin),
  ]);
  const events = perDay.flat().sort((a, b) => b.ts - a.ts)
    .map((e) => [e.ts, e.who, e.verified, e.status, e.path]); // compact rows

  return Response.json(
    {
      generated: Date.now(),
      days,
      sitemap,
      bots: BOTS.map(({ id, label, op, type }) => ({ id, label, op, type })),
      events,
    },
    { headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } },
  );
};

export const config = { path: "/api/ai-bot-hits" };
