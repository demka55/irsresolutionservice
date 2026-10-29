// JSON feed for the "AI Bots" tab on /seo.
// GET /api/ai-bot-hits?days=30  ->  { events: [...], sitemap: [...], bots: [...] }
import { BOTS } from "../lib/bots.js";
import { listEvents } from "../lib/bot-events.mjs";
import { isAuthorized, sitemapPaths } from "../lib/http.mjs";


export default async (req) => {
  if (!isAuthorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "30", 10) || 30, 1), 90);

  const [all, sitemap] = await Promise.all([listEvents(days), sitemapPaths(url.origin)]);
  const events = all
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
