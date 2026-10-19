// Starts the real server against a temporary quiz and state file. Run with: npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trivvoly-test-'));

function startServer(quiz, port) {
  const quizFile = path.join(tmp, `quiz-${port}.json`);
  fs.writeFileSync(quizFile, typeof quiz === 'string' ? quiz : JSON.stringify(quiz));
  const proc = spawn(process.execPath, [path.join(ROOT, 'server.js'), '--quiz', quizFile], {
    env: { ...process.env, PORT: String(port), TRIVVOLY_STATE: path.join(tmp, `state-${port}.json`) }
  });
  let out = '';
  proc.stdout.on('data', d => { out += d; });
  proc.stderr.on('data', d => { out += d; });
  const ready = new Promise((resolve, reject) => {
    const iv = setInterval(() => {
      const key = /key=([a-f0-9]+)/.exec(out);
      if (key) { clearInterval(iv); resolve(key[1]); }
    }, 50);
    proc.on('exit', code => { clearInterval(iv); reject(Object.assign(new Error('server exited'), { code, out: () => out })); });
  });
  ready.catch(() => {}); // a server we kill on purpose also "exits"
  return { proc, ready, out: () => out };
}

const evil = {
  title: 'Evil </script><script>alert(1)</script>',
  rounds: [{ title: 'R', kind: 'standard', questions: [{ icon: '<>', q: '</script><script>alert(2)</script>', a: ' x' }] }]
};

test('quiz text cannot break out of the page', async t => {
  const s = startServer(evil, 3911);
  t.after(() => s.proc.kill());
  const key = await s.ready;
  const res = await fetch(`http://localhost:3911/host?key=${key}`);
  assert.equal(res.status, 200);
  const html = await res.text();
  const injected = html.slice(html.indexOf('window.QUIZ = '), html.indexOf('</script>', html.indexOf('window.QUIZ = ')));
  assert.ok(!/<\/script/i.test(injected), 'no closing script tag inside the injected quiz');
  assert.ok(!injected.includes(' '), 'no raw line separators');
  // And it still decodes to exactly the quiz text
  const json = injected.replace('window.QUIZ = ', '').trim().replace(/;$/, '');
  assert.equal(JSON.parse(json).rounds[0].questions[0].q, '</script><script>alert(2)</script>');
});

test('pages with answers need the key, and send privacy headers', async t => {
  const s = startServer(evil, 3912);
  t.after(() => s.proc.kill());
  await s.ready;
  assert.equal((await fetch('http://localhost:3912/host')).status, 403);
  assert.equal((await fetch('http://localhost:3912/remote?key=nope')).status, 403);
  const play = await fetch('http://localhost:3912/');
  assert.equal(play.status, 200);
  assert.equal(play.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(play.headers.get('x-frame-options'), 'DENY');
  const shared = await fetch('http://localhost:3912/shared/flags.js');
  assert.match(shared.headers.get('content-type'), /javascript/);
  assert.equal((await fetch('http://localhost:3912/shared/../server.js')).status, 404);
});

test('an invalid quiz stops the server with a clear message', async () => {
  const s = startServer({ title: 'Broken', rounds: [{ title: 'R', kind: 'nope', questions: [] }] }, 3913);
  await assert.rejects(s.ready, e => {
    assert.equal(e.code, 1);
    assert.match(e.out(), /kind must be one of/);
    return true;
  });
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
