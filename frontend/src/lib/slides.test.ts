import { describe, expect, it } from 'vitest';
import classic from '../../../quizzes/classic.json';
import { answerLine, buildSlides, hudLabels, isRevealable, jumpTargets, questionOf } from './slides';
import type { Quiz } from './types';

const quiz = classic as unknown as Quiz;
// The served quiz tags each question with its round's kind (see Quiz.public_dict on the server)
quiz.rounds.forEach(r => r.questions.forEach(q => { (q as { kind?: string }).kind = r.kind; }));

describe('slides', () => {
  const slides = buildSlides(quiz);

  it('match the server’s order (142 slides for the classic quiz)', () => {
    expect(slides).toHaveLength(142);
    expect(slides.slice(0, 4).map(s => s.type)).toEqual(['title', 'rules', 'round', 'question']);
    expect(slides.at(-2)?.type).toBe('winner');
    expect(slides.filter(s => s.type === 'halftime')).toHaveLength(1);
  });

  it('label the header like the old show did', () => {
    const q = slides.findIndex(s => s.type === 'question' && s.r === 1 && s.q === 2);
    expect(hudLabels(quiz, slides[q], 'Trivia Night')).toEqual(['Round 2: Name that flag', 'Question 3 of 8']);
    expect(hudLabels(quiz, slides[0], 'Trivia Night')).toEqual(['', '']);
  });

  it('jump targets point at real slides', () => {
    for (const [label, index] of jumpTargets(quiz, slides)) {
      expect(index, label).toBeGreaterThanOrEqual(0);
      expect(index, label).toBeLessThan(slides.length);
    }
  });

  it('format answers, including which-came-first', () => {
    const versus = slides.find(s => s.type === 'answer' && quiz.rounds[s.r!].kind === 'versus' && s.q === 1)!;
    expect(isRevealable(versus)).toBe(true);
    expect(answerLine(questionOf(quiz, versus)!)).toEqual({ a: 'B: The Berlin Wall falls (Nov 1989)', sub: '' });
    const music = slides.find(s => s.type === 'answer' && quiz.rounds[s.r!].kind === 'music' && s.q === 1)!;
    expect(answerLine(questionOf(quiz, music)!)).toEqual({ a: 'Shape of You', sub: 'Ed Sheeran' });
  });
});
