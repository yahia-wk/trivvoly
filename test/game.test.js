// The rules of one game, without any HTTP. Run with: npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('../lib/game.js');
const { createRooms } = require('../lib/rooms.js');

const quiz = { title: 'T', rules: [], tunes: [], tiebreakers: [], halftimeAfter: -1, rounds: [{ title: 'R', kind: 'standard', questions: [{ q: 'q?', a: 'a' }] }] };
const slide = (type, extra = {}) => ({ slide: { type, i: 1, r: 0, open: [], infos: [], ...extra } });

test('question keys from browsers can never become object keys like __proto__', () => {
  const g = createGame({});
  const t = g.join('Team A').team;
  g.host('slide', slide('question', { open: ['__proto__', 'constructor', '0-0'], infos: [{ qk: '__proto__', text: 'x' }, { qk: '0-0', text: 'ok' }] }));
  assert.deepEqual(g.state.slide.open, ['0-0']);
  assert.deepEqual(Object.keys(g.state.qinfo), ['0-0']);
  assert.equal(g.player('answer', t, { qk: '__proto__', a: 'x' })[0], 409);
  assert.equal(g.player('answer', t, { qk: '0-0', a: 'my answer' })[0], 200);
  g.host('mark', { qk: '__proto__', teamId: t.id, pts: 1 });
  g.host('joker', { teamId: '__proto__', r: 1 });
  g.host('marks', { marks: [{ qk: 'constructor', teamId: t.id, pts: 1 }] });
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(g.state.answers, '__proto__'), false);
  assert.equal(g.state.answers['0-0'][t.id].a, 'my answer');
});

test('slides from the quizmaster page are cleaned before phones see them', () => {
  const g = createGame({});
  g.host('slide', slide('question', {
    hud: ['<b>x</b>'.repeat(50)], evil: 'drop me',
    q: { qk: '0-0', text: 'Q', flag: '<svg onload=alert(1)>', A: { text: 'a', extra: 1 } },
    timer: { running: true, left: -5, total: 'x' }
  }));
  const s = g.state.slide;
  assert.equal(s.evil, undefined);
  assert.ok(s.hud[0].length <= 120);
  assert.equal(s.q.flag, undefined, 'flags must be a plain library name');
  assert.deepEqual(s.q.A, { icon: '', text: 'a' });
  assert.deepEqual(s.timer, { mode: '', running: true, done: false, total: 0, left: 0 });
  g.host('slide', { slide: { type: 'not-a-slide' } });
  assert.equal(g.state.slide, null);
});

test('team names are checked; dispute reasons are starred out', () => {
  const g = createGame({});
  assert.ok(g.join('Sh1t Kickers').error);
  assert.ok(g.join('   ').error);
  const a = g.join('Pussycats').team, b = g.join('Brainiacs').team;
  assert.ok(a && b);
  assert.equal(g.join('brainiacs').error[0], 409, 'names are unique, ignoring case');
  // round 0: answer, pens down (pairs teams), reveal, mark, dispute
  g.host('slide', slide('question', { open: ['0-0'], infos: [{ qk: '0-0', text: 'q' }] }));
  g.player('answer', a, { qk: '0-0', a: 'x' });
  g.host('slide', slide('swap'));
  g.host('slide', slide('answer', { key: { qk: '0-0', a: 'a' } }));
  assert.equal(g.player('peermark', b, { qk: '0-0', pts: 0 })[0], 200);
  assert.equal(g.player('peermark', b, { qk: '0-0', pts: 7 })[0], 400);
  assert.equal(g.player('dispute', a, { qk: '0-0', reason: 'that is bullshit' })[0], 200);
  assert.match(g.state.disputes['0-0'][a.id].reason, /^that is bull\W+$/);
});

test('a full game is limited to 40 teams', () => {
  const g = createGame({});
  for (let i = 0; i < 40; i++) assert.ok(g.join('Team ' + i).team);
  assert.equal(g.join('One too many').error[0], 403);
});

test('rooms expire and take their data with them', () => {
  const rooms = createRooms({ stateFile: null });
  const { room } = rooms.create({ quiz, ip: '1.2.3.4' });
  assert.match(room.code, /^[A-Z2-9]{6}$/);
  assert.match(room.hostKey, /^[a-f0-9]{32}$/);
  assert.equal(rooms.get(room.code), room);
  assert.equal(rooms.get('__proto__'), null);
  room.createdAt -= rooms.config.lifetime + 1;
  rooms.sweep();
  assert.equal(rooms.get(room.code), null);
});

test('one address can only run a few rooms at once', () => {
  const rooms = createRooms({ stateFile: null });
  for (let i = 0; i < rooms.config.maxRoomsPerIp; i++) assert.ok(rooms.create({ quiz, ip: '9.9.9.9' }).room);
  assert.equal(rooms.create({ quiz, ip: '9.9.9.9' }).error[0], 429);
  assert.ok(rooms.create({ quiz, ip: '8.8.8.8' }).room);
});
