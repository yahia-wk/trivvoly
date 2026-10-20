// The quiz being edited. Questions carry their round's `kind` while editing (so the generated types
// can tell them apart); files and uploads use the plain file format without it.
import type { Question, Quiz, Round } from '../../lib/types';

export type Kind = Round['kind'];
export type Tune = NonNullable<Quiz['tunes']>[number];
export type Tiebreaker = NonNullable<Quiz['tiebreakers']>[number];
export type Rule = NonNullable<Quiz['rules']>[number];

export const KINDS: { kind: Kind; label: string; hint: string }[] = [
  { kind: 'standard', label: 'Questions', hint: 'A question and its answer.' },
  { kind: 'flag', label: 'Flags', hint: 'A built-in flag, or emoji clues and a question.' },
  { kind: 'music', label: 'Music', hint: 'A tune played live, or emoji clues. Bonus point for the artist.' },
  { kind: 'emoji', label: 'Emoji', hint: 'Emoji clues for a film, show, book…' },
  { kind: 'vowels', label: 'Missing vowels', hint: 'The answer with its vowels taken out and the spaces moved.' },
  { kind: 'versus', label: 'Which came first', hint: 'Two events: which happened first, A or B?' }
];
export const kindLabel = (k: Kind) => KINDS.find(x => x.kind === k)!.label;

export const DEFAULT_RULES: Rule[] = [
  { icon: '👥', text: 'Teams of up to six. Pick a team name, the sillier the better.' },
  { icon: '📵', text: 'Phones away. No searching and no texting your clever cousin.' },
  { icon: '📝', text: 'Write every answer down. A guess can score; a blank never does.' },
  { icon: '🃏', text: 'Each team has one joker that doubles its points for one round. Play it before that round starts.' },
  { icon: '✅', text: 'Spelling doesn’t count, as long as the answer is clearly right.' },
  { icon: '🎤', text: 'The quizmaster’s decision is final. Bribes are welcome, though.' }
];

export function blankQuestion(kind: Kind): Question {
  switch (kind) {
    case 'standard': return { kind, icon: '❓', q: '', a: '' };
    case 'flag': return { kind, flag: 'estonia', a: '' };
    case 'music': return { kind, emoji: '', a: '', by: '' };
    case 'emoji': return { kind, emoji: '', a: '' };
    case 'vowels': return { kind, cat: '', clue: '', a: '' };
    case 'versus': return { kind, A: { icon: '', text: '', date: '' }, B: { icon: '', text: '', date: '' }, first: 'a' };
  }
}

export function blankRound(kind: Kind, n: number): Round {
  return { title: `Round ${n}`, icon: '🎲', kind, blurb: 'Pens at the ready: answers on your phones, please.', scoring: '1 point each.', questions: [blankQuestion(kind)] };
}

export function blankQuiz(): Quiz {
  return { format: 1, title: 'My quiz', rules: DEFAULT_RULES.map(r => ({ ...r })), rounds: [blankRound('standard', 1)], tiebreakers: [], tunes: [], halftimeAfter: -1 };
}

/** Moving a question to another round kind keeps what still makes sense (the answer, the fact, the marking note). */
export function convertQuestion(q: Question, kind: Kind): Question {
  const next = blankQuestion(kind) as unknown as Record<string, unknown>;
  const old = q as unknown as Record<string, unknown>;
  for (const k of ['fact', 'mark', 'say']) if (old[k] != null) next[k] = old[k]; // every kind has these
  if ('a' in next && old.a != null) next.a = old.a;                             // every kind but versus
  return next as unknown as Question;
}

/** Files don't carry the kind tag; add it from each round. */
export function tagKinds(raw: unknown): Quiz {
  const quiz = structuredClone(raw) as Quiz;
  for (const r of quiz.rounds ?? []) r.questions = (r.questions ?? []).map(q => ({ ...q, kind: r.kind }) as Question);
  quiz.rules ??= []; quiz.tiebreakers ??= []; quiz.tunes ??= []; quiz.halftimeAfter ??= -1;
  return quiz;
}

/** The plain file format (as in quizzes/*.json). */
export function toFile(quiz: Quiz): Quiz {
  const out = structuredClone(quiz);
  for (const r of out.rounds) r.questions = r.questions.map(q => { const { kind: _k, ...rest } = q as Question & { kind?: string }; return rest as Question; });
  return out;
}

/** A missing-vowels clue: consonants only, regrouped so the word breaks don't give it away. */
export function vowelClue(answer: string): string {
  const letters = answer.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]/g, '').replace(/[AEIOU]/g, '');
  const groups: string[] = [];
  let i = 0, seed = letters.length;
  while (i < letters.length) {
    seed = (seed * 9301 + 49297) % 233280; // simple repeatable shuffle of group sizes
    const size = Math.min(letters.length - i, 2 + (seed % 3));
    groups.push(letters.slice(i, i + size));
    i += size;
  }
  return groups.join(' ');
}

/* ---------- Problems from the server's check, matched to where they belong ---------- */

export interface Problem { path: string; message: string }

export function parseProblems(list: string[]): Problem[] {
  return list.map(p => {
    const m = /^(quiz(?:\.[A-Za-z_]+|\[\d+\])*)\s+(.*)$/.exec(p);
    return m ? { path: m[1], message: m[2] } : { path: 'quiz', message: p };
  });
}

/** Problems at a path or under it, e.g. under('quiz.rounds[1]') covers its questions too. */
export const under = (problems: Problem[], path: string) => problems.filter(p => p.path === path || p.path.startsWith(path + '.') || p.path.startsWith(path + '['));
/** The first problem exactly at a field. */
export const at = (problems: Problem[], path: string) => problems.find(p => p.path === path)?.message;

const FIELD_NAMES: Record<string, string> = {
  a: 'answer', q: 'question', by: 'artist', cat: 'category', clue: 'clue', emoji: 'emoji clues', blurb: 'blurb', scoring: 'scoring',
  fact: 'fact', mark: 'marking note', say: 'read-aloud text', A: 'event A', B: 'event B', text: 'event', date: 'date', first: 'which came first',
  halftimeAfter: 'half-time', notes: 'notes', unit: 'seconds per beat', inst: 'instrument', tune: 'tune', flag: 'flag'
};
const LISTS: Record<string, string> = { rounds: 'Round', questions: 'question', tiebreakers: 'Tiebreaker', tunes: 'Tune', rules: 'Rule' };

/** Where a problem is, in words: 'quiz.rounds[0].questions[2].a' → 'Round 1, question 3, answer'. */
export function describePath(path: string): string {
  const parts: string[] = [];
  for (const m of path.replace(/^quiz\.?/, '').matchAll(/([A-Za-z_]+)(?:\[(\d+)\])?/g)) {
    const [, name, i] = m;
    parts.push(i != null && LISTS[name] ? `${LISTS[name]} ${+i + 1}` : FIELD_NAMES[name] ?? name);
  }
  return parts.join(', ') || 'The quiz';
}
