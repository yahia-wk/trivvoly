// Run with: npm test   (or: node --test)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateQuiz } = require('../shared/quiz-format.js');
const FLAGS = require('../shared/flags.js');
const classic = require('../quizzes/classic.json');

const v = q => validateQuiz(q, { flags: FLAGS });
const clone = o => JSON.parse(JSON.stringify(o));
const tiny = () => ({
  title: 'Tiny quiz',
  rounds: [{ title: 'One', kind: 'standard', questions: [{ q: 'Two plus two?', a: '4' }] }]
});
const hasError = (r, text) => r.errors.some(e => e.includes(text));

test('the built-in classic quiz is valid and keeps all its content', () => {
  const r = v(classic);
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.equal(r.quiz.rounds.length, 7);
  assert.equal(r.quiz.rounds.reduce((n, x) => n + x.questions.length, 0), 56);
  assert.deepEqual(r.quiz.tiebreakers, classic.tiebreakers);
  assert.deepEqual(r.quiz.tunes, classic.tunes);
});

test('a minimal quiz is valid and gets defaults', () => {
  const r = v(tiny());
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.deepEqual(r.quiz.rules, []);
  assert.deepEqual(r.quiz.tiebreakers, []);
  assert.equal(r.quiz.halftimeAfter, -1);
});

test('unknown fields are dropped, everywhere', () => {
  const q = tiny();
  q.onload = 'alert(1)';
  q.rounds[0].html = '<b>x</b>';
  q.rounds[0].questions[0].svg = '<svg onload=alert(1)>';
  const r = v(q);
  assert.equal(r.ok, true);
  assert.equal(r.quiz.onload, undefined);
  assert.equal(r.quiz.rounds[0].html, undefined);
  assert.deepEqual(Object.keys(r.quiz.rounds[0].questions[0]).sort(), ['a', 'q']);
});

test('flags can only come from the built-in library', () => {
  const q = tiny();
  q.rounds[0].kind = 'flag';
  q.rounds[0].questions = [{ flag: '<svg onload=alert(1)>', a: 'X' }];
  assert.equal(v(q).ok, false);
  q.rounds[0].questions = [{ flag: 'estonia', a: 'Estonia' }];
  assert.equal(v(q).ok, true);
  q.rounds[0].questions = [{ flag: 'toString', a: 'X' }]; // inherited object keys aren't flags
  assert.equal(v(q).ok, false);
});

test('text is trimmed, stripped of control characters and length-limited', () => {
  const q = tiny();
  q.rounds[0].questions[0].q = '  Two\u0000 plus\u0007 two?  ';
  assert.equal(v(q).quiz.rounds[0].questions[0].q, 'Two plus two?');
  q.rounds[0].questions[0].q = 'x'.repeat(301);
  assert.ok(hasError(v(q), 'too long'));
});

test('required fields are enforced per round kind', () => {
  const q = tiny();
  delete q.rounds[0].questions[0].a;
  assert.ok(hasError(v(q), '.a is required'));

  const vs = tiny();
  vs.rounds[0].kind = 'versus';
  vs.rounds[0].questions = [{ A: { text: 'One', date: '1900' }, B: { text: 'Two', date: '1901' } }];
  assert.ok(hasError(v(vs), '.first must be'));
  vs.rounds[0].questions[0].first = 'a';
  assert.equal(v(vs).ok, true);

  const mu = tiny();
  mu.rounds[0].kind = 'music';
  mu.rounds[0].questions = [{ emoji: '🎵', a: 'Song' }];
  assert.ok(hasError(v(mu), '.by is required'));
});

test('bad kinds, clues, tunes and tiebreakers are rejected', () => {
  const k = tiny(); k.rounds[0].kind = 'html';
  assert.ok(hasError(v(k), 'kind must be one of'));

  const vw = tiny(); vw.rounds[0].kind = 'vowels';
  vw.rounds[0].questions = [{ cat: 'Animals', clue: '<script>', a: 'x' }];
  assert.ok(hasError(v(vw), 'letters, digits and spaces'));

  const t = tiny(); t.tunes = [{ inst: 'brass', unit: 0.2, notes: 'C4:1 <x>' }];
  assert.ok(hasError(v(t), 'invalid note'));
  t.tunes = [{ inst: 'kazoo', unit: 0.2, notes: 'C4:1' }];
  assert.ok(hasError(v(t), 'inst must be one of'));

  const mu = tiny(); mu.rounds[0].kind = 'music';
  mu.rounds[0].questions = [{ tune: 3, a: 'x', by: 'y' }];
  assert.ok(hasError(v(mu), 'tune must point at'));

  const tb = tiny(); tb.tiebreakers = [{ q: 'How many?', a: 'lots' }];
  assert.ok(hasError(v(tb), 'must contain a number'));
});

test('icons are limited to an emoji or two', () => {
  const q = tiny();
  q.rounds[0].icon = '🐻‍❄️';
  assert.equal(v(q).ok, true);
  q.rounds[0].icon = '<b>x</b>';
  assert.ok(hasError(v(q), 'an emoji or two'));
});

test('sizes and structure are capped', () => {
  const big = tiny();
  big.rounds = Array.from({ length: 13 }, () => clone(tiny().rounds[0]));
  assert.ok(hasError(v(big), 'too many items'));
  const ha = tiny(); ha.halftimeAfter = 5;
  assert.ok(hasError(v(ha), 'halftimeAfter'));
  assert.equal(v(null).ok, false);
  assert.equal(v([]).ok, false);
  assert.equal(v('quiz').ok, false);
});
