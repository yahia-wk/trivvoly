import { describe, expect, it } from 'vitest';
import classic from '../../../../quizzes/classic.json';
import { at, blankQuestion, describePath, convertQuestion, parseProblems, tagKinds, toFile, under, vowelClue } from './draft';

describe('the quiz builder’s draft', () => {
  it('round-trips a quiz file: tags kinds for editing, strips them for saving', () => {
    const draft = tagKinds(classic);
    expect((draft.rounds[1].questions[0] as { kind: string }).kind).toBe('flag');
    expect(toFile(draft)).toEqual({ ...classic, rules: classic.rules, tiebreakers: classic.tiebreakers, tunes: classic.tunes });
  });

  it('keeps the answer, fact and marking note when a question changes kind', () => {
    const q = { ...blankQuestion('standard'), q: 'Capital of France?', a: 'Paris', fact: 'On the Seine.', mark: '“Paree” counts.' };
    const flag = convertQuestion(q, 'flag') as { kind: string; a: string; fact: string; mark: string; q?: string };
    expect(flag).toMatchObject({ kind: 'flag', a: 'Paris', fact: 'On the Seine.', mark: '“Paree” counts.' });
    expect(flag.q).toBeUndefined();
    expect(convertQuestion(q, 'versus')).not.toHaveProperty('a');
  });

  it('makes missing-vowels clues from the answer', () => {
    const clue = vowelClue('Hippopotamus');
    expect(clue.replace(/ /g, '')).toBe('HPPPTMS');
    expect(clue).toMatch(/^[A-Z ]+$/);
    expect(vowelClue('Café au lait!').replace(/ /g, '')).toBe('CFLT');
  });

  it('matches the server’s problems to fields', () => {
    const problems = parseProblems(['quiz.rounds[1].questions[2].a is required', 'quiz.title is too long (max 40 characters)', 'quiz must be a JSON object']);
    expect(at(problems, 'quiz.rounds[1].questions[2].a')).toBe('is required');
    expect(under(problems, 'quiz.rounds[1]')).toHaveLength(1);
    expect(under(problems, 'quiz.rounds[10]')).toHaveLength(0);
    expect(at(problems, 'quiz.title')).toBe('is too long (max 40 characters)');
    expect(problems[2]).toEqual({ path: 'quiz', message: 'must be a JSON object' });
  });

  it('says where a problem is in words', () => {
    expect(describePath('quiz.rounds[0].questions[2].a')).toBe('Round 1, question 3, answer');
    expect(describePath('quiz.tiebreakers[1].q')).toBe('Tiebreaker 2, question');
    expect(describePath('quiz.rounds[3].questions[0].A.date')).toBe('Round 4, question 1, event A, date');
    expect(describePath('quiz')).toBe('The quiz');
  });
});
