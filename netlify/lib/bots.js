// Shared bot definitions + helpers. Plain ES module, no dependencies:
// runs in both Netlify Edge Functions (Deno) and Netlify Functions (Node).

// type: "live"   = fetched right now because a person asked the AI something
//       "search" = building the AI/search index that answers & citations come from
//       "train"  = collecting data to train future models
export const BOTS = [
  // OpenAI
  { id: "chatgpt-user",   label: "ChatGPT-User",     op: "OpenAI",    type: "live",   re: /ChatGPT-User/i },
  { id: "oai-searchbot",  label: "OAI-SearchBot",    op: "OpenAI",    type: "search", re: /OAI-SearchBot/i },
  { id: "gptbot",         label: "GPTBot",           op: "OpenAI",    type: "train",  re: /GPTBot/i },
  // Anthropic
  { id: "claude-user",    label: "Claude-User",      op: "Anthropic", type: "live",   re: /Claude-User/i },
  { id: "claude-search",  label: "Claude-SearchBot", op: "Anthropic", type: "search", re: /Claude-SearchBot/i },
  { id: "claudebot",      label: "ClaudeBot",        op: "Anthropic", type: "train",  re: /ClaudeBot|anthropic-ai|Claude-Web/i },
  // Google (Googlebot feeds Search, AI Overviews and AI Mode)
  { id: "googlebot",      label: "Googlebot",        op: "Google",    type: "search", re: /Googlebot/i },
  { id: "google-other",   label: "GoogleOther / Gemini fetch", op: "Google", type: "live", re: /GoogleOther|Google-CloudVertexBot|Google-Agent|Gemini/i },
  // Microsoft (Bingbot feeds Bing + Copilot)
  { id: "bingbot",        label: "Bingbot",          op: "Microsoft", type: "search", re: /bingbot|BingPreview/i },
  // Others worth seeing
  { id: "perplexity-user",label: "Perplexity-User",  op: "Perplexity",type: "live",   re: /Perplexity-User/i },
  { id: "perplexitybot",  label: "PerplexityBot",    op: "Perplexity",type: "search", re: /PerplexityBot/i },
  { id: "applebot",       label: "Applebot",         op: "Apple",     type: "search", re: /Applebot/i },
  { id: "meta",           label: "Meta AI",          op: "Meta",      type: "train",  re: /meta-externalagent|meta-externalfetcher|FacebookBot/i },
  { id: "amazonbot",      label: "Amazonbot",        op: "Amazon",    type: "train",  re: /Amazonbot/i },
  { id: "duckassist",     label: "DuckAssistBot",    op: "DuckDuckGo",type: "live",   re: /DuckAssistBot/i },
  { id: "mistral",        label: "MistralAI-User",   op: "Mistral",   type: "live",   re: /MistralAI-User/i },
  { id: "ccbot",          label: "CCBot (Common Crawl)", op: "Common Crawl", type: "train", re: /CCBot/i },
  { id: "bytespider",     label: "Bytespider",       op: "ByteDance", type: "train",  re: /Bytespider/i },
];

export function classifyBot(ua) {
  if (!ua) return null;
  for (const b of BOTS) if (b.re.test(ua)) return b;
  return null;
}

