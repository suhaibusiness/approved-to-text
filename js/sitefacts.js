// Business details read from the pages the website reader returned (one-input spec §3.1, fields marked "a").
// siteFacts(pages) -> { values: {field: text}, from: {field: page url}, guess: {field: true} }. Runs in the browser
// (DOMParser); nothing here fetches or stores anything. Each value comes from the first source in the spec's order:
// JSON-LD, then links (tel:, mailto:), then page text patterns.
const SUFFIX = /\b(?:L\.?L\.?C\.?|Inc\.?|Incorporated|Ltd\.?|Limited|Corp\.?|Corporation|Co\.|LLP|PLLC|P\.?C\.)$/i;
const STREET = '(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Place|Pl|Parkway|Pkwy|Highway|Hwy|Circle|Cir|Terrace|Ter|Trail|Trl|Square|Sq|Loop|Pike)';
const US_ADDR = new RegExp(`(\\d{1,6}\\s+[A-Za-z0-9.'\\- ]{1,40}?\\b${STREET}\\b\\.?(?:,?\\s*(?:Suite|Ste\\.?|Unit|#)\\s*[\\w-]+)?)\\s*,\\s*([A-Za-z][A-Za-z .'-]{1,30}?)\\s*,\\s*([A-Z]{2})\\s+(\\d{5}(?:-\\d{4})?)\\b`);
const CA_ADDR = new RegExp(`(\\d{1,6}\\s+[A-Za-z0-9.'\\- ]{1,40}?\\b${STREET}\\b\\.?(?:,?\\s*(?:Suite|Ste\\.?|Unit|#)\\s*[\\w-]+)?)\\s*,\\s*([A-Za-z][A-Za-z .'-]{1,30}?)\\s*,\\s*([A-Z]{2})\\s+([A-Z]\\d[A-Z] ?\\d[A-Z]\\d)\\b`);
const PHONE = /(?:\+?1[\s.-]?)?\(?([2-9]\d{2}|555)\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const JUNK_MAIL = /(example\.|sentry|wixpress|godaddy|squarespace|@2x|\.png|\.jpg|\.webp)/i;
// Words that point to each industry the app offers (app.js INDUSTRIES), weighted by where they appear.
const TRADES = [
  ['plumbing', /\bplumb(?:er|ers|ing)?\b/gi], ['electrical', /\belectric(?:al|ian|ians)?\b/gi], ['hvac', /\b(?:hvac|heating|air condition\w*|furnace\w*)\b/gi],
  ['roofing', /\broof(?:s|er|ers|ing)?\b/gi], ['cleaning', /\b(?:cleaning service\w*|house ?cleaning|maid\w*|janitorial)\b/gi],
  ['landscaping', /\b(?:landscap\w*|lawn\w*)\b/gi], ['pest', /\b(?:pest|termite\w*|exterminat\w*)\b/gi], ['pool', /\bpools?\b/gi],
  ['painting', /\bpaint(?:er|ers|ing)\b/gi], ['handyman', /\bhandym[ae]n\b/gi], ['moving', /\b(?:movers|moving company)\b/gi],
  ['auto', /\b(?:auto repair|mechanic\w*)\b/gi], ['salon', /\b(?:salon|barber\w*|nail\w*)\b/gi],
];
const LD_TYPES = { Plumber: 'plumbing', Electrician: 'electrical', HVACBusiness: 'hvac', RoofingContractor: 'roofing', HousePainter: 'painting',
  MovingCompany: 'moving', AutoRepair: 'auto', HairSalon: 'salon', BeautySalon: 'salon', NailSalon: 'salon' };
export const NEEDED = ['legalName', 'street', 'city', 'state', 'zip', 'phone', 'email', 'industry'];

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
export const fmtPhone = (a, b, c) => `(${a}) ${b}-${c}`;
function phoneOf(s) { const m = PHONE.exec(String(s || '').replace(/^tel:/i, '')); return m ? fmtPhone(m[1], m[2], m[3]) : ''; }

// Every JSON-LD object on the page, flattened (@graph and arrays included).
function ldObjects(doc) {
  const out = [];
  const walk = (o) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { out.push(o); if (o['@graph']) walk(o['@graph']); } };
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) { try { walk(JSON.parse(s.textContent)); } catch {} }
  return out;
}
const ldType = (o) => [].concat(o['@type'] || []).map(String);
const asText = (v) => (typeof v === 'string' ? v : Array.isArray(v) ? v.map(asText).filter(Boolean).join(', ') : v && typeof v === 'object' ? asText(v.name) : '');

