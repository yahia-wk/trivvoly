// Built-in quizzes (quizzes/*.json) and uploaded quizzes. One bad quiz never stops the server:
// a broken built-in file is skipped with a warning, a broken upload is refused with its list of problems.
'use strict';
const fs = require('fs'), path = require('path');
const { validateQuiz } = require('../shared/quiz-format.js');
const FLAGS = require('../shared/flags.js');

const MAX_QUIZ_BYTES = 500 * 1024;
const ID = /^[a-z0-9][a-z0-9-]{0,40}$/;

function check(data, label) {
  const r = validateQuiz(data, { flags: FLAGS });
  return r.ok ? { quiz: r.quiz } : { errors: r.errors.map(e => (label ? `${label}: ` : '') + e) };
}
function summary(id, quiz) {
  return { id, title: quiz.title, rounds: quiz.rounds.length, questions: quiz.rounds.reduce((n, r) => n + r.questions.length, 0) };
}

function readQuizFile(file) {
  try {
    if (fs.statSync(file).size > MAX_QUIZ_BYTES) return { errors: [`${path.basename(file)} is bigger than ${MAX_QUIZ_BYTES / 1024} KB`] };
    const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\s+/, '')); // \s also covers a byte order mark
    return check(data, path.basename(file));
  } catch (e) {
    return { errors: [`${path.basename(file)} can't be read: ${e.message}`] };
  }
}

/** Load every quiz in `dir` (plus optional extra files). Returns { quizzes: Map(id -> {id, quiz, summary}), warnings }. */
function loadLibrary(dir, extraFiles = []) {
  const quizzes = new Map(), warnings = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => path.join(dir, f)); } catch (e) { warnings.push(`Can't read ${dir}: ${e.message}`); }
  for (const file of [...files, ...extraFiles]) {
    const id = path.basename(file, '.json').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    if (!ID.test(id)) { warnings.push(`${path.basename(file)}: skipped (file name must be letters, digits and dashes)`); continue; }
    if (quizzes.has(id)) { warnings.push(`${path.basename(file)}: skipped (another quiz is already called "${id}")`); continue; }
    const r = readQuizFile(file);
    if (r.errors) { warnings.push(...r.errors.slice(0, 10), `${path.basename(file)}: skipped`); continue; }
    quizzes.set(id, { id, quiz: r.quiz, summary: summary(id, r.quiz) });
  }
  return { quizzes, warnings };
}

module.exports = { loadLibrary, check, summary, MAX_QUIZ_BYTES };
