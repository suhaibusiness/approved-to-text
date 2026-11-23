// Toll-free rejection fixer: pure logic, no page access. Every Twilio sentence comes from tf-data.js (made by
// tools/make_tf_codes.py from the saved Twilio pages; tools/check_tf.py proves the texts word for word).
// Nothing here stores or sends what the visitor pastes.
import { TF_CODES, TF_CONFLICT, TF_ARTICLE, TF_READ } from './tf-data.js';
import { RULES, checkPasted } from './rules.js';

// Each policy rule and the toll-free codes that ask for it (read against each code's Twilio text, 2026-11-20).
// P4 and P5 are left out: no toll-free code asks for them. Kept JSON-shaped so check_tf.py can read it.
export const TF_RULE_CODES = {
  "P1": ["30536", "30519"], "P2": ["30521", "30519"], "P3": ["30520"],
  "T1": ["30493", "30522"], "T2": ["30557", "30522"], "T3": ["30559", "30522"], "T4": ["30558", "30522"],
  "T5": ["30560", "30522"], "T6": ["30561", "30522"], "T7": ["30562", "30522"], "T8": ["30563", "30522"]
};

const NAME = 'Bayside Plumbing';
const PRIVACY = 'Privacy Policy. Bayside Plumbing respects your privacy. We collect your name, phone number and address when you book a job, and we use them only to schedule visits, send appointment reminders and answer your questions.';
const NO_SHARE = ' No mobile information will be shared with third parties or affiliates for marketing or promotional purposes. Text messaging opt-in data and consent will not be shared with any third parties.';
const KEEP = ' We keep your details on secure systems that only our own staff can see. You can ask us to delete your details at any time by emailing hello@baysideplumbing.example.';
const TERMS = 'SMS Terms. Bayside Plumbing sends text messages about your jobs: booking confirmations, appointment reminders and job updates. Message frequency varies. Message and data rates may apply. Reply HELP for help, or email hello@baysideplumbing.example.';
const OPT_OUT = ' Reply STOP to opt out at any time.';
const LIABLE = ' Carriers are not liable for delayed or undelivered messages.';
const CONTACT = ' You can also call us during business hours if you no longer want these messages.';

// "Try a sample" fills the fixer with these. TF_BAD is the known-bad pair for the tests: only P2 and T6 fail.
export const TF_SAMPLE = {
  rejection: 'Your toll-free verification was rejected. Error 30493: Terms of Service URL is missing, inaccessible, or lacks content.',
  name: NAME, privacy: PRIVACY + NO_SHARE + KEEP, terms: TERMS + OPT_OUT + LIABLE,
};
export const TF_BAD = { name: NAME, privacy: PRIVACY + KEEP, terms: TERMS + LIABLE + CONTACT };

const STOP_WORDS = new Set('that this with from your have been were will must into than then they their there which what when'.split(' '));
const words = (s) => new Set((String(s).toLowerCase().match(/[a-z]+/g) || []).filter((w) => w.length >= 4 && !STOP_WORDS.has(w)));
export const twilioErrorUrl = (code) => `https://www.twilio.com/docs/api/errors/${code}`;
const READ_ON = new Date(TF_READ + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

// A pasted rejection -> one card per code (paste order, duplicates once), or word matches when there is no code.
export function explainTF(text) {
  const raw = String(text || '');
  if (!raw.trim()) return { empty: true, cards: [], matches: [] };
  const codes = [...new Set(raw.match(/\b3\d{4}\b/g) || [])];
  const cards = codes.map((code) => {
    const c = TF_CODES[code];
    if (!c) return { code, known: false, url: twilioErrorUrl(code) };
    const fromPage = c.source === 'error-page';
    return {
      code, known: true, name: c.name, fix: c.fix, section: c.section, update: c.update || '', shared: !!c.shared,
      conflict: TF_CONFLICT.codes.includes(code), url: twilioErrorUrl(code),
      attribution: fromPage
        ? { text: `From Twilio's error page for ${code}, updated 1 May 2026`, url: twilioErrorUrl(code) }
        : { text: `From Twilio's help article '${TF_ARTICLE.title}', read ${READ_ON}`, url: TF_ARTICLE.url },
    };
  });
  let matches = [];
  if (!codes.length) {
    const said = words(raw);
    matches = Object.entries(TF_CODES).filter(([, c]) => c.source !== 'error-page')
      .map(([code, c]) => ({ code, name: c.name, score: [...words(c.name)].filter((w) => said.has(w)).length }))
      .filter((m) => m.score >= 2).sort((a, b) => b.score - a.score).slice(0, 5);
  }
  return { empty: false, cards, matches };
}

const FULL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const NO_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
export const fmtDay = (d) => d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// Time left to edit a rejected submission. date: 'YYYY-MM-DD' (visitor's local date); expiration: Twilio's
// edit_expiration. The date gives the earliest possible end (date + 7 days, 00:00 local), since the hour is unknown.
export function windowLeft({ date = '', expiration = '' } = {}, now = new Date()) {
  const exp = String(expiration || '').trim();
  let end, kind;
  if (exp) {
    if (NO_ZONE.test(exp)) return { error: 'zone', message: 'Paste the whole value, including the Z or time zone at the end.' };
    end = FULL.test(exp) ? new Date(exp) : new Date(NaN);
    if (isNaN(end)) return { error: 'parse', message: 'That doesn’t look like an edit_expiration value. It looks like 2026-11-25T14:00:00Z.' };
    kind = 'expiration';
  } else if (date) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date));
    const day = m && new Date(+m[1], +m[2] - 1, +m[3]);
    if (!day || isNaN(day) || day.getDate() !== +m[3]) return { error: 'parse', message: 'That date doesn’t look right. Pick the day Twilio rejected your submission.' };
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (day > today) return { error: 'future', message: 'That date is in the future. Pick the day Twilio rejected your submission.' };
    end = new Date(+m[1], +m[2] - 1, +m[3] + 7);
    kind = 'date';
  } else return { none: true };
  const when = fmtDay(end) + (kind === 'expiration' ? `, ${end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} your time` : '');
  if (now >= end) return { ended: true, kind, end, message: `The 7-day edit window ended on ${when}. Your submission has lost its review priority, but you can still provide corrections for a new review.` };
  const ms = end - now, days = Math.floor(ms / 864e5), hours = Math.floor((ms % 864e5) / 36e5);
  return { kind, end, days, hours, message: `About ${plural(days, 'day')} and ${plural(hours, 'hour')} left, until ${when}.` };
}

