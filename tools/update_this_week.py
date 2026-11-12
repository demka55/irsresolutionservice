#!/usr/bin/env python3
"""Refresh the 'This week at the IRS' block on index.html.

Usage:  python3 update_this_week.py index.html this-week.json
Edit this-week.json (date, items, Romeo's take), run the script, redeploy index.html.
It rewrites the block between the THIS-WEEK markers, the visible date, the
dateModified in the page schema, and the matching FAQ answer.
"""
import json, re, sys, html

CSS = """<style id="tw-css">
.tw-band{background:#f5f0e8;border-top:1px solid #d9cdb8;border-bottom:1px solid #d9cdb8;padding:4.5rem 1.5rem}
.tw-in{max-width:1040px;margin:0 auto}
.tw-head{text-align:center;max-width:720px;margin:0 auto 2rem}
.tw-pill{display:inline-flex;align-items:center;gap:8px;background:#1a1410;color:#fff;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;padding:6px 14px;border-radius:99px}
.tw-pill i{width:7px;height:7px;border-radius:50%;background:#c9a84c;display:inline-block}
.tw-head h2{font-family:var(--serif,Georgia,serif);font-size:clamp(1.8rem,3.6vw,2.6rem);line-height:1.15;font-weight:600;color:#1a1410;margin:1rem 0 .7rem}
.tw-head p{font-size:17px;line-height:1.6;color:#4a3f32;margin:0}
.tw-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:1rem;margin:0 0 1.25rem}
.tw-card{background:#fff;border:1px solid #d9cdb8;border-top:3px solid #c9a84c;border-radius:8px;padding:1.2rem 1.3rem;font-size:16px;line-height:1.6;color:#4a3f32}
.tw-tag{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#8a6e2f;background:#f5ecd8;border-radius:4px;padding:3px 9px;margin-bottom:.6rem}
.tw-card b{color:#1a1410}
.tw-card a{color:#8a6e2f;font-weight:600}
.tw-take{display:flex;gap:1.1rem;align-items:flex-start;background:#1a1410;color:#fff;border-radius:10px;padding:1.5rem 1.6rem}
.tw-take img{width:64px;height:64px;border-radius:50%;object-fit:cover;object-position:center top;border:2px solid #c9a84c;flex-shrink:0;background:#fff}
.tw-take b.h{display:block;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#e8c97a;margin-bottom:.45rem}
.tw-take p{margin:0 0 .6rem;font-size:17px;line-height:1.65;color:rgba(255,255,255,.88)}
.tw-take p:last-child{margin:0}
.tw-fine{text-align:center;font-size:13px;color:#7a6e60;margin:1rem 0 0}
@media(max-width:700px){.tw-band{padding:3rem 1rem}.tw-grid{grid-template-columns:1fr}.tw-take{flex-direction:column}}
</style>"""

def build(d):
    cards = ''.join(f'<div class="tw-card"><span class="tw-tag">{html.escape(i["tag"])}</span><br>{i["html"]}</div>' for i in d['items'])
    take = ''.join(f'<p>{html.escape(t)}</p>' for t in d['take'])
    return f'''<!-- THIS-WEEK:START -->
<section class="tw-band" id="this-week" aria-labelledby="tw-title"><div class="tw-in">
<div class="tw-head"><span class="tw-pill"><i></i>This week at the IRS &middot; Updated {html.escape(d["updated"])}</span>
<h2 id="tw-title">{html.escape(d["headline"])}</h2><p>{html.escape(d["intro"])}</p></div>
<div class="tw-grid">{cards}</div>
<div class="tw-take"><img src="/romeo-razi.png" alt="Romeo Razi, CPA, former IRS Tax Examiner"><div><b class="h">Romeo's take</b>{take}</div></div>
<p class="tw-fine">{html.escape(d["fine"])}</p>
</div></section>
<!-- THIS-WEEK:END -->'''

def faq_update(s, answer):
    def rep(m):
        try: d = json.loads(m.group(2))
        except Exception: return m.group(0)
        items = d['@graph'] if isinstance(d, dict) and '@graph' in d else [d]
        hit = False
        for x in items:
            if x.get('@type') == 'FAQPage':
                for q in x['mainEntity']:
                    if q['name'].startswith('What changed at the IRS this week'):
                        q['acceptedAnswer']['text'] = answer; hit = True
        return m.group(1) + json.dumps(d, ensure_ascii=False) + m.group(3) if hit else m.group(0)
    return re.sub(r'(<script type="application/ld\+json">)(.*?)(</script>)', rep, s, flags=re.S)

def main(page, data):
    s = open(page, encoding='utf-8').read()
    d = json.load(open(data, encoding='utf-8'))
    block = build(d)
    if '<!-- THIS-WEEK:START -->' in s:
        s = re.sub(r'<!-- THIS-WEEK:START -->.*?<!-- THIS-WEEK:END -->', lambda m: block, s, flags=re.S)
    else:
        # first run: replace the older in-page block
        a = s.index('<div class="wrap" style="max-width:1000px;padding-top:1.5rem">')
        b = s.index('</p>\n</div>\n</div>\n', a) + len('</p>\n</div>\n</div>\n')
        s = s[:a] + block + '\n' + s[b:]
    if 'id="tw-css"' in s:
        s = re.sub(r'<style id="tw-css">.*?</style>', lambda m: CSS, s, flags=re.S)
    else:
        s = s.replace('</head>', CSS + '\n</head>', 1)
    s = faq_update(s, d['faq_answer'])
    s = re.sub(r'("dateModified"\s*:\s*")\d{4}-\d{2}-\d{2}', r'\g<1>' + d['updated_iso'], s)
    open(page, 'w', encoding='utf-8').write(s)
    print('updated', page, 'to', d['updated'])

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
