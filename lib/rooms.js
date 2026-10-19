// Rooms: one game each, found by a short code, run by whoever holds the room's secret key.
// Rooms expire on their own, and their data (team names, answers) is deleted with them.
'use strict';
const fs = require('fs'), crypto = require('crypto');
const { createGame } = require('./game.js');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I mix-ups
const CODE_LENGTH = 6;                                     // 32^6 ≈ 1 billion codes
const CODE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);
const HOUR = 60 * 60 * 1000;

const config = {
  maxRooms: +process.env.TRIVVOLY_MAX_ROOMS || 300,
  maxRoomsPerIp: +process.env.TRIVVOLY_MAX_ROOMS_PER_IP || 5,
  lifetime: 12 * HOUR,  // a room never lives longer than this
  idle: 3 * HOUR        // ...or this long without anything happening
};

function newCode(taken) {
  for (;;) {
    let c = '';
    for (let i = 0; i < CODE_LENGTH; i++) c += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if (!taken.has(c)) return c;
  }
}

function createRooms({ stateFile, log = () => {} }) {
  const rooms = new Map();
  let saveT = null;

  function save() {
    if (!stateFile) return;
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      const data = { version: 2, rooms: [...rooms.values()].map(r => ({ code: r.code, hostKey: r.hostKey, quiz: r.quiz, quizId: r.quizId, ip: r.ip, createdAt: r.createdAt, lastActive: r.lastActive, state: r.game.state })) };
      const tmp = stateFile + '.tmp';
      fs.writeFile(tmp, JSON.stringify(data), err => { if (!err) fs.rename(tmp, stateFile, () => {}); });
    }, 1000);
  }

  function attach(r, saved) {
    r.game = createGame({ saved, onChange: () => { r.lastActive = Date.now(); save(); } });
    rooms.set(r.code, r);
    return r;
  }

  function create({ quiz, quizId, ip }) {
    if (rooms.size >= config.maxRooms) return { error: [503, 'Trivvoly is very busy right now. Please try again in a little while.'] };
    if ([...rooms.values()].filter(r => r.ip === ip).length >= config.maxRoomsPerIp) return { error: [429, `You already have ${config.maxRoomsPerIp} games running. End one first, or wait for it to expire.`] };
    const now = Date.now();
    const r = attach({ code: newCode(rooms), hostKey: crypto.randomBytes(16).toString('hex'), quiz, quizId: quizId || null, ip, createdAt: now, lastActive: now });
    save();
    log(`room ${r.code} created (${quiz.title})`);
    return { room: r };
  }

  const get = code => (typeof code === 'string' && CODE.test(code) && rooms.get(code)) || null;

  function remove(code, why) {
    const r = rooms.get(code);
    if (!r) return;
    r.game.close();
    rooms.delete(code);
    save();
    log(`room ${code} ${why}`);
  }

  function sweep() {
    const now = Date.now();
    for (const r of rooms.values()) {
      if (now - r.createdAt > config.lifetime) remove(r.code, 'expired (lifetime)');
      else if (now - r.lastActive > config.idle && r.game.connections === 0) remove(r.code, 'expired (idle)');
    }
  }
  setInterval(sweep, 60 * 1000).unref();

  function load(reset) {
    if (!stateFile || reset) return;
    try {
      const data = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (data.version !== 2 || !Array.isArray(data.rooms)) return;
      for (const s of data.rooms) if (CODE.test(s.code) && s.quiz) attach({ code: s.code, hostKey: s.hostKey, quiz: s.quiz, quizId: s.quizId, ip: s.ip, createdAt: s.createdAt, lastActive: s.lastActive }, s.state);
      sweep();
    } catch (e) { /* no saved rooms yet */ }
  }

  return { create, get, remove, sweep, load, save, get size() { return rooms.size; }, config };
}

module.exports = { createRooms, CODE, CODE_ALPHABET, CODE_LENGTH };
