# AI Bot Tracker + /seo fixes, for irsresolutionservice.com

Copy these files into your site repo at the same paths, then push or deploy as usual.

| File | New or changed | What it does |
|---|---|---|
| `seo.html` | changed | Adds the **AI Overviews / AI Bots** tabs. Open `/seo#bots` to land on the bots tab. |
| `netlify/edge-functions/ai-bot-tracker.js` | new | Runs on every page. Logs visits from ChatGPT, Claude, Google, Bing, Perplexity and other bots, plus people who arrive from AI answers. |
| `netlify/functions/ai-bot-hits.mjs` | new | `/api/ai-bot-hits`: the data behind the AI Bots tab. Uses the same admin password as /seo. |
| `netlify/lib/bots.js` | new | Bot list, IP verification, shared helpers. |
| `netlify/functions/seo-api.mjs` | changed | **Fixes the 504.** It reads keyword results in parallel instead of one at a time. |
| `netlify/functions/seo-track.mjs` | changed | **Fixes the daily 6am run.** It checks keywords in chunks so each run stays under Netlify's 30-second limit. |
| `netlify/lib/seo-core.mjs` | new | One shared keyword list and checker for "Run now" and the daily run. |

There are no new environment variables. Everything uses `ADMIN_PASSWORD` and `VALUESERP_API`, which you already have.
Data is stored in Netlify Blobs (store `ai-bot-hits`), which your site already uses.

## Notes
- The tracker runs at Netlify's edge, before the cache, so it counts cached pages too.
  If the tracker ever errors, pages are served normally (`onError: "bypass"`).
- Normal visitors pass straight through and nothing is logged for them.
  For bots it stores the IP and user agent. For visitors who arrive from AI answers it stores only the page and country.
- Each bot hit is checked against the IP list its company publishes (OpenAI, Anthropic, Google, Bing, Perplexity, Apple).
  A hit that claims to be a bot but comes from an IP outside that company's list is marked **fake** and hidden by default.
- Pages come from `/sitemap.xml` at view time. New pages show up automatically.
- The daily keyword run now goes every 5 minutes from 06:00 to 08:55 UTC and finishes in about 1–2 hours.
