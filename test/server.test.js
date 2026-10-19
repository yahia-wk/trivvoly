// Starts the real server (temporary state file) and talks to it like browsers would. Run with: npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trivvoly-test-'));
const PORT = 3911, BASE = `http://localhost:${PORT}`;
const LS = String.fromCharCode(0x2028);

// A quiz file that is broken on purpose: the server must skip it and keep going
const broken = path.join(tmp, 'broken.json');
fs.writeFileSync(broken, JSON.stringify({ title: 'Broken', rounds: [{ title: 'R', kind: 'nope', questions: [] }] }));

let proc, out = '';
test.before(async () => {
  proc = spawn(process.execPath, [path.join(ROOT, 'server.js'), '--quiz', broken], {
    env: { ...process.env, PORT: String(PORT), TRIVVOLY_STATE: path.join(tmp, 'state.json'), PUBLIC_URL: '', TRIVVOLY_MAX_ROOMS_PER_IP: '100' } // the per-address cap has its own unit test
  });
  proc.stdout.on('data', d => { out += d; });
  proc.stderr.on('data', d => { out += d; });
  for (let i = 0; i < 100 && !out.includes('Trivvoly is live'); i++) await new Promise(r => setTimeout(r, 50));
  assert.ok(out.includes('Trivvoly is live'), out);
});
test.after(() => { proc.kill(); fs.rmSync(tmp, { recursive: true, force: true }); });

/** A tiny browser: keeps cookies per path like a real one. */
function browser() {
  const jar = [];
  const cookieFor = p => jar.filter(c => p === c.path || p.startsWith(c.path + '/') || c.path === '/').map(c => `${c.name}=${c.value}`).join('; ');
  async function req(method, p, body, headers = {}) {
    const h = { ...headers };
    const ck = cookieFor(p.split('?')[0]); if (ck) h.cookie = ck;
    if (body !== undefined && !h['content-type']) h['content-type'] = 'application/json';
    const res = await fetch(BASE + p, { method, headers: h, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)), redirect: 'manual' });
    for (const sc of res.headers.getSetCookie()) {
      const [nv, ...attrs] = sc.split(';').map(s => s.trim());
      const [name, value] = [nv.slice(0, nv.indexOf('=')), nv.slice(nv.indexOf('=') + 1)];
      const pathAttr = attrs.find(a => a.toLowerCase().startsWith('path='));
      const c = { name, value, path: pathAttr ? pathAttr.slice(5) : '/', raw: sc };
      const i = jar.findIndex(x => x.name === name && x.path === c.path);
      if (i >= 0) jar[i] = c; else jar.push(c);
    }
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
    return { status: res.status, headers: res.headers, text, json };
  }
  return { jar, get: (p, h) => req('GET', p, undefined, h), post: (p, b, h) => req('POST', p, b, h) };
}
async function newRoom(b, body = { quizId: 'classic' }) {
  const r = await b.post('/api/rooms', body);
  assert.equal(r.status, 200, r.text);
  return r.json;
}

test('a broken quiz file is skipped, not fatal', async () => {
  assert.match(out, /broken\.json.*kind must be one of/);
  const r = await browser().get('/api/quizzes');
  assert.deepEqual(r.json.quizzes.map(q => q.id), ['classic']);
});

test('the landing page has a strict content security policy with nonces', async () => {
  const r = await browser().get('/');
  assert.equal(r.status, 200);
  const csp = r.headers.get('content-security-policy');
  const nonce = /'nonce-([^']+)'/.exec(csp)[1];
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp));
  assert.ok(r.text.includes(`<script nonce="${nonce}"`));
  assert.ok(!/<script(?![^>]*nonce=)/.test(r.text), 'every script tag carries the nonce');
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
});

test('creating a room gives the creator a room-only, HttpOnly quizmaster cookie', async () => {
  const b = browser();
  const room = await newRoom(b);
  assert.match(room.code, /^[A-Z2-9]{6}$/);
  assert.match(room.hostUrl, new RegExp(`^/r/${room.code}/host#k=[a-f0-9]{32}$`));
  const ck = b.jar.find(c => c.name === 'tvh');
  assert.equal(ck.path, `/r/${room.code}`);
  assert.match(ck.raw, /HttpOnly/); assert.match(ck.raw, /SameSite=Strict/);
  const show = await b.get(`/r/${room.code}/host`);
  assert.ok(show.text.includes('window.QUIZ = {'), 'the creator gets the show with the quiz');
  assert.ok(show.text.includes(`"code":"${room.code}"`));
});

