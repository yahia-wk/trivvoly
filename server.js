// Trivvoly server: many games at once, each in its own room. Run `npm start` (or node server.js).
// Open http://localhost:3000 to host a quiz; players join with the room code or QR code.
'use strict';
const http = require('http'), path = require('path'), os = require('os');
const H = require('./lib/http.js');
const { loadLibrary, check, summary, MAX_QUIZ_BYTES } = require('./lib/quizzes.js');
const { createRooms, CODE } = require('./lib/rooms.js');

const PORT = +process.env.PORT || 3000;
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, ''); // e.g. https://trivvoly.com when hosted
const STATE_FILE = process.env.TRIVVOLY_STATE || path.join(__dirname, 'trivia-state.json');
const ROOT = __dirname, PUB = path.join(ROOT, 'public');
const FILES = {
  index: path.join(PUB, 'index.html'), play: path.join(PUB, 'play.html'), show: path.join(PUB, 'show.html'),
  remote: path.join(PUB, 'remote.html'), claim: path.join(PUB, 'claim.html')
};
const SCRIPTS = {
  '/shared/flags.js': path.join(ROOT, 'shared', 'flags.js'),
  '/shared/quiz-format.js': path.join(ROOT, 'shared', 'quiz-format.js'),
  '/vendor/qrcode.js': path.join(ROOT, 'node_modules', 'qrcode-generator', 'qrcode.js')
};
const MIN = 60 * 1000, HOUR = 60 * MIN;
const COOKIE_AGE = 12 * 60 * 60; // seconds; rooms never live longer than this

function argValue(name) {
  const i = process.argv.findIndex(a => a === name || a.startsWith(name + '='));
  if (i < 0) return null;
  const a = process.argv[i];
  return a.includes('=') ? a.slice(a.indexOf('=') + 1) : process.argv[i + 1] || null;
}

/* ---------- Quizzes and rooms ---------- */
const extraQuiz = argValue('--quiz');
const library = loadLibrary(path.join(ROOT, 'quizzes'), extraQuiz ? [path.resolve(extraQuiz)] : []);
const rooms = createRooms({ stateFile: STATE_FILE, log: m => console.log(`  [${new Date().toISOString().slice(11, 19)}] ${m}`) });
rooms.load(process.argv.includes('--reset'));

/* ---------- Limits ---------- */
// Many players can share one address (a pub's Wi-Fi), so per-address limits are generous
// and the tight ones are per team.
const limiter = new H.RateLimiter();
const LIMITS = {
  create: [10, HOUR],      // new rooms per address
  join: [60, 10 * MIN],    // new teams per address
  claim: [20, 10 * MIN],   // quizmaster-key attempts per address
  miss: [30, MIN],         // looking up room codes that don't exist (stops code guessing)
  team: [120, MIN],        // actions per team
  addr: [3000, MIN],       // all player actions per address
  host: [1500, MIN],       // quizmaster actions per room
  events: [300, MIN]       // live connections per address
};
function allowed(res, kind, who) {
  const [n, windowMs] = LIMITS[kind];
  if (limiter.allow(`${kind}:${who}`, n, windowMs)) return true;
  H.json(res, 429, { error: 'Slow down a little and try again in a minute.' }, { 'Retry-After': '60' });
  return false;
}
const BODY = { default: 16 * 1024, create: MAX_QUIZ_BYTES + 64 * 1024, slide: 96 * 1024, remote: 256 * 1024, teams: 64 * 1024 };

/* ---------- Addresses ---------- */
// Real Wi-Fi/Ethernet first; VPN-style networks (Tailscale, ZeroTier) last; virtual machine adapters skipped
const VIRTUAL = /vmware|virtualbox|vethernet|hyper-v|wsl|docker|loopback|bluetooth|vbox/i, VPN = /tailscale|zerotier|hamachi|wireguard/i;
function networks() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) for (const a of list || []) {
    if (a.family !== 'IPv4' && a.family !== 4) continue;
    if (a.internal || a.address.startsWith('169.254.') || VIRTUAL.test(name)) continue;
    out.push({ name, url: `http://${a.address}:${PORT}`, vpn: VPN.test(name) || a.address.startsWith('100.') });
  }
  return out.sort((x, y) => x.vpn - y.vpn);
}
/** Where players should go: the public site, or this PC's Wi-Fi address when the TV page is on localhost. */
function siteUrl(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const host = String(req.headers.host || `localhost:${PORT}`);
  if (/^(localhost|127\.|\[::1\])/.test(host)) { const lan = networks().find(n => !n.vpn); if (lan) return lan.url; }
  return `${H.isHttps(req) ? 'https' : 'http'}://${host}`;
}

