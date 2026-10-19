// One game: teams, answers, peer marking, disputes and the live connections of one room.
// Everything coming in from a browser is treated as untrusted and checked here, including
// what the room's own quizmaster page sends: rooms are created by anonymous people.
'use strict';
const crypto = require('crypto');
const moderation = require('./moderation.js');

const MAX_TEAMS = 40;
const MAX_CLIENTS = 120;
const QK = /^(?:\d{1,2}-\d{1,2}|tb-\d{1,2})$/;   // question keys: "round-question" or "tb-n"
const TEAM_ID = /^[a-f0-9]{8}$/;
const SLIDE_TYPES = ['title', 'rules', 'round', 'question', 'swap', 'answer', 'standings', 'halftime', 'tbIntro', 'tb', 'winner', 'end'];

const rid = n => crypto.randomBytes(n).toString('hex');
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const str = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const int = (v, lo, hi) => { const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };
const isQk = v => typeof v === 'string' && QK.test(v);
const isTeamId = v => typeof v === 'string' && TEAM_ID.test(v);

const freshState = () => ({ teams: {}, answers: {}, marks: {}, src: {}, disputes: {}, assign: {}, jokers: {}, hostTeams: [], slide: null, qinfo: {}, keys: {} });

/** Reply helper: [status, body] */
const ok = (body = { ok: true }) => [200, body];
const fail = (status, error) => [status, { error }];

/** Keep only the parts of the host's public slide that phones use, with every key checked. */
function cleanSlide(s) {
  if (!s || typeof s !== 'object' || !SLIDE_TYPES.includes(s.type)) return null;
  const out = {
    i: int(s.i, 0, 10000) ?? 0, type: s.type, r: int(s.r, 0, 50), rc: int(s.rc, 0, 50) ?? 0,
    hud: Array.isArray(s.hud) ? s.hud.slice(0, 2).map(h => str(h, 120)) : ['', ''],
    quizName: str(s.quizName, 40), revealed: !!s.revealed,
    open: Array.isArray(s.open) ? s.open.filter(isQk).slice(0, 40) : [],
    infos: Array.isArray(s.infos) ? s.infos.map(cleanInfo).filter(Boolean).slice(0, 40) : []
  };
  if (s.q) out.q = cleanInfo(s.q);
  if (s.round && typeof s.round === 'object') out.round = { title: str(s.round.title, 60), icon: str(s.round.icon, 16), blurb: str(s.round.blurb, 300), scoring: str(s.round.scoring, 160) };
  if (s.key && isQk(s.key.qk)) out.key = { qk: s.key.qk, a: str(s.key.a, 200), sub: str(s.key.sub, 120), note: str(s.key.note, 240) };
  if (Array.isArray(s.standings)) out.standings = s.standings.slice(0, MAX_TEAMS).map(x => ({ id: isTeamId(x && x.id) ? x.id : '', name: str(x && x.name, 40), rank: int(x && x.rank, 0, 1000) ?? 0, total: str(x && x.total, 12) }));
  if (s.timer && typeof s.timer === 'object') {
    const n = (v, d) => (typeof v === 'number' && isFinite(v) && v >= 0 && v < 100000 ? v : d);
    out.timer = { mode: str(s.timer.mode, 8), running: !!s.timer.running, done: !!s.timer.done, total: n(s.timer.total, 0), left: n(s.timer.left, 0) };
  }
  return out;
}
/** A question as phones see it (no answers). Flags are only ever an id into the built-in library. */
function cleanInfo(q) {
  if (!q || typeof q !== 'object' || !isQk(q.qk)) return null;
  const out = { qk: q.qk, n: int(q.n, 0, 100) ?? 0, label: str(q.label, 40), input: ['text', 'music', 'ab', 'number'].includes(q.input) ? q.input : 'text' };
  for (const [k, max] of [['icon', 16], ['text', 300], ['emoji', 60], ['cat', 40], ['clue', 60], ['hint', 160], ['bLabel', 20]]) if (q[k] != null) out[k] = str(q[k], max);
  if (typeof q.flag === 'string' && /^[a-z-]{1,30}$/.test(q.flag)) out.flag = q.flag;
  if (typeof q.r === 'number') out.r = int(q.r, 0, 50);
  for (const side of ['A', 'B']) if (q[side] && typeof q[side] === 'object') out[side] = { icon: str(q[side].icon, 16), text: str(q[side].text, 160) };
  return out;
}

