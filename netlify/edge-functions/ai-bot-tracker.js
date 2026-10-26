// Logs every visit from AI & search crawlers (and humans referred by AI answers)
// on every page of the site. Runs at Netlify's edge, before the CDN cache,
// so cached pages are still counted. If anything here fails, the page is
// served normally (onError: "bypass").
import { getStore } from "@netlify/blobs";
import {
  classifyBot, classifyReferral, IP_SOURCES, extractRanges, ipInRanges,
  normPath, eventKey, STORE_NAME,
} from "../lib/bots.js";

const SKIP_EXT = /\.(css|js|mjs|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|pdf|zip|webmanifest)$/i;
const SKIP_PATH = /^\/(\.netlify\/|api\/|seo(\.html)?(\/|$)|login(\/|$))/i;

// Published IP lists, cached per edge instance for 12h.
const rangeCache = new Map(); // operator -> { at, ranges }
const TTL = 12 * 3600 * 1000;

async function rangesFor(op) {
  const urls = IP_SOURCES[op];
  if (!urls) return null;
  const hit = rangeCache.get(op);
  if (hit && Date.now() - hit.at < TTL) return hit.ranges;
  const lists = await Promise.all(urls.map(async (u) => {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(2500) });
      return r.ok ? extractRanges(await r.json()) : [];
    } catch { return []; }
  }));
  const ranges = lists.flat();
  // Only cache a non-empty result, so a temporary outage is retried soon.
  if (ranges.length) rangeCache.set(op, { at: Date.now(), ranges });
  return ranges;
}

async function verify(bot, ip) {
  if (!ip) return "u";
  const ranges = await rangesFor(bot.op);
  if (!ranges || !ranges.length) return "u";
  return ipInRanges(ip, ranges) ? "y" : "n";
}

export default async (request, context) => {
  const url = new URL(request.url);
  if (!["GET", "HEAD"].includes(request.method) || SKIP_EXT.test(url.pathname) || SKIP_PATH.test(url.pathname)) {
    return context.next();
  }

  const ua = request.headers.get("user-agent") || "";
  const bot = classifyBot(ua);
  const ref = bot ? null : classifyReferral(request.headers.get("referer"), url.searchParams);
  if (!bot && !ref) return context.next(); // ordinary visitor: nothing to do

  const response = await context.next();

  const log = (async () => {
    try {
      const ts = Date.now();
      const path = normPath(url.pathname);
      const ip = context.ip;
      const verified = bot ? await verify(bot, ip) : "-";
      const key = eventKey({ ts, who: bot ? bot.id : `ref:${ref}`, verified, status: response.status, path });
      // Bots: keep IP + user agent so a suspicious hit can be checked later.
      // Humans: keep nothing identifying.
      const detail = bot
        ? { ua: ua.slice(0, 300), ip, country: context.geo?.country?.code || "" }
        : { country: context.geo?.country?.code || "" };
      await getStore(STORE_NAME).set(key, JSON.stringify(detail));
    } catch (e) {
      console.log("ai-bot-tracker log failed:", e?.message || e);
    }
  })();

  if (typeof context.waitUntil === "function") context.waitUntil(log);
  else await log;
  return response;
};

export const config = {
  path: "/*",
  excludedPath: ["/.netlify/*", "/api/*", "/seo", "/seo/*", "/login", "/*.css", "/*.js", "/*.png", "/*.jpg", "/*.jpeg", "/*.webp", "/*.svg", "/*.ico", "/*.woff2"],
  onError: "bypass",
};
