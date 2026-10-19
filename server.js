// Trivvoly live server. No dependencies: run `node server.js`.
// Host screen: the "Host" URL printed at startup. Players: http://<this-pc-ip>:3000 on their phones.
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');

const PORT = +process.env.PORT || 3000;
const STATE_FILE = path.join(__dirname, 'trivia-state.json');
const HOST_FILE = path.join(__dirname, 'trivia-night.html');
const PLAYER_FILE = path.join(__dirname, 'player.html');
const REMOTE_FILE = path.join(__dirname, 'remote.html');
const MAX_TEAMS = 40;

const rid = n => crypto.randomBytes(n).toString('hex');
// teams: id -> {id, name, token}; answers/marks/src/disputes: qk -> {teamId -> ...}; keys: qk -> revealed answer;
// qinfo: qk -> public question; assign: round -> {markerTeamId -> markedTeamId}; src: who gave a mark (peer/auto/host)
const freshGame = () => ({ teams: {}, answers: {}, marks: {}, src: {}, disputes: {}, assign: {}, jokers: {}, hostTeams: [], slide: null, qinfo: {}, keys: {} });
let st = { key: rid(4), ...freshGame() };
try { Object.assign(st, JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))); } catch (e) { /* fresh start */ }
if (process.argv.includes('--reset')) st = { key: st.key, ...freshGame() };

let saveT = null;
function persist() {
  clearTimeout(saveT);
  saveT = setTimeout(() => fs.writeFile(STATE_FILE, JSON.stringify(st), () => {}), 400);
}

/* ---------- Live connections (Server-Sent Events) ---------- */
const clients = new Set(); // {res, role, teamId}; role is host (the TV), remote (host's phone) or player
let remoteData = null;      // the TV's latest private status for the host's phone
function send(res, event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
const online = id => [...clients].some(c => c.teamId === id);
const hostOnline = () => [...clients].some(c => c.role === 'host');
function toRemotes(event, data) { for (const c of clients) if (c.role === 'remote') send(c.res, event, data); }

function hostView() {
  return {
    teams: Object.values(st.teams).map(t => ({ id: t.id, name: t.name, online: online(t.id) })),
    answers: st.answers, marks: st.marks, src: st.src, disputes: st.disputes, assign: st.assign,
    jokers: st.jokers, hostTeams: st.hostTeams, slideIndex: st.slide ? st.slide.i : 0
  };
}
const teamName = id => st.teams[id] ? st.teams[id].name : null;
const maxPts = qk => st.qinfo[qk] && st.qinfo[qk].input === 'music' ? 2 : 1;
const roundOf = qk => qk.startsWith('tb-') ? null : +qk.split('-')[0];
const byQ = (a, b) => +a.split('-')[1] - +b.split('-')[1];
// Pens down: shuffle the teams into a circle and each one marks the next
function makeAssignment(r) {
  const ids = Object.keys(st.teams);
  if (ids.length < 2) return;
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  st.assign[r] = {};
  ids.forEach((id, k) => { st.assign[r][id] = ids[(k + 1) % ids.length]; });
}
function setMark(qk, id, pts, src) {
  st.marks[qk] = st.marks[qk] || {}; st.src[qk] = st.src[qk] || {};
  if (pts == null) { delete st.marks[qk][id]; delete st.src[qk][id]; return; }
  st.marks[qk][id] = pts; st.src[qk][id] = src;
  const d = st.disputes[qk] && st.disputes[qk][id];
  if (src === 'host' && d && d.status === 'open') Object.assign(d, { status: pts === d.from ? 'upheld' : 'overturned', to: pts, ruledAt: Date.now() });
}
function playerView(id) {
  const t = st.teams[id], s = st.slide;
  const open = s && s.open || [];
  // The "answer sheet": every known question in the slide's round (or the tiebreakers)
  const inSheet = qk => s && (s.type === 'tb' ? qk.startsWith('tb-') && (qk === s.q?.qk || open.includes(qk)) : s.r != null && qk.startsWith(s.r + '-'));
  const sheet = Object.keys(st.qinfo).filter(inSheet)
    .sort((a, b) => +a.split('-')[1] - +b.split('-')[1])
    .map(qk => ({
      qk, info: st.qinfo[qk], my: st.answers[qk]?.[id] || null, open: open.includes(qk),
      key: st.keys[qk] || null, mark: st.keys[qk] ? st.marks[qk]?.[id] ?? null : null,
      src: st.keys[qk] ? st.src[qk]?.[id] || null : null, dispute: st.disputes[qk]?.[id] || null
    }));
  const assign = s && s.r != null && s.type !== 'tb' ? st.assign[s.r] || {} : {};
  const target = teamName(assign[id]) ? assign[id] : null;
  const marker = Object.keys(assign).find(k => assign[k] === id && teamName(k));
  // The other team's revealed answers this team has to mark
  const markSheet = !target ? [] : Object.keys(st.keys).filter(qk => roundOf(qk) === s.r && st.qinfo[qk]).sort(byQ).map(qk => ({
    qk, info: st.qinfo[qk], key: st.keys[qk], their: st.answers[qk]?.[target] || null, max: maxPts(qk),
    mark: st.marks[qk]?.[target] ?? null, src: st.src[qk]?.[target] || null, dispute: st.disputes[qk]?.[target] || null
  }));
  return {
    me: { id, name: t.name, joker: st.jokers[id] ?? -1, marking: target ? { id: target, name: teamName(target) } : null, markedBy: marker ? teamName(marker) : null },
    slide: s, sheet, markSheet
  };
}
function broadcast({ host = true, players = true } = {}) {
  for (const c of clients) {
    if (c.role === 'host' && host) send(c.res, 'state', hostView());
    if (c.role === 'player' && players && st.teams[c.teamId]) send(c.res, 'view', playerView(c.teamId));
  }
}
setInterval(() => { for (const c of clients) c.res.write(': ping\n\n'); }, 20000);

/* ---------- Helpers ---------- */
function body(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', ch => { data += ch; if (data.length > 200000) { reject(new Error('too big')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
  });
}
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }
function file(res, f) {
  fs.readFile(f, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(buf);
  });
}
const byToken = tok => Object.values(st.teams).find(t => t.token === tok && tok);
const cleanName = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 30);
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
const lanUrls = () => networks().filter(n => !n.vpn).map(n => n.url);

