// Quiz file format, version 1: the one place that decides what a quiz may contain.
// Every quiz (built-in or, later, uploaded by strangers) goes through validateQuiz() before it is used.
// It keeps only known fields, trims and length-limits text, caps list sizes and rejects anything malformed,
// so the rest of the app can trust the shape. Text is still HTML-escaped wherever it is displayed.
(function (root) {
'use strict';

const KINDS = ['standard', 'flag', 'music', 'emoji', 'vowels', 'versus'];
const INSTRUMENTS = ['strings', 'organ', 'brass', 'piano', 'pluck'];
const LIMITS = {
  title: 40, rules: 10, ruleText: 200, icon: 16,
  rounds: 12, roundTitle: 40, blurb: 300, scoring: 160, prompt: 160, questions: 30,
  q: 300, a: 120, fact: 400, mark: 240, say: 160, hint: 160, by: 80, year: 12, emoji: 60,
  cat: 40, clue: 60, versusText: 160, versusDate: 40,
  tiebreakers: 5, tbAnswer: 60, tunes: 20, tuneNotes: 3000, tuneTokens: 600
};
const NOTE = /^(R|[A-G][#b]?-?\d)(:\d+(\.\d+)?)?$/;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const MAX_ICON_CHARS = 2; // icons are an emoji or two; "🐻‍❄️" counts as one
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter() : null;
const visibleLength = s => segmenter ? Array.from(segmenter.segment(s)).length : Array.from(s).length;

function validateQuiz(input, opts) {
  const flags = (opts && opts.flags) || {};
  const errors = [];
  const err = (path, msg) => { if (errors.length < 50) errors.push(`${path} ${msg}`); };
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

  // Text field: trimmed, control characters removed, length-checked. Returns undefined when absent.
  function text(o, k, path, max, required) {
    const v = o[k], at = `${path}.${k}`;
    if (v == null || v === '') { if (required) err(at, 'is required'); return undefined; }
    if (typeof v !== 'string' && typeof v !== 'number') { err(at, 'must be text'); return undefined; }
    const s = String(v).replace(CONTROL_CHARS, '').trim();
    if (!s) { if (required) err(at, 'is required'); return undefined; }
    if (s.length > max) { err(at, `is too long (max ${max} characters)`); return undefined; }
    return s;
  }
  function list(o, k, path, min, max) {
    const v = o[k], at = `${path}.${k}`;
    if (v == null) { if (min > 0) err(at, 'is required'); return []; }
    if (!Array.isArray(v)) { err(at, 'must be a list'); return []; }
    if (v.length < min) err(at, `needs at least ${min}`);
    if (v.length > max) { err(at, `has too many items (max ${max})`); return v.slice(0, max); }
    return v;
  }
  function int(o, k, path, lo, hi) {
    const v = o[k];
    if (v == null) return undefined;
    if (!Number.isInteger(v) || v < lo || v > hi) { err(`${path}.${k}`, `must be a whole number from ${lo} to ${hi}`); return undefined; }
    return v;
  }
  const put = (out, k, v) => { if (v !== undefined) out[k] = v; };
  function icon(o, path) {
    const s = text(o, 'icon', path, LIMITS.icon, false);
    if (s && visibleLength(s) > MAX_ICON_CHARS) { err(`${path}.icon`, `must be an emoji or two (max ${MAX_ICON_CHARS} characters)`); return undefined; }
    return s;
  }

  if (!isObj(input)) return { ok: false, errors: ['quiz must be a JSON object'], quiz: null };
  if (input.format != null && input.format !== 1) err('quiz.format', 'must be 1');

  const quiz = { format: 1 };
  put(quiz, 'title', text(input, 'title', 'quiz', LIMITS.title, true));

  quiz.rules = list(input, 'rules', 'quiz', 0, LIMITS.rules).map((r, i) => {
    const at = `quiz.rules[${i}]`, out = {};
    if (!isObj(r)) { err(at, 'must be an object'); return out; }
    put(out, 'icon', icon(r, at));
    put(out, 'text', text(r, 'text', at, LIMITS.ruleText, true));
    return out;
  });

  quiz.tunes = list(input, 'tunes', 'quiz', 0, LIMITS.tunes).map((t, i) => {
    const at = `quiz.tunes[${i}]`, out = {};
    if (!isObj(t)) { err(at, 'must be an object'); return out; }
    if (!INSTRUMENTS.includes(t.inst)) err(`${at}.inst`, `must be one of: ${INSTRUMENTS.join(', ')}`); else out.inst = t.inst;
    if (typeof t.unit !== 'number' || !(t.unit >= 0.03 && t.unit <= 1)) err(`${at}.unit`, 'must be a number of seconds from 0.03 to 1'); else out.unit = t.unit;
    put(out, 'transpose', int(t, 'transpose', at, -36, 36));
    put(out, 'double', int(t, 'double', at, -36, 36));
    const notes = text(t, 'notes', at, LIMITS.tuneNotes, true);
    if (notes) {
      const toks = notes.split(/\s+/);
      if (toks.length > LIMITS.tuneTokens) err(`${at}.notes`, `has too many notes (max ${LIMITS.tuneTokens})`);
      else {
        const bad = toks.find(tok => !NOTE.test(tok));
        if (bad) err(`${at}.notes`, `has an invalid note "${bad.slice(0, 12)}" (use e.g. C4:2, F#3:1 or R:1)`);
        else out.notes = notes;
      }
    }
    return out;
  });

  quiz.rounds = list(input, 'rounds', 'quiz', 1, LIMITS.rounds).map((r, ri) => {
    const at = `quiz.rounds[${ri}]`, out = {};
    if (!isObj(r)) { err(at, 'must be an object'); return out; }
    put(out, 'title', text(r, 'title', at, LIMITS.roundTitle, true));
    put(out, 'icon', icon(r, at));
    if (!KINDS.includes(r.kind)) err(`${at}.kind`, `must be one of: ${KINDS.join(', ')}`); else out.kind = r.kind;
    put(out, 'blurb', text(r, 'blurb', at, LIMITS.blurb, false));
    put(out, 'scoring', text(r, 'scoring', at, LIMITS.scoring, false));
    put(out, 'prompt', text(r, 'prompt', at, LIMITS.prompt, false));
    out.questions = list(r, 'questions', at, 1, LIMITS.questions).map((q, qi) => question(q, out.kind, `${at}.questions[${qi}]`));
    return out;
  });

  function question(q, kind, at) {
    const out = {};
    if (!isObj(q)) { err(at, 'must be an object'); return out; }
    const common = needsAnswer => {
      put(out, 'a', text(q, 'a', at, LIMITS.a, needsAnswer));
      put(out, 'fact', text(q, 'fact', at, LIMITS.fact, false));
      put(out, 'mark', text(q, 'mark', at, LIMITS.mark, false));
      put(out, 'say', text(q, 'say', at, LIMITS.say, false));
    };
    switch (kind) {
      case 'standard':
        put(out, 'icon', icon(q, at));
        put(out, 'q', text(q, 'q', at, LIMITS.q, true));
        common(true);
        break;
      case 'flag':
        if (q.flag != null) {
          if (typeof q.flag !== 'string' || !Object.prototype.hasOwnProperty.call(flags, q.flag)) err(`${at}.flag`, `must be a built-in flag id (${Object.keys(flags).join(', ') || 'none available'})`);
          else out.flag = q.flag;
        } else {
          put(out, 'emoji', text(q, 'emoji', at, LIMITS.emoji, true));
          put(out, 'q', text(q, 'q', at, LIMITS.q, true));
        }
        common(true);
        break;
      case 'music':
        if (q.tune != null) {
          if (!Number.isInteger(q.tune) || q.tune < 0 || q.tune >= quiz.tunes.length) err(`${at}.tune`, `must point at one of the quiz's tunes (0 to ${quiz.tunes.length - 1})`);
          else out.tune = q.tune;
        } else put(out, 'emoji', text(q, 'emoji', at, LIMITS.emoji, true));
        put(out, 'by', text(q, 'by', at, LIMITS.by, true));
        put(out, 'year', text(q, 'year', at, LIMITS.year, false));
        put(out, 'hint', text(q, 'hint', at, LIMITS.hint, false));
        common(true);
        break;
      case 'emoji':
        put(out, 'emoji', text(q, 'emoji', at, LIMITS.emoji, true));
        put(out, 'q', text(q, 'q', at, LIMITS.q, false));
        put(out, 'year', text(q, 'year', at, LIMITS.year, false));
        put(out, 'hint', text(q, 'hint', at, LIMITS.hint, false));
        common(true);
        break;
      case 'vowels': {
        put(out, 'cat', text(q, 'cat', at, LIMITS.cat, true));
        const clue = text(q, 'clue', at, LIMITS.clue, true);
        if (clue && !/^[A-Za-z0-9 ]+$/.test(clue)) err(`${at}.clue`, 'may only use letters, digits and spaces');
        else if (clue) out.clue = clue.toUpperCase().replace(/\s+/g, ' ');
        common(true);
        break;
      }
      case 'versus':
        for (const side of ['A', 'B']) {
          const o = q[side], sat = `${at}.${side}`;
          if (!isObj(o)) { err(sat, 'is required'); continue; }
          const so = {};
          put(so, 'icon', icon(o, sat));
          put(so, 'text', text(o, 'text', sat, LIMITS.versusText, true));
          put(so, 'date', text(o, 'date', sat, LIMITS.versusDate, true));
          out[side] = so;
        }
        if (q.first !== 'a' && q.first !== 'b') err(`${at}.first`, 'must be "a" or "b"'); else out.first = q.first;
        common(false);
        break;
      default:
        common(true); // the round's kind is already reported as an error
    }
    return out;
  }

  quiz.tiebreakers = list(input, 'tiebreakers', 'quiz', 0, LIMITS.tiebreakers).map((t, i) => {
    const at = `quiz.tiebreakers[${i}]`, out = {};
    if (!isObj(t)) { err(at, 'must be an object'); return out; }
    put(out, 'icon', icon(t, at));
    put(out, 'q', text(t, 'q', at, LIMITS.q, true));
    const a = text(t, 'a', at, LIMITS.tbAnswer, true);
    if (a && !/\d/.test(a)) err(`${at}.a`, 'must contain a number (closest answer wins)'); else put(out, 'a', a);
    put(out, 'say', text(t, 'say', at, LIMITS.say, false));
    put(out, 'fact', text(t, 'fact', at, LIMITS.fact, false));
    return out;
  });

  const ha = input.halftimeAfter;
  if (ha == null || ha === -1) quiz.halftimeAfter = -1;
  else if (!Number.isInteger(ha) || ha < 0 || ha >= quiz.rounds.length - 1) err('quiz.halftimeAfter', `must be -1 (no half-time) or a round number from 0 to ${quiz.rounds.length - 2}`);
  else quiz.halftimeAfter = ha;

  return { ok: errors.length === 0, errors, quiz: errors.length ? null : quiz };
}

const api = { validateQuiz, KINDS, INSTRUMENTS, LIMITS, FORMAT: 1 };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.TrivvolyQuizFormat = api;
})(this);