test('the quizmaster screen needs the key; the key travels in the #fragment', async () => {
  const owner = browser(), stranger = browser();
  const room = await newRoom(owner);
  const page = await stranger.get(`/r/${room.code}/host`);
  assert.equal(page.status, 200);
  assert.ok(!page.text.includes('window.QUIZ = {'), 'no answers without the key');
  assert.ok(page.text.includes('location.hash'), 'serves the claim page instead');
  assert.equal((await stranger.post(`/r/${room.code}/claim`, { key: 'wrong' })).status, 403);
  assert.equal((await stranger.post(`/r/${room.code}/host/mark`, { qk: '0-0', teamId: 'aaaaaaaa', pts: 1 })).status, 403);
  const key = room.hostUrl.split('#k=')[1];
  assert.equal((await stranger.post(`/r/${room.code}/claim`, { key })).status, 200);
  assert.ok((await stranger.get(`/r/${room.code}/remote`)).text.includes('Quizmaster remote'));
});

test('uploaded quizzes are checked, and their text cannot break out of the page', async () => {
  const b = browser();
  const bad = await b.post('/api/rooms', { quiz: { title: 'x', rounds: [] } });
  assert.equal(bad.status, 422);
  assert.ok(bad.json.problems.some(p => p.includes('rounds')));
  const evil = { title: '</script><script>alert(1)</script>', rounds: [{ title: 'R', kind: 'standard', questions: [{ icon: '<>', q: `</script>${LS}x`, a: 'a' }] }] };
  const room = await newRoom(b, { quiz: evil });
  const html = (await b.get(`/r/${room.code}/host`)).text;
  const start = html.indexOf('window.QUIZ = '), injected = html.slice(start, html.indexOf('window.ROOM', start));
  assert.ok(!injected.includes('</script'));
  assert.ok(!injected.includes(LS));
  assert.equal(JSON.parse(injected.slice('window.QUIZ = '.length).replace(/;\s*$/, '')).title, evil.title);
});

test('teams join with a cookie that only works in their own room', async () => {
  const host = browser(), phone = browser();
  const a = await newRoom(host), bRoom = await newRoom(host);
  const joined = await phone.post(`/r/${a.code}/join`, { name: 'Quizzly Bears' });
  assert.equal(joined.status, 200, joined.text);
  const ck = phone.jar.find(c => c.name === 'tvp');
  assert.equal(ck.path, `/r/${a.code}`); assert.match(ck.raw, /HttpOnly/);
  assert.equal((await phone.post(`/r/${a.code}/join`, { name: 'Again' })).json.name, 'Quizzly Bears', 'rejoining keeps the team');
  // Same cookie value sent to another room is rejected
  const forged = await phone.post(`/r/${bRoom.code}/answer`, { qk: '0-0', a: 'x' }, { cookie: `tvp=${ck.value}` });
  assert.equal(forged.status, 401);
  // A team can't use quizmaster actions
  assert.equal((await phone.post(`/r/${a.code}/host/kick`, { all: true })).status, 403);
  assert.equal((await phone.post(`/r/${a.code}/join`, {}, {})).status, 200);
  const rude = await browser().post(`/r/${a.code}/join`, { name: 'Sh1t Kickers' });
  assert.equal(rude.status, 400);
});

test('cross-site, non-JSON and oversized requests are refused', async () => {
  const b = browser();
  assert.equal((await b.post('/api/rooms', { quizId: 'classic' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await b.post('/api/rooms', 'quizId=classic', { 'content-type': 'application/x-www-form-urlencoded' })).status, 415);
  const room = await newRoom(b);
  const huge = await b.post(`/r/${room.code}/host/mark`, { pad: 'x'.repeat(20000) });
  assert.equal(huge.status, 413);
});

test('ending a game deletes it for everyone', async () => {
  const b = browser();
  const room = await newRoom(b);
  assert.equal((await b.post(`/r/${room.code}/host/end`, {})).status, 200);
  const r = await b.get(`/r/${room.code}`);
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), `/?missing=${room.code}`);
});

test('guessing room codes gets rate limited', async () => {
  const b = browser();
  let limited = false;
  for (let i = 0; i < 40 && !limited; i++) limited = (await b.get('/r/ZZZZZ' + 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[i % 32])).status === 429;
  assert.ok(limited);
});
