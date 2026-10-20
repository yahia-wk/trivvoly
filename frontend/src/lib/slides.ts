// The order of slides, mirroring build_slides() in backend/trivvoly/game.py, plus the labels
// and jump targets the quizmaster's screens show.
import type { Question, Quiz, Slide } from './types';

export function buildSlides(quiz: Quiz): Slide[] {
  const slides: Slide[] = [{ type: 'title' }, { type: 'rules' }];
  quiz.rounds.forEach((round, r) => {
    slides.push({ type: 'round', r });
    round.questions.forEach((_, q) => slides.push({ type: 'question', r, q }));
    slides.push({ type: 'swap', r });
    round.questions.forEach((_, q) => slides.push({ type: 'answer', r, q }));
    slides.push({ type: 'standings', r });
    if (r === (quiz.halftimeAfter ?? -1)) slides.push({ type: 'halftime' });
  });
  const tbs = quiz.tiebreakers ?? [];
  if (tbs.length) slides.push({ type: 'tbIntro' });
  tbs.forEach((_, t) => slides.push({ type: 'tb', t }));
  slides.push({ type: 'winner' }, { type: 'end' });
  return slides;
}

export const isRevealable = (s: Slide) => s.type === 'answer' || s.type === 'tb' || s.type === 'winner';
export const isTimed = (s: Slide) => s.type === 'question' || s.type === 'tb';

export function questionOf(quiz: Quiz, s: Slide): Question | null {
  return (s.type === 'question' || s.type === 'answer') && s.r != null && s.q != null ? quiz.rounds[s.r].questions[s.q] as Question : null;
}

/** [left, right] labels in the big screen's header. */
export function hudLabels(quiz: Quiz, s: Slide, quizName: string): [string, string] {
  const rc = quiz.rounds.length, r = s.r != null ? quiz.rounds[s.r] : null;
  switch (s.type) {
    case 'title': return ['', ''];
    case 'rules': return ['House rules', ''];
    case 'round': return [`Round ${s.r! + 1} of ${rc}`, ''];
    case 'question': return [`Round ${s.r! + 1}: ${r!.title}`, `Question ${s.q! + 1} of ${r!.questions.length}`];
    case 'swap': return [`Round ${s.r! + 1}: ${r!.title}`, 'Marking time'];
    case 'answer': return [`Round ${s.r! + 1} answers: ${r!.title}`, `Answer ${s.q! + 1} of ${r!.questions.length}`];
    case 'standings': return ['Scoreboard', `After round ${s.r! + 1} of ${rc}`];
    case 'halftime': return ['Half-time', ''];
    case 'tbIntro': return ['Tiebreaker', ''];
    case 'tb': return ['Tiebreaker', `Question ${s.t! + 1} of ${(quiz.tiebreakers ?? []).length}`];
    default: return [quizName, ''];
  }
}

export function jumpTargets(quiz: Quiz, slides: Slide[]): [string, number][] {
  const find = (pred: (s: Slide) => boolean) => slides.findIndex(pred);
  const out: [string, number][] = [['Title', 0], ['House rules', 1]];
  quiz.rounds.forEach((round, k) => {
    out.push([`Round ${k + 1}: ${round.title}`, find(x => x.type === 'round' && x.r === k)]);
    out.push([`Round ${k + 1} answers`, find(x => x.type === 'swap' && x.r === k)]);
    if (k === quiz.halftimeAfter) out.push(['Half-time', find(x => x.type === 'halftime')]);
  });
  if ((quiz.tiebreakers ?? []).length) out.push(['Tiebreaker', find(x => x.type === 'tbIntro')]);
  out.push(['Winner', find(x => x.type === 'winner')]);
  return out;
}

/** The correct answer as one line ("B: The Berlin Wall falls (Nov 1989)" for versus questions). */
export function answerLine(q: Question): { a: string; sub: string } {
  if (q.kind === 'versus') {
    const side = q.first === 'a' ? q.A : q.B;
    return { a: `${q.first.toUpperCase()}: ${side.text} (${side.date})`, sub: '' };
  }
  return { a: q.a, sub: q.kind === 'music' ? q.by : '' };
}