// Humans arriving from AI answers.
const AI_REFERRERS = [
  [/(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$/, "ChatGPT"],
  [/(^|\.)claude\.ai$/, "Claude"],
  [/(^|\.)perplexity\.ai$/, "Perplexity"],
  [/(^|\.)gemini\.google\.com$/, "Gemini"],
  [/(^|\.)copilot\.microsoft\.com$/, "Copilot"],
  [/(^|\.)chat\.deepseek\.com$/, "DeepSeek"],
  [/(^|\.)you\.com$/, "You.com"],
];
export function classifyReferral(referer, searchParams) {
  let host = "";
  try { host = referer ? new URL(referer).hostname.toLowerCase() : ""; } catch {}
  for (const [re, name] of AI_REFERRERS) if (host && re.test(host)) return name;
  const utm = (searchParams?.get("utm_source") || "").toLowerCase();
  if (utm.includes("chatgpt") || utm.includes("openai")) return "ChatGPT";
  if (utm.includes("perplexity")) return "Perplexity";
  if (utm.includes("claude")) return "Claude";
  if (utm.includes("copilot")) return "Copilot";
  if (utm.includes("gemini")) return "Gemini";
  return null;
}

// Published IP lists, by operator. Verification checks against the union for that operator.
export const IP_SOURCES = {
  OpenAI: [
    "https://openai.com/gptbot.json",
    "https://openai.com/searchbot.json",
    "https://openai.com/chatgpt-user.json",
  ],
  Anthropic: ["https://claude.com/crawling/bots.json"],
  Google: [
    "https://developers.google.com/static/search/apis/ipranges/googlebot.json",
    "https://developers.google.com/static/search/apis/ipranges/common-crawlers.json",
    "https://developers.google.com/static/search/apis/ipranges/special-crawlers.json",
    "https://developers.google.com/static/search/apis/ipranges/user-triggered-fetchers-google.json",
    "https://developers.google.com/static/search/apis/ipranges/user-triggered-fetchers.json",
  ],
  Microsoft: ["https://www.bing.com/toolbox/bingbot.json"],
  Perplexity: [
    "https://www.perplexity.ai/perplexitybot.json",
    "https://www.perplexity.ai/perplexity-user.json",
  ],
  Apple: ["https://search.developer.apple.com/applebot.json"],
};

// ---------- IP / CIDR matching (IPv4 + IPv6, BigInt) ----------
export function parseIP(s) {
  if (!s) return null;
  s = String(s).trim();
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) s = mapped[1];
  if (/^\d+\.\d+\.\d+\.\d+$/.test(s)) {
    const p = s.split(".").map(Number);
    if (p.some((x) => x > 255)) return null;
    return { v: 4, n: p.reduce((a, x) => (a << 8n) + BigInt(x), 0n) };
  }
  if (!s.includes(":")) return null;
  let tail4 = null;
  const m4 = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (m4) { const t = parseIP(m4[2]); if (!t) return null; tail4 = t.n; s = m4[1] + "0:0"; }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [...head, ...Array(Math.max(fill, 0)).fill("0"), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  let n = groups.reduce((a, g) => (a << 16n) + BigInt(parseInt(g, 16)), 0n);
  if (tail4 !== null) n = (n & ~0xffffffffn) | tail4;
  return { v: 6, n };
}

export function parseCIDR(s) {
  const [addr, lenStr] = String(s).split("/");
  const ip = parseIP(addr);
  if (!ip) return null;
  const bits = ip.v === 4 ? 32 : 128;
  const len = lenStr === undefined ? bits : Number(lenStr);
  if (!Number.isInteger(len) || len < 0 || len > bits) return null;
  const shift = BigInt(bits - len);
  return { v: ip.v, shift, net: ip.n >> shift };
}

export function ipInRanges(ipStr, ranges) {
  const ip = parseIP(ipStr);
  if (!ip) return false;
  for (const r of ranges) if (r.v === ip.v && ip.n >> r.shift === r.net) return true;
  return false;
}

// Pull every IP/CIDR string out of a published JSON file, whatever its shape.
export function extractRanges(json) {
  const out = [];
  const walk = (x) => {
    if (typeof x === "string") {
      if (/^[0-9a-f:.]+(\/\d{1,3})?$/i.test(x) && /[.:]/.test(x)) { const c = parseCIDR(x); if (c) out.push(c); }
    } else if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") Object.values(x).forEach(walk);
  };
  walk(json);
  return out;
}

// ---------- path normalising ----------
export function normPath(p) {
  try { p = decodeURIComponent(p); } catch {}
  p = p.split("?")[0].split("#")[0] || "/";
  p = p.replace(/\/index(\.html?)?$/i, "/").replace(/\.html?$/i, "");
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p || "/";
}

// ---------- event keys ----------
// Every event is one blob whose KEY carries the data, so the dashboard
// can read a whole month with list() calls alone (no per-blob reads).
// Format: YYYY-MM-DD/<ms36>-<rand>~<who>~<verified>~<status>~<path>
//   who      = bot id, or "ref:<AI name>" for human visits referred by an AI
//   verified = y (IP on the operator's published list) | n (not on it: likely fake) | u (can't check)
const enc = (s) => encodeURIComponent(s).replace(/~/g, "%7E");
export function eventKey({ ts, who, verified, status, path }) {
  const day = new Date(ts).toISOString().slice(0, 10);
  const rand = Math.random().toString(36).slice(2, 7);
  return `${day}/${ts.toString(36)}-${rand}~${enc(who)}~${verified}~${status}~${enc(path).slice(0, 400)}`;
}
export function parseEventKey(key) {
  const slash = key.indexOf("/");
  const parts = key.slice(slash + 1).split("~");
  if (parts.length < 5) return null;
  const ts = parseInt(parts[0].split("-")[0], 36);
  let path = parts.slice(4).join("~");
  try { path = decodeURIComponent(path); } catch {}
  let who = parts[1];
  try { who = decodeURIComponent(who); } catch {}
  return { ts, who, verified: parts[2], status: Number(parts[3]) || 0, path };
}

export const STORE_NAME = "ai-bot-hits";