/* ---------- Who is asking ---------- */
const isHost = (req, room) => H.sameSecret(H.cookies(req).tvh, room.hostKey);
const teamOf = (req, room) => room.game.teamByToken(H.cookies(req).tvp);
const roomCookie = (req, room, name, value) => H.setCookie(req, name, value, { path: `/r/${room.code}`, maxAge: COOKIE_AGE });
const hostLink = room => `/r/${room.code}/host#k=${room.hostKey}`;

/* ---------- Routes ---------- */
const ROOM_ROUTE = /^\/r\/([A-Z0-9]{6})(?:\/([a-z]+)(?:\/([a-z]+))?)?\/?$/;

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname, ip = H.clientIp(req);

  if (req.method === 'GET' || req.method === 'HEAD') {
    if (p === '/') return H.page(res, FILES.index);
    if (p === '/healthz') return H.text(res, 200, 'ok');
    if (p === '/favicon.ico') { res.writeHead(204, H.BASE_HEADERS); return res.end(); }
    if (SCRIPTS[p]) return H.script(res, SCRIPTS[p]);
    if (p === '/api/quizzes') return H.json(res, 200, { quizzes: [...library.quizzes.values()].map(q => q.summary) });

    // Short join links: /K7QM2X
    const short = /^\/([A-Za-z0-9]{6})$/.exec(p);
    if (short) {
      const code = short[1].toUpperCase();
      if (rooms.get(code)) { res.writeHead(302, { Location: `/r/${code}`, ...H.BASE_HEADERS }); return res.end(); }
      if (!allowed(res, 'miss', ip)) return;
      return H.text(res, 404, 'Not found');
    }

    const m = ROOM_ROUTE.exec(p);
    if (m) {
      const room = rooms.get(m[1]), sub = m[2] || '';
      if (!room) {
        if (!allowed(res, 'miss', ip)) return;
        if (sub === 'events') { res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' }); res.write('event: closed\ndata: {}\n\n'); return res.end(); }
        res.writeHead(302, { Location: `/?missing=${m[1]}`, ...H.BASE_HEADERS }); return res.end();
      }
      if (sub === '') return H.page(res, FILES.play);
      if (sub === 'host' || sub === 'remote') {
        if (!isHost(req, room)) return H.page(res, FILES.claim); // reads the key from the link's #fragment
        if (sub === 'remote') return H.page(res, FILES.remote);
        const roomInfo = { code: room.code, base: `/r/${room.code}`, joinUrl: `${siteUrl(req)}/${room.code}`, remoteUrl: `${siteUrl(req)}/r/${room.code}/remote#k=${room.hostKey}` };
        return H.page(res, FILES.show, html => html
          .replace('/*QUIZ_JSON*/null', () => H.scriptJson(room.quiz))
          .replace('/*ROOM_JSON*/null', () => H.scriptJson(roomInfo)));
      }
      if (sub === 'events') {
        if (!allowed(res, 'events', ip)) return;
        const role = url.searchParams.get('role');
        if (role === 'host' || role === 'remote') {
          if (!isHost(req, room)) return H.json(res, 403, { error: 'This is the quizmaster’s link.' });
          return room.game.connect(req, res, { role });
        }
        return room.game.connect(req, res, { role: 'player', team: teamOf(req, room) });
      }
      if (sub === 'info') return H.json(res, 200, { code: room.code, quizName: room.game.state.slide?.quizName || room.quiz.title });
    }
    return H.text(res, 404, 'Not found');
  }

  if (req.method !== 'POST') return H.text(res, 405, 'Method not allowed');
  if (!H.sameOrigin(req)) return H.json(res, 403, { error: 'Requests must come from Trivvoly itself.' });

  /* Create a room from a built-in quiz or an uploaded one */
  if (p === '/api/rooms') {
    if (!allowed(res, 'create', ip)) return;
    const b = await H.readJson(req, BODY.create);
    let quiz, quizId = null;
    if (typeof b.quizId === 'string') {
      const q = library.quizzes.get(b.quizId);
      if (!q) return H.json(res, 404, { error: 'That quiz doesn’t exist.' });
      quiz = q.quiz; quizId = q.id;
    } else if (b.quiz) {
      const r = check(b.quiz);
      if (r.errors) return H.json(res, 422, { error: 'That quiz file has problems.', problems: r.errors });
      quiz = r.quiz;
    } else return H.json(res, 400, { error: 'Pick a quiz.' });
    const made = rooms.create({ quiz, quizId, ip });
    if (made.error) return H.json(res, made.error[0], { error: made.error[1] });
    const room = made.room;
    return H.json(res, 200, { code: room.code, hostUrl: hostLink(room), quiz: summary(quizId, quiz) }, { 'Set-Cookie': roomCookie(req, room, 'tvh', room.hostKey) });
  }

  const m = ROOM_ROUTE.exec(p);
  if (!m) return H.json(res, 404, { error: 'Not found.' });
  const room = rooms.get(m[1]), action = m[2], sub = m[3];
  if (!room) { if (!allowed(res, 'miss', ip)) return; return H.json(res, 404, { error: 'That game has ended or doesn’t exist.' }); }

  // The quizmaster's key, from the link's #fragment, becomes a cookie for this room only
  if (action === 'claim' && !sub) {
    if (!allowed(res, 'claim', ip)) return;
    const b = await H.readJson(req, BODY.default);
    if (!H.sameSecret(b.key, room.hostKey)) return H.json(res, 403, { error: 'That quizmaster link isn’t right. Ask whoever started the game for the link again.' });
    return H.json(res, 200, { ok: true }, { 'Set-Cookie': roomCookie(req, room, 'tvh', room.hostKey) });
  }

  if (action === 'join' && !sub) {
    const existing = teamOf(req, room);
    if (existing) return H.json(res, 200, { id: existing.id, name: existing.name });
    if (!allowed(res, 'join', ip)) return;
    const b = await H.readJson(req, BODY.default);
    const r = room.game.join(b.name);
    if (r.error) return H.json(res, r.error[0], { error: r.error[1] });
    return H.json(res, 200, { id: r.team.id, name: r.team.name }, { 'Set-Cookie': roomCookie(req, room, 'tvp', r.team.token) });
  }

  if (['answer', 'joker', 'peermark', 'dispute'].includes(action) && !sub) {
    const team = teamOf(req, room);
    if (!team) return H.json(res, 401, { error: 'Join the game first.', needJoin: true });
    if (!allowed(res, 'team', `${room.code}:${team.id}`) || !allowed(res, 'addr', ip)) return;
    const b = await H.readJson(req, BODY.default);
    const [status, body] = room.game.player(action, team, b);
    return H.json(res, status, body);
  }

  if (action === 'host' && sub) {
    if (!isHost(req, room)) return H.json(res, 403, { error: 'This is the quizmaster’s link.' });
    if (!allowed(res, 'host', room.code)) return;
    const b = await H.readJson(req, BODY[sub] || BODY.default);
    if (sub === 'info') return H.json(res, 200, { code: room.code, joinUrl: `${siteUrl(req)}/${room.code}` });
    if (sub === 'end') { rooms.remove(room.code, 'ended by the quizmaster'); return H.json(res, 200, { ok: true }); }
    const [status, body] = room.game.host(sub, b);
    return H.json(res, status, body);
  }

  return H.json(res, 404, { error: 'Not found.' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(e => {
    if (res.headersSent) { res.end(); return; }
    if (e instanceof H.HttpError) return H.json(res, e.status, { error: e.message });
    console.error(e);
    H.json(res, 500, { error: 'Something went wrong on our side.' });
  });
});
server.headersTimeout = 20 * 1000;

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  Trivvoly is live!\n');
  console.log(`  Quizzes: ${[...library.quizzes.values()].map(q => `${q.summary.title} (${q.id})`).join(', ') || 'none (quizmasters can still upload one)'}`);
  if (library.warnings.length) { console.log('  Skipped or problem quizzes:'); for (const w of library.warnings) console.log('   - ' + w); }
  if (rooms.size) console.log(`  Restored ${rooms.size} running game${rooms.size === 1 ? '' : 's'}.`);
  console.log(`\n  Host a quiz:  ${PUBLIC_URL || `http://localhost:${PORT}`}`);
  if (!PUBLIC_URL) {
    const lan = networks().filter(n => !n.vpn);
    if (lan.length) console.log(`  Players on the same Wi-Fi join at:  ${lan[0].url}  (the TV shows the exact link and a QR code)`);
    for (const n of networks().filter(n => n.vpn)) console.log(`  Players on your ${n.name} network:  ${n.url}`);
  }
  console.log('');
});

module.exports = server;