/* ---------- Routes ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (req.method === 'GET') {
      if (p === '/' || p === '/play') return file(res, PLAYER_FILE);
      // The host page contains every answer, so it is only served with the key
      if (p === '/host') return url.searchParams.get('key') === st.key ? file(res, HOST_FILE) : (res.writeHead(403), res.end('Wrong or missing host key.'));
      if (p === '/remote') return url.searchParams.get('key') === st.key ? file(res, REMOTE_FILE) : (res.writeHead(403), res.end('Wrong or missing host key.'));
      if (p === '/events') {
        const role = url.searchParams.get('role');
        let c;
        if ((role === 'host' || role === 'remote') && url.searchParams.get('key') === st.key) c = { role };
        else if (role === 'player') {
          const t = byToken(url.searchParams.get('token'));
          if (!t) { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); send(res, 'kicked', {}); return res.end(); }
          c = { role: 'player', teamId: t.id };
        } else { res.writeHead(403); return res.end(); }
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write('retry: 2000\n\n');
        c.res = res; clients.add(c);
        if (c.role === 'host') { send(res, 'state', hostView()); toRemotes('tv', { online: true }); }
        else if (c.role === 'remote') { send(res, 'tv', { online: hostOnline() }); if (remoteData) send(res, 'remote', remoteData); }
        else { send(res, 'view', playerView(c.teamId)); broadcast({ players: false }); }
        req.on('close', () => {
          clients.delete(c);
          if (c.role === 'player') broadcast({ players: false });
          if (c.role === 'host') toRemotes('tv', { online: hostOnline() });
        });
        return;
      }
      if (p === '/api/info') return json(res, 200, { quizName: st.slide?.quizName || 'Trivia Night' });
      res.writeHead(404); return res.end('Not found');
    }

    if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
    const b = await body(req);

    /* Player actions */
    if (p === '/api/join') {
      const existing = byToken(b.token);
      if (existing) return json(res, 200, { id: existing.id, token: existing.token, name: existing.name });
      const name = cleanName(b.name);
      if (!name) return json(res, 400, { error: 'Pick a team name.' });
      if (Object.values(st.teams).some(t => t.name.toLowerCase() === name.toLowerCase())) return json(res, 409, { error: 'That name is taken. Try another one.' });
      if (Object.keys(st.teams).length >= MAX_TEAMS) return json(res, 403, { error: 'The quiz is full.' });
      const t = { id: rid(4), name, token: rid(16) };
      st.teams[t.id] = t; persist(); broadcast({ players: false });
      return json(res, 200, { id: t.id, token: t.token, name: t.name });
    }
    if (p === '/api/answer') {
      const t = byToken(b.token); if (!t) return json(res, 401, { error: 'Unknown team. Join again.' });
      const qk = String(b.qk || '');
      if (!(st.slide?.open || []).includes(qk)) return json(res, 409, { error: 'Answers for that question are locked.' });
      const a = String(b.a ?? '').trim().slice(0, 120), bb = String(b.b ?? '').trim().slice(0, 120);
      st.answers[qk] = st.answers[qk] || {};
      if (!a && !bb) delete st.answers[qk][t.id]; else st.answers[qk][t.id] = { a, b: bb, at: Date.now() };
      persist(); broadcast({ players: false });
      for (const c of clients) if (c.teamId === t.id) send(c.res, 'view', playerView(t.id)); // keep the team's other phones in sync
      return json(res, 200, { ok: true });
    }
    if (p === '/api/joker') {
      const t = byToken(b.token); if (!t) return json(res, 401, { error: 'Unknown team. Join again.' });
      const s = st.slide, r = +b.r, cur = st.jokers[t.id];
      if (!s || s.type !== 'round' || s.r !== r) return json(res, 409, { error: 'Jokers can only be played on the round intro screen.' });
      if (cur != null && cur >= 0 && cur < r) return json(res, 409, { error: 'You already used your joker.' });
      st.jokers[t.id] = cur === r ? -1 : r;
      persist(); broadcast();
      return json(res, 200, { ok: true });
    }

    if (p === '/api/peermark') {
      const t = byToken(b.token); if (!t) return json(res, 401, { error: 'Unknown team. Join again.' });
      const qk = String(b.qk || ''), r = roundOf(qk), target = r == null ? null : st.assign[r]?.[t.id];
      if (!target || !st.teams[target]) return json(res, 403, { error: 'You’re not marking this one.' });
      if (!st.keys[qk]) return json(res, 409, { error: 'Wait for the answer to be revealed.' });
      if (st.src[qk]?.[target] === 'host') return json(res, 409, { error: 'The quizmaster already ruled on this one.' });
      if (st.disputes[qk]?.[target]) return json(res, 409, { error: 'This mark is under dispute. The quizmaster decides now.' });
      const pts = b.pts == null ? null : Math.round(+b.pts);
      if (pts != null && !(pts >= 0 && pts <= maxPts(qk))) return json(res, 400, { error: 'Bad mark.' });
      setMark(qk, target, pts, 'peer');
      persist(); broadcast();
      return json(res, 200, { ok: true });
    }
    if (p === '/api/dispute') {
      const t = byToken(b.token); if (!t) return json(res, 401, { error: 'Unknown team. Join again.' });
      const qk = String(b.qk || ''), mark = st.marks[qk]?.[t.id];
      if (mark == null || !st.keys[qk]) return json(res, 409, { error: 'Nothing to dispute yet.' });
      if (st.src[qk]?.[t.id] === 'host') return json(res, 409, { error: 'The quizmaster already ruled. Their decision is final!' });
      if (st.disputes[qk]?.[t.id]) return json(res, 409, { error: 'You already disputed this one.' });
      st.disputes[qk] = st.disputes[qk] || {};
      st.disputes[qk][t.id] = { status: 'open', reason: String(b.reason || '').replace(/\s+/g, ' ').trim().slice(0, 100), from: mark, at: Date.now() };
      persist(); broadcast();
      return json(res, 200, { ok: true });
    }

    /* Host actions */
    if (!p.startsWith('/api/host/')) { res.writeHead(404); return res.end(); }
    if (b.key !== st.key) return json(res, 403, { error: 'Bad host key.' });
    switch (p) {
      case '/api/host/info': return json(res, 200, { urls: lanUrls(), port: PORT });
      case '/api/host/remote': // TV -> host's phone
        remoteData = b.data || null; toRemotes('remote', remoteData);
        return json(res, 200, { ok: true });
      case '/api/host/cmd': { // host's phone -> TV
        const hosts = [...clients].filter(c => c.role === 'host');
        if (!hosts.length) return json(res, 409, { error: 'The main screen isn’t connected. Open the host link on the TV computer.' });
        for (const c of hosts) send(c.res, 'cmd', { cmd: String(b.cmd || ''), a: b.a || {} });
        return json(res, 200, { ok: true });
      }
      case '/api/host/slide': {
        const s = b.slide || null;
        st.slide = s;
        if (s) {
          for (const q of s.infos || []) if (q && q.qk) st.qinfo[q.qk] = q;
          if (s.q && s.q.qk) st.qinfo[s.q.qk] = s.q;
          if (s.key && s.key.qk) st.keys[s.key.qk] = s.key;
          if ((s.type === 'swap' || s.type === 'answer') && s.r != null && !st.assign[s.r]) { makeAssignment(s.r); broadcast({ players: false }); }
        }
        persist(); broadcast({ host: false });
        return json(res, 200, { ok: true });
      }
      case '/api/host/mark': {
        setMark(String(b.qk), String(b.teamId), b.pts == null ? null : +b.pts || 0, 'host');
        persist(); broadcast();
        return json(res, 200, { ok: true });
      }
      case '/api/host/marks': { // bulk: [{qk, teamId, pts}]
        for (const m of b.marks || []) if (st.marks[m.qk]?.[m.teamId] == null) setMark(String(m.qk), String(m.teamId), +m.pts || 0, 'auto');
        persist(); broadcast();
        return json(res, 200, { ok: true });
      }
      case '/api/host/teams': {
        st.hostTeams = Array.isArray(b.teams) ? b.teams : [];
        for (const ht of st.hostTeams) if (st.teams[ht.id] && cleanName(ht.name)) st.teams[ht.id].name = cleanName(ht.name);
        persist(); broadcast({ host: false });
        return json(res, 200, { ok: true });
      }
      case '/api/host/joker': {
        if (st.teams[b.teamId]) { st.jokers[b.teamId] = +b.r; persist(); broadcast(); }
        return json(res, 200, { ok: true });
      }
      case '/api/host/kick': {
        const ids = b.all ? Object.keys(st.teams) : [String(b.teamId)];
        if (b.all) Object.assign(st, { ...freshGame(), teams: st.teams, hostTeams: st.hostTeams, slide: st.slide }); // a brand-new game
        for (const id of ids) {
          delete st.teams[id]; delete st.jokers[id];
          for (const m of [st.answers, st.marks, st.src, st.disputes]) for (const qk in m) delete m[qk][id];
          for (const r in st.assign) { delete st.assign[r][id]; for (const k in st.assign[r]) if (st.assign[r][k] === id) delete st.assign[r][k]; }
        }
        for (const c of clients) if (c.role === 'player' && !st.teams[c.teamId]) { send(c.res, 'kicked', {}); c.res.end(); clients.delete(c); }
        persist(); broadcast();
        return json(res, 200, { ok: true });
      }
    }
    res.writeHead(404); res.end();
  } catch (e) {
    json(res, 400, { error: 'Bad request' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const nets = networks();
  console.log('\n  Trivvoly is live!\n');
  console.log(`  Host (open on THIS computer):  http://localhost:${PORT}/host?key=${st.key}`);
  console.log('  Players (phones on the same Wi-Fi):');
  for (const n of nets.filter(n => !n.vpn)) console.log(`     ${n.url}   (${n.name})`);
  if (!nets.some(n => !n.vpn)) console.log('     (no network found: connect this PC to Wi-Fi)');
  for (const n of nets.filter(n => n.vpn)) console.log(`  Remote players on your ${n.name} network:  ${n.url}`);
  const lan = nets.find(n => !n.vpn);
  console.log(`\n  Your phone as the remote control:  ${lan ? lan.url : `http://localhost:${PORT}`}/remote?key=${st.key}`);
  console.log('  (or open Menu on the main screen and show the remote QR code)');
  console.log('\n  Keep the host and remote links to yourself: they show every answer.');
  console.log('  Start fresh next time with:  node server.js --reset\n');
});