export function siteFacts(pages, parse = (html) => new DOMParser().parseFromString(html, 'text/html')) {
  const values = {}, from = {}, guess = {};
  const set = (k, v, url, isGuess = false) => { v = clean(v); if (!v || values[k]) return; values[k] = v; from[k] = url; if (isGuess) guess[k] = true; };
  const docs = (pages || []).filter((p) => p && typeof p.html === 'string' && p.status >= 200 && p.status < 400)
    .map((p) => { const doc = parse(p.html); for (const x of doc.querySelectorAll('script:not([type="application/ld+json"]), style, noscript')) x.remove();
      return { url: p.finalUrl || p.url, roles: p.roles || [], doc, text: clean(doc.body ? doc.body.textContent : '') }; });
  if (!docs.length) return { values, from, guess };
  const home = docs.find((d) => d.roles.includes('home')) || docs[0];
  // Contact and home pages first: that's where the address and phone usually are.
  const order = [...docs].sort((a, b) => (b.roles.includes('contact') - a.roles.includes('contact')) || (b === home) - (a === home));

  // 1. JSON-LD (a business object: has an address, a phone or a business @type)
  for (const d of order) {
    for (const o of ldObjects(d.doc)) {
      const t = ldType(o);
      if (!(o.address || o.telephone || t.some((x) => /Business|Organization|Contractor|Store|Service|Plumber|Electrician|Salon|AutoRepair/.test(x)))) continue;
      set('legalName', o.legalName || o.name, d.url);
      if (o.legalName && o.name && clean(o.name).toLowerCase() !== clean(o.legalName).toLowerCase()) set('dba', o.name, d.url);
      const a = o.address && typeof o.address === 'object' ? [].concat(o.address)[0] : null;
      if (a) { set('street', a.streetAddress, d.url); set('city', a.addressLocality, d.url); set('state', String(a.addressRegion || '').toUpperCase().slice(0, 2), d.url);
        set('zip', a.postalCode, d.url); const c = asText(a.addressCountry).toUpperCase(); set('country', /^(US|USA|UNITED STATES)/.test(c) ? 'US' : /^(CA|CANADA)/.test(c) ? 'CA' : '', d.url); }
      set('phone', phoneOf(o.telephone), d.url);
      set('email', String(o.email || '').replace(/^mailto:/i, ''), d.url);
      set('area', asText(o.areaServed), d.url);
      for (const x of t) if (LD_TYPES[x]) set('industry', LD_TYPES[x], d.url);
      const offers = asText(o.makesOffer) || asText(o.hasOfferCatalog && o.hasOfferCatalog.itemListElement);
      set('services', offers || o.description, d.url);
    }
  }
  // 2. Links
  for (const d of order) {
    for (const a of d.doc.querySelectorAll('a[href^="tel:" i]')) set('phone', phoneOf(a.getAttribute('href')), d.url);
    for (const a of d.doc.querySelectorAll('a[href^="mailto:" i]')) { const m = EMAIL.exec(decodeURIComponent(a.getAttribute('href').slice(7).split('?')[0])); if (m && !JUNK_MAIL.test(m[0])) set('email', m[0], d.url); }
  }
  // 3. Page text
  for (const d of order) {
    const ca = CA_ADDR.exec(d.text), us = US_ADDR.exec(d.text);
    const m = us || ca;
    if (m && !values.street) { set('street', m[1], d.url); set('city', m[2], d.url); set('state', m[3], d.url); set('zip', m[4], d.url); set('country', us ? 'US' : 'CA', d.url); }
    set('phone', phoneOf(d.text), d.url);
    const e = (d.text.match(new RegExp(EMAIL.source, 'gi')) || []).find((x) => !JUNK_MAIL.test(x)); set('email', e, d.url);
    // "© 2026 Bright Path Plumbing LLC, ..." : the legal name is the copyright holder when it ends in a company suffix
    const c = /(?:©|&copy;|\(c\)|copyright)\s*(?:\d{4}(?:\s*[-–]\s*\d{4})?\s*)?([A-Z0-9][^,|·•\n]{1,60}?\b(?:L\.?L\.?C\.?|Inc\.?|Ltd\.?|Corp\.?|Co\.|LLP|PLLC))(?=[\s,.|·]|$)/i.exec(d.text);
    if (c) set('legalName', c[1].replace(/\b(LLC|LLP|PLLC)\.$/i, (m, suffix) => suffix), d.url); // "... LLC." ends the sentence, not the name
    const area = /\b(?:serving|areas? we serve:?|service areas?:?|proudly serving)\s+([A-Z][^.;:!?]{2,80})/.exec(d.text);
    if (area) set('area', area[1].split(/\s+(?:since|for over|for more|with|from|and has|we)\b/i)[0].replace(/\s+(?:area|areas)$/i, ''), d.url, true);
  }
  // Brand: og:site_name, the home page's h1, then the title's first part. It is the DBA when it differs from the legal
  // name, and the legal name itself when no source named one (then a guess: the legal name needs checking).
  const og = home.doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content');
  const h1 = home.doc.querySelector('h1')?.textContent;
  const title = (home.doc.querySelector('title')?.textContent || '').split(/\s[|–—-]\s|\s·\s/)[0];
  const brand = clean(og || (h1 && clean(h1).length <= 60 ? h1 : '') || title);
  if (brand) {
    if (!values.legalName) set('legalName', brand, home.url, true);
    else if (brand.toLowerCase() !== values.legalName.toLowerCase() && values.legalName.toLowerCase().startsWith(brand.toLowerCase())) set('dba', brand, home.url);
  }
  // Services: meta description, else the services page's list items
  const desc = home.doc.querySelector('meta[name="description"]')?.getAttribute('content');
  if (desc) set('services', desc, home.url);
  const svc = docs.find((d) => d.roles.includes('services'));
  if (svc) set('services', [...svc.doc.querySelectorAll('main li, li')].map((li) => clean(li.textContent)).filter((x) => x && x.length < 80).slice(0, 5).join(', '), svc.url);
  // Industry: keyword counts over the home, services and about pages; the home page's title and h1 count five times
  if (!values.industry) {
    const score = {};
    for (const d of docs.filter((x) => x === home || x.roles.some((r) => r === 'services' || r === 'about'))) {
      const head = clean(`${d.doc.querySelector('title')?.textContent || ''} ${d.doc.querySelector('h1')?.textContent || ''}`);
      for (const [k, re] of TRADES) score[k] = (score[k] || 0) + (d.text.match(re) || []).length + 5 * (head.match(re) || []).length;
    }
    const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] >= 2) set('industry', best[0], home.url, true);
  }
  if (values.legalName && SUFFIX.test(values.legalName)) set('entity', 'registered', from.legalName, true);
  return { values, from, guess };
}

// The text of a page the reader returned (privacy policy, terms), for the toll-free policy check.
export function pageText(page, parse = (html) => new DOMParser().parseFromString(html, 'text/html')) {
  if (!page || typeof page.html !== 'string') return '';
  const doc = parse(page.html);
  for (const x of doc.querySelectorAll('script, style, noscript, nav, header, footer')) x.remove();
  return (doc.body ? doc.body.innerText || doc.body.textContent : '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
}