function createGame({ saved, onChange }) {
  const st = Object.assign(freshState(), saved || {});
  const clients = new Set(); // { res, role: 'host' | 'remote' | 'player', teamId }
  let remoteData = null;     // the TV's private status for the quizmaster's phone
  const changed = () => onChange && onChange();

  /* ---------- Views and broadcasting ---------- */
  const send = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const online = id => [...clients].some(c => c.teamId === id);
  const hostOnline = () => [...clients].some(c => c.role === 'host');
  const toRemotes = (event, data) => { for (const c of clients) if (c.role === 'remote') send(c.res, event, data); };
  const teamName = id => has(st.teams, id) ? st.teams[id].name : null;
  const maxPts = qk => st.qinfo[qk] && st.qinfo[qk].input === 'music' ? 2 : 1;
  const roundOf = qk => qk.startsWith('tb-') ? null : +qk.split('-')[0];
  const byQ = (a, b) => +a.split('-')[1] - +b.split('-')[1];

  function hostView() {
    return {
      teams: Object.values(st.teams).map(t => ({ id: t.id, name: t.name, online: online(t.id) })),
      answers: st.answers, marks: st.marks, src: st.src, disputes: st.disputes, assign: st.assign,
      jokers: st.jokers, hostTeams: st.hostTeams, slideIndex: st.slide ? st.slide.i : 0
    };
  }
  function playerView(id) {
    const t = st.teams[id], s = st.slide;
    const open = s && s.open || [];
    // The "answer sheet": every known question in the slide's round (or the tiebreakers)
    const inSheet = qk => s && (s.type === 'tb' ? qk.startsWith('tb-') && (qk === s.q?.qk || open.includes(qk)) : s.r != null && qk.startsWith(s.r + '-'));
    const sheet = Object.keys(st.qinfo).filter(inSheet).sort(byQ).map(qk => ({
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
      if (c.role === 'player' && players && has(st.teams, c.teamId)) send(c.res, 'view', playerView(c.teamId));
    }
  }
  const ping = setInterval(() => { for (const c of clients) c.res.write(': ping\n\n'); }, 20000);
  ping.unref();

  /* ---------- Rules ---------- */
  // Pens down: shuffle the teams into a circle and each one marks the next
  function makeAssignment(r) {
    const ids = Object.keys(st.teams);
    if (ids.length < 2) return;
    for (let i = ids.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [ids[i], ids[j]] = [ids[j], ids[i]]; }
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
  function removeTeams(ids) {
    for (const id of ids) {
      delete st.teams[id]; delete st.jokers[id];
      for (const m of [st.answers, st.marks, st.src, st.disputes]) for (const qk in m) delete m[qk][id];
      for (const r in st.assign) { delete st.assign[r][id]; for (const k in st.assign[r]) if (st.assign[r][k] === id) delete st.assign[r][k]; }
    }
    for (const c of clients) if (c.role === 'player' && !has(st.teams, c.teamId)) { send(c.res, 'kicked', {}); c.res.end(); clients.delete(c); }
  }

  /* ---------- Live connections ---------- */
  function connect(req, res, who) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' });
    if (who.role === 'player' && !who.team) { send(res, 'needjoin', {}); return res.end(); }
    if (clients.size >= MAX_CLIENTS) { send(res, 'full', {}); return res.end(); }
    res.write('retry: 2000\n\n');
    const c = { res, role: who.role, teamId: who.team ? who.team.id : null };
    clients.add(c);
    if (c.role === 'host') { send(res, 'state', hostView()); toRemotes('tv', { online: true }); }
    else if (c.role === 'remote') { send(res, 'tv', { online: hostOnline() }); if (remoteData) send(res, 'remote', remoteData); }
    else { send(res, 'view', playerView(c.teamId)); broadcast({ players: false }); }
    req.on('close', () => {
      clients.delete(c);
      if (c.role === 'player') broadcast({ players: false });
      if (c.role === 'host') toRemotes('tv', { online: hostOnline() });
    });
  }

  /* ---------- Players ---------- */
  const teamByToken = tok => (typeof tok === 'string' && tok.length === 32 && Object.values(st.teams).find(t => t.token === tok)) || null;

  function join(nameIn) {
    const name = str(nameIn, 30);
    if (!name) return { error: [400, 'Pick a team name.'] };
    if (moderation.isOffensive(name)) return { error: [400, 'Let’s keep it friendly. Try another team name.'] };
    if (Object.values(st.teams).some(t => t.name.toLowerCase() === name.toLowerCase())) return { error: [409, 'That name is taken. Try another one.'] };
    if (Object.keys(st.teams).length >= MAX_TEAMS) return { error: [403, 'This game is full.'] };
    const t = { id: rid(4), name, token: rid(16) };
    st.teams[t.id] = t; changed(); broadcast({ players: false });
    return { team: t };
  }

  function player(action, t, b) {
    switch (action) {
      case 'answer': {
        const qk = b.qk;
        if (!isQk(qk) || !(st.slide?.open || []).includes(qk)) return fail(409, 'Answers for that question are locked.');
        const a = str(b.a, 120), bb = str(b.b, 120);
        st.answers[qk] = st.answers[qk] || {};
        if (!a && !bb) delete st.answers[qk][t.id]; else st.answers[qk][t.id] = { a, b: bb, at: Date.now() };
        changed(); broadcast({ players: false });
        for (const c of clients) if (c.teamId === t.id) send(c.res, 'view', playerView(t.id)); // the team's other phones
        return ok();
      }
      case 'joker': {
        const s = st.slide, r = int(b.r, 0, 50), cur = st.jokers[t.id];
        if (r == null || !s || s.type !== 'round' || s.r !== r) return fail(409, 'Jokers can only be played on the round intro screen.');
        if (cur != null && cur >= 0 && cur < r) return fail(409, 'You already used your joker.');
        st.jokers[t.id] = cur === r ? -1 : r;
        changed(); broadcast();
        return ok();
      }
      case 'peermark': {
        const qk = b.qk;
        if (!isQk(qk)) return fail(400, 'Bad question.');
        const r = roundOf(qk), target = r == null ? null : st.assign[r]?.[t.id];
        if (!target || !has(st.teams, target)) return fail(403, 'You’re not marking this one.');
        if (!st.keys[qk]) return fail(409, 'Wait for the answer to be revealed.');
        if (st.src[qk]?.[target] === 'host') return fail(409, 'The quizmaster already ruled on this one.');
        if (st.disputes[qk]?.[target]) return fail(409, 'This mark is under dispute. The quizmaster decides now.');
        const pts = b.pts == null ? null : int(b.pts, 0, maxPts(qk));
        if (b.pts != null && pts == null) return fail(400, 'Bad mark.');
        setMark(qk, target, pts, 'peer');
        changed(); broadcast();
        return ok();
      }
      case 'dispute': {
        const qk = b.qk;
        if (!isQk(qk)) return fail(400, 'Bad question.');
        const mark = st.marks[qk]?.[t.id];
        if (mark == null || !st.keys[qk]) return fail(409, 'Nothing to dispute yet.');
        if (st.src[qk]?.[t.id] === 'host') return fail(409, 'The quizmaster already ruled. Their decision is final!');
        if (st.disputes[qk]?.[t.id]) return fail(409, 'You already disputed this one.');
        st.disputes[qk] = st.disputes[qk] || {};
        st.disputes[qk][t.id] = { status: 'open', reason: moderation.clean(str(b.reason, 100)), from: mark, at: Date.now() };
        changed(); broadcast();
        return ok();
      }
    }
    return fail(404, 'Unknown action.');
  }

  /* ---------- Quizmaster ---------- */
  function host(action, b) {
    switch (action) {
      case 'remote': // TV -> quizmaster's phone (private to this room's quizmaster)
        remoteData = b.data && typeof b.data === 'object' ? b.data : null;
        toRemotes('remote', remoteData);
        return ok();
      case 'cmd': { // quizmaster's phone -> TV
        const hosts = [...clients].filter(c => c.role === 'host');
        if (!hosts.length) return fail(409, 'The main screen isn’t connected. Open the quizmaster link on the TV computer.');
        const a = b.a && typeof b.a === 'object' && !Array.isArray(b.a) ? b.a : {};
        for (const c of hosts) send(c.res, 'cmd', { cmd: str(b.cmd, 20), a });
        return ok();
      }
      case 'slide': {
        const s = cleanSlide(b.slide);
        st.slide = s;
        if (s) {
          for (const q of s.infos) st.qinfo[q.qk] = q;
          if (s.q) st.qinfo[s.q.qk] = s.q;
          if (s.key) st.keys[s.key.qk] = s.key;
          if ((s.type === 'swap' || s.type === 'answer') && s.r != null && !st.assign[s.r]) { makeAssignment(s.r); broadcast({ players: false }); }
        }
        changed(); broadcast({ host: false });
        return ok();
      }
      case 'mark': {
        if (!isQk(b.qk) || !isTeamId(b.teamId) || !has(st.teams, b.teamId)) return fail(400, 'Bad mark.');
        const pts = b.pts == null ? null : int(b.pts, 0, 2);
        if (b.pts != null && pts == null) return fail(400, 'Bad mark.');
        setMark(b.qk, b.teamId, pts, 'host');
        changed(); broadcast();
        return ok();
      }
      case 'marks': { // bulk auto-marks: [{qk, teamId, pts}]
        for (const m of (Array.isArray(b.marks) ? b.marks : []).slice(0, MAX_TEAMS * 2)) {
          if (!m || !isQk(m.qk) || !isTeamId(m.teamId) || !has(st.teams, m.teamId)) continue;
          const pts = int(m.pts, 0, 2);
          if (pts != null && st.marks[m.qk]?.[m.teamId] == null) setMark(m.qk, m.teamId, pts, 'auto');
        }
        changed(); broadcast();
        return ok();
      }
      case 'teams': { // the TV's scoreboard, kept so a reopened TV page can restore it
        st.hostTeams = (Array.isArray(b.teams) ? b.teams : []).slice(0, MAX_TEAMS + 20).filter(t => t && isTeamId(t.id)).map(t => ({
          id: t.id, name: str(t.name, 40),
          s: (Array.isArray(t.s) ? t.s : []).slice(0, 12).map(v => str(v, 8)),
          j: int(t.j, -1, 50) ?? -1, adj: str(t.adj, 8)
        }));
        for (const ht of st.hostTeams) if (has(st.teams, ht.id) && ht.name && !moderation.isOffensive(ht.name)) st.teams[ht.id].name = str(ht.name, 30);
        changed(); broadcast({ host: false });
        return ok();
      }
      case 'joker': {
        const r = int(b.r, -1, 50);
        if (isTeamId(b.teamId) && has(st.teams, b.teamId) && r != null) { st.jokers[b.teamId] = r; changed(); broadcast(); }
        return ok();
      }
      case 'kick': {
        if (b.all) {
          const keep = { hostTeams: st.hostTeams, slide: st.slide, teams: st.teams };
          Object.assign(st, freshState(), keep); // a brand-new game
          removeTeams(Object.keys(st.teams));
        } else if (isTeamId(b.teamId) && has(st.teams, b.teamId)) removeTeams([b.teamId]);
        changed(); broadcast();
        return ok();
      }
    }
    return fail(404, 'Unknown action.');
  }

  /** End the game: tell every phone and drop all connections. */
  function close() {
    clearInterval(ping);
    for (const c of clients) { try { send(c.res, 'closed', {}); c.res.end(); } catch (e) { /* already gone */ } }
    clients.clear();
  }

  return {
    get state() { return st; },
    get connections() { return clients.size; },
    teamByToken, join, connect, player, host, close
  };
}

module.exports = { createGame, MAX_TEAMS, isQk, isTeamId, cleanSlide, cleanInfo };