// What a pasted rejection says about the edit window (one-input spec §3.1 #35-36, AC-A4): Twilio's edit_expiration
// from console or API text, else the email's own Date: (or Outlook's Sent:) line, as the visitor's local day.
// Neither found: both blank, and the screen asks for the day with one tap (AC-A9).
const EXP_IN_TEXT = /edit_expiration["']?\s*[:=]\s*["']?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))/i;
const DATE_LINE = /^[ \t>]*(?:date|sent)[ \t]*:[ \t]*(.+)$/im;
const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function readRejection(text) {
  const raw = String(text || '');
  const exp = EXP_IN_TEXT.exec(raw);
  if (exp) return { expiration: exp[1], date: '' };
  const line = DATE_LINE.exec(raw);
  const d = line && new Date(line[1].trim().replace(/\s+\([^)]*\)$/, ''));
  return { expiration: '', date: d && !isNaN(d) ? localDay(d) : '' };
}

const LABEL = { pass: 'Looks right', fail: 'Fix this', warn: 'Check this', manual: 'Check by hand', skip: 'Not checked', advice: 'Check this' };
const EMPTY = 'Not checked: paste the text to check this.';
const SHORT = 'Too short to read as a full policy: paste the whole page text.';
// A rule's fix without its "Step 3 ..." sentence; that sentence becomes a link to the 10DLC kit's page builder.
const splitFix = (fix) => ({ fix: fix.replace(/\s*Step 3[^.]*\./, '').trim(), buildLink: /Step 3/.test(fix) });

// Pasted privacy and terms text, checked with the 10DLC kit's own rules (rules.js, unchanged).
export function policyTF({ name = '', privacy = '', terms = '' } = {}) {
  const has = { privacy: !!String(privacy).trim(), terms: !!String(terms).trim() };
  const slots = [];
  if (has.privacy) slots.push({ role: 'privacy', url: 'https://pasted.invalid/privacy', text: privacy });
  if (has.terms) slots.push({ role: 'terms', url: 'https://pasted.invalid/terms', text: terms });
  const by = slots.length ? Object.fromEntries(checkPasted(slots, { legalName: name }).results.map((r) => [r.id, r])) : {};
  const short = { privacy: has.privacy && by.P1?.status === 'fail', terms: has.terms && by.T1?.status === 'fail' };
  const rows = Object.entries(TF_RULE_CODES).map(([id, codes]) => {
    const rule = RULES[id], group = rule.group, r = by[id] || {};
    let status = r.status || 'skip', note = r.note || '';
    if (!has[group]) { status = 'skip'; note = EMPTY; }
    else if (short[group]) { if (id === 'P1' || id === 'T1') note = SHORT; else { status = 'skip'; note = 'Checked once the whole text is pasted.'; } }
    else if (id === 'T2' && status === 'skip') note = 'Not checked: add your business name.';
    else if (status === 'pass' || status === 'fail') note = '';
    return { id, title: rule.title, status, label: LABEL[status], note, codes, ...splitFix(rule.fix) };
  });
  rows.push({ id: '30519', title: 'Say what data you collect and how you use it, and link your privacy policy in your opt-in wording', status: 'manual', label: LABEL.manual, note: '', codes: ['30519'], fix: 'Check your opt-in wording by hand: link your privacy policy in it, say what data you collect and how you use it, say mobile numbers and opt-in consent are never shared with third parties for marketing, and if you send cart reminders, explain how you track web sessions and carts.', buildLink: false });
  return rows;
}
