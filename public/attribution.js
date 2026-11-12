/*! IRS Resolution Service first-party attribution v1
 *  Captures: where a visitor came from (first + latest visit), the pages they viewed,
 *  and what they typed into the on-page tools (numbers only) BEFORE they submit a form.
 *  Attaches it to any POST to /.netlify/functions/contact-form automatically.
 *  No cookies, nothing leaves the browser until the visitor submits a form. */
(function () {
  'use strict';
  if (window.__irsAttrLoaded) return; window.__irsAttrLoaded = true; // safe if also injected site-wide
  var KEY = 'irs_attr_v1', TRAIL = 'irs_trail_v1', TOOLS = 'irs_tools_v1', MAX_TRAIL = 15;

  function get(store, k) { try { return JSON.parse(store.getItem(k) || 'null'); } catch (e) { return null; } }
  function put(store, k, v) { try { store.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
  function qp(name) { try { return new URLSearchParams(location.search).get(name) || ''; } catch (e) { return ''; } }
  function clip(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) : s; }

  function channel(ref, src, med, click) {
    var h = host(ref), s = (src || '').toLowerCase(), m = (med || '').toLowerCase();
    if (click.gclid || click.msclkid || /cpc|ppc|paid/.test(m)) return 'paid-search';
    if (/chatgpt|openai/.test(s) || /(^|\.)chatgpt\.com$|chat\.openai\.com$/.test(h)) return 'ai-chatgpt';
    if (/perplexity/.test(s) || /perplexity\.ai$/.test(h)) return 'ai-perplexity';
    if (/claude/.test(s) || /claude\.ai$/.test(h)) return 'ai-claude';
    if (/gemini/.test(s) || /gemini\.google\.com$/.test(h)) return 'ai-gemini';
    if (/copilot/.test(s) || /copilot\.microsoft\.com$/.test(h)) return 'ai-copilot';
    if (/(^|\.)google\./.test(h)) return 'organic-google';
    if (/bing\.com$|duckduckgo\.com$|yahoo\.com$|ecosia\.org$|brave\.com$/.test(h)) return 'organic-other-search';
    if (/reddit\.com$/.test(h) || s === 'reddit') return 'reddit';
    if (/linkedin\.com$|lnkd\.in$/.test(h) || s === 'linkedin') return 'linkedin';
    if (/facebook\.com$|instagram\.com$|t\.co$|x\.com$|twitter\.com$|youtube\.com$|youtu\.be$/.test(h)) return 'social-' + h.split('.')[0];
    if (m === 'email' || /newsletter|substack/.test(s) || /substack\.com$/.test(h)) return 'email-newsletter';
    if (!h && !s) return 'direct';
    if (h === location.hostname.replace(/^www\./, '')) return 'internal';
    return 'referral';
  }

  function snapshot() {
    var click = { gclid: qp('gclid'), msclkid: qp('msclkid'), fbclid: qp('fbclid'), rdt_cid: qp('rdt_cid') };
    var src = qp('utm_source'), med = qp('utm_medium');
    return {
      ts: new Date().toISOString(),
      url: clip(location.href, 500),
      path: location.pathname,
      referrer: clip(document.referrer, 500),
      referrerHost: host(document.referrer),
      source: clip(src, 80), medium: clip(med, 80),
      campaign: clip(qp('utm_campaign'), 120), term: clip(qp('utm_term'), 120), content: clip(qp('utm_content'), 120),
      clickIds: click,
      channel: channel(document.referrer, src, med, click)
    };
  }

  // ---- first touch (kept in localStorage) and latest session (refreshed per browser session) ----
  var attr = get(localStorage, KEY) || { v: 1, first: null, last: null, sessions: 0 };
  var sess = get(sessionStorage, 'irs_sess_v1');
  var snap = snapshot();
  if (!attr.first) attr.first = snap;
  if (!sess) {
    // new session: record it as the latest touch unless it is just us linking internally
    if (snap.channel !== 'internal') attr.last = snap; else if (!attr.last) attr.last = snap;
    attr.sessions = (attr.sessions || 0) + 1;
    put(sessionStorage, 'irs_sess_v1', { start: snap.ts });
    put(localStorage, KEY, attr);
  } else if (snap.channel !== 'internal' && (snap.source || snap.clickIds.gclid)) {
    attr.last = snap; put(localStorage, KEY, attr); // a tagged click mid-session
  }

  // ---- page trail (this session) ----
  var trail = get(sessionStorage, TRAIL) || [];
  if (!trail.length || trail[trail.length - 1].p !== location.pathname) {
    trail.push({ p: location.pathname, t: Math.round(Date.now() / 1000) });
    if (trail.length > MAX_TRAIL) trail = trail.slice(trail.length - MAX_TRAIL);
    put(sessionStorage, TRAIL, trail);
  }

  // ---- tool inputs: pages call irsCtx.set('name', {numbers only}) ----
  window.irsCtx = {
    set: function (name, values) {
      try {
        var t = get(localStorage, TOOLS) || {};
        var clean = {};
        Object.keys(values || {}).slice(0, 12).forEach(function (k) {
          var v = values[k];
          clean[clip(k, 30)] = (typeof v === 'number' || typeof v === 'boolean') ? v : clip(v, 120);
        });
        t[clip(name, 40)] = { page: location.pathname, ts: new Date().toISOString(), values: clean };
        var keys = Object.keys(t);
        if (keys.length > 10) { keys.sort(function (a, b) { return t[a].ts < t[b].ts ? -1 : 1; }); delete t[keys[0]]; }
        put(localStorage, TOOLS, t);
      } catch (e) {}
    }
  };

  function bundle() {
    var chat = '';
    try { chat = clip(sessionStorage.getItem('irs_first_message') || '', 500); } catch (e) {}
    return {
      v: 1,
      first: attr.first, last: attr.last, sessions: attr.sessions,
      trail: (get(sessionStorage, TRAIL) || []).map(function (x) { return x.p; }),
      tools: get(localStorage, TOOLS) || {},
      chatMessage: chat,
      submittedFrom: clip(location.href, 500),
      device: { w: window.innerWidth, lang: navigator.language || '', tz: (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone || '' }
    };
  }
  window.irsAttribution = bundle;

  // ---- attach to every contact-form POST, whatever form it comes from ----
  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        if (/\/\.netlify\/functions\/contact-form/.test(url) && init && typeof init.body === 'string') {
          var body = JSON.parse(init.body);
          if (body && typeof body === 'object' && !body.attribution) {
            body.attribution = bundle();
            init = Object.assign({}, init, { body: JSON.stringify(body) });
          }
        }
      } catch (e) {}
      return origFetch.call(this, input, init);
    };
  }
})();
