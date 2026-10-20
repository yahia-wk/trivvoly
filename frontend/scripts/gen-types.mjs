// Generates src/lib/quiz.gen.ts from the backend's Pydantic quiz models, so the two can't drift.
// Run after changing backend/trivvoly/quiz.py:  npm run gen:types
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'json-schema-to-typescript';

const here = dirname(fileURLToPath(import.meta.url));
const backend = join(here, '..', '..', 'backend');
const python = [join(backend, '.venv', 'Scripts', 'python.exe'), join(backend, '.venv', 'bin', 'python')].find(existsSync) || 'python';
const schema = JSON.parse(execFileSync(python, ['-m', 'trivvoly.schema'], { cwd: backend, encoding: 'utf8' }));
const ts = await compile(schema, 'Quiz', {
  bannerComment: '/* Generated from backend/trivvoly/quiz.py by `npm run gen:types`. Do not edit by hand. */',
  additionalProperties: false,
  unreachableDefinitions: true,
  ignoreMinAndMaxItems: true
});
writeFileSync(join(here, '..', 'src', 'lib', 'quiz.gen.ts'), ts);
console.log('Wrote src/lib/quiz.gen.ts');
