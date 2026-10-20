// The quizmaster's phone: run the slides, timer, marking, disputes, scores and settings,
// with the answers visible before they're revealed. Never shown to the room.
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { Flag } from '../../components/Flag';
import { fmtPts, fmtTime, timeLeft } from '../../lib/clock';
import { ptsText, quizName, teamName, useHostRoom, type HostRoom } from '../../lib/host';
import { answerLine, hudLabels, jumpTargets } from '../../lib/slides';
import type { HostView, ServerMessage } from '../../lib/types';
import { useTick } from '../../lib/useTick';
import './remote.css';

type Tab = 'live' | 'scores' | 'menu';

export default function Remote() {
  const { code = '' } = useParams();
  const [msg, setMsg] = useState('');
  const msgTimer = useRef(0);
  const say = (m: string) => { setMsg(m); window.clearTimeout(msgTimer.current); msgTimer.current = window.setTimeout(() => setMsg(''), 3000); };
  const room = useHostRoom(code, 'remote', (m: ServerMessage) => { if (m.type === 'toast') say(m.text); });
  const [tab, setTab] = useState<Tab>(() => { try { return (sessionStorage.getItem('remote-tab') as Tab) || 'live'; } catch { return 'live'; } });
  useEffect(() => { try { sessionStorage.setItem('remote-tab', tab); } catch { /* private mode */ } }, [tab]);

  const run = (cmd: string, args: Record<string, unknown> = {}) => room.send(cmd, args).catch((e: Error) => say(e.message));
  const view = room.view;
  const tvOnline = !!view?.tv.online;

  let warning = '';
  if (room.access.error) warning = room.access.error;
  else if (room.status === 'denied') warning = 'This is the quizmaster’s screen. Open the remote link from the main screen’s Menu.';
  else if (room.status === 'closed') warning = 'This game has ended.';
  else if (view && !tvOnline) warning = 'The main screen isn’t connected. Open the quizmaster link on the TV computer.';
  else if (view && !view.tv.soundReady && !view.tv.muted) warning = 'Sound is off on the main screen: click “Start the show” on it once.';

  return (
    <div className="page-remote">
      <div className="wrap">
        <header>
          <div className="top">
            <span className="brand">Quizmaster remote</span>
            <span className="conn"><span className={`dot${tvOnline ? ' on' : ''}`} /><span>{room.status === 'reconnecting' ? 'Reconnecting…' : tvOnline ? 'Main screen connected' : 'Main screen offline'}</span></span>
          </div>
          <div className="tabs" role="tablist">
            {(['live', 'scores', 'menu'] as Tab[]).map(t => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => { setTab(t); window.scrollTo(0, 0); }}>
                {t === 'live' ? 'Live' : t === 'scores' ? 'Scores' : 'Menu'}
                {t === 'live' && !!view?.disputes.length && <span className="badge">{view.disputes.length}</span>}
              </button>
            ))}
          </div>
          {warning && <div className="warnbar">{warning}</div>}
        </header>
        <main>
          {!view || !room.quiz ? <div className="card plain"><p className="muted">{room.status === 'denied' || room.status === 'closed' ? '' : 'Connecting…'}</p></div>
            : tab === 'scores' ? <ScoresTab view={view} run={run} />
            : tab === 'menu' ? <MenuTab room={room} run={run} onJump={() => setTab('live')} />
            : <LiveTab room={room} run={run} />}
        </main>
      </div>
      <nav className="nav" aria-label="Slides">
        <button type="button" disabled={!room.canPrev} onClick={() => run('prev')}>Back</button>
        <button type="button" className="go" disabled={!room.canNext} onClick={() => run('next')}>{room.nextLabel}</button>
      </nav>
      {msg && <div className="msg" role="status">{msg}</div>}
    </div>
  );
}

type Run = (cmd: string, args?: Record<string, unknown>) => Promise<void>;

/* ---------- Live ---------- */

function LiveTab({ room, run }: { room: HostRoom; run: Run }) {
  const view = room.view!, quiz = room.quiz!, slide = room.slide!, q = room.question, tb = room.tiebreaker;
  const [left, right] = hudLabels(quiz, slide, quizName(view, quiz));
  const titles: Record<string, string> = { title: 'Title screen', rules: 'House rules', swap: 'Pens down', standings: 'Scoreboard', halftime: 'Half-time', tbIntro: 'Tiebreaker', winner: 'And the winners are…', end: 'The end' };
  const winnerIndex = room.slides.findIndex(s => s.type === 'winner');

  let body;
  if (q) {
    const key = answerLine(q);
    body = (
      <>
        {q.kind === 'flag' && q.flag && <Flag id={q.flag} width={200} label="Flag" />}
        {q.kind === 'vowels' && <><p className="muted">Category: {q.cat}</p><div className="clue">{q.clue}</div></>}
        {'emoji' in q && q.emoji && <div className="big-emoji">{q.emoji}</div>}
        {q.kind === 'versus' ? <p className="qtext">A: {q.A.text}<br />B: {q.B.text}</p>
          : q.kind === 'music' && q.tune != null ? <p className="qtext">Track {slide.q! + 1}: the tune plays on the big screen.</p>
          : 'q' in q && q.q ? <p className="qtext">{q.q}</p> : null}
        <div className="key">
          <div className="lbl">Answer{view.revealed ? '' : ' (only you can see this)'}</div>
          <div className="ans">{key.a}</div>
          {key.sub && <div className="sub">{key.sub}</div>}
          {q.mark && <div className="sub">Marking: {q.mark}</div>}
        </div>
      </>
    );
  } else if (tb) {
    body = <><p className="qtext">{tb.q}</p><div className="key"><div className="lbl">Answer{view.revealed ? '' : ' (only you can see this)'}</div><div className="ans">{tb.a}</div></div></>;
  } else if (slide.type === 'round') {
    const r = quiz.rounds[slide.r!];
    body = <><h2>{r.icon} Round {slide.r! + 1}: {r.title}</h2><p className="muted">Teams can play their joker now.</p></>;
  } else body = <h2>{titles[slide.type] ?? slide.type}</h2>;

  const hint = slide.type === 'question' && q && 'hint' in q && q.hint ? q.hint : null;
  const tune = q?.kind === 'music' && q.tune != null;
  return (
    <>
      <Disputes view={view} run={run} />
      <div className="card">
        <p className="kicker">{left || quizName(view, quiz)}{right ? ` · ${right}` : ''}</p>
        {body}
        <TimerRow view={view} run={run} halftime={slide.type === 'halftime'} />
        <div className="row-btns">
          {tune && <button className={`btn${view.tv.playing ? ' on' : ''}`} onClick={() => run('tune')}>{view.tv.playing ? 'Stop tune' : 'Play tune'}</button>}
          {hint && <button className={`btn${view.hint ? ' on' : ''}`} onClick={() => run('hint')}>{view.hint ? 'Hide hint' : 'Show hint'}</button>}
          {slide.type === 'halftime' && <button className={`btn${view.tv.lounge ? ' on' : ''}`} onClick={() => run('lounge')}>{view.tv.lounge ? 'Stop music' : 'Lounge music'}</button>}
          {slide.type === 'tbIntro' && <button className="btn" onClick={() => run('jump', { index: winnerIndex })}>Skip to the winner</button>}
          <button className="btn" onClick={() => run('read')}>Read aloud</button>
          <button className={`btn${view.tv.muted ? ' on' : ''}`} onClick={() => run('mute')}>{view.tv.muted ? 'Unmute' : 'Mute'}</button>
        </div>
        {hint && <p className="muted" style={{ marginTop: 8 }}>Hint: {hint}</p>}
      </div>
      <Rows view={view} run={run} />
      {!view.current && view.teams.length > 0 && (
        <div className="card plain">
          <p className="kicker">Teams · {view.teams.filter(t => t.online).length}/{view.teams.filter(t => t.phone).length} phones connected</p>
          {view.teams.map(t => (
            <div key={t.id} className="rhead" style={{ padding: '4px 0' }}>
              <span className={`dot${t.online ? ' on' : ''}`} />{t.name}{!t.phone && <span className="chip">paper</span>}{t.joker >= 0 && <span className="chip">🃏 R{t.joker + 1}</span>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function TimerRow({ view, run, halftime }: { view: HostView; run: Run; halftime: boolean }) {
  const t = view.timer;
  useTick(250, t.mode !== 'none');
  if (t.mode === 'none') return null;
  const left = timeLeft(t);
  const label = t.running ? 'Pause' : t.done ? 'Restart' : left < t.total ? 'Resume' : 'Start';
  return (
    <div className="timer">
      <span className={`t${left <= 5 && !halftime ? ' warn' : ''}`}>{fmtTime(left)}</span>
      <button className="btn primary" onClick={() => run('timer')}>{label} timer</button>
      {halftime && <><button className="btn" onClick={() => run('break_adjust', { minutes: -1 })}>−1 min</button><button className="btn" onClick={() => run('break_adjust', { minutes: 1 })}>+1 min</button></>}
    </div>
  );
}

function Disputes({ view, run }: { view: HostView; run: Run }) {
  if (!view.disputes.length) return null;
  const ruling = !!view.theatre && view.theatre.phase !== 'showing';
  return (
    <div className="card alert">
      <p className="kicker">⚖️ Disputes</p>
      {view.disputes.map(d => {
        const onScreen = view.theatre?.key === d.key;
        const opts = d.max > 1 ? [0, 1, 2] : [d.from, d.from ? 0 : 1];
        return (
          <div key={d.key} className="dp">
            <p><b>{d.teamName}</b> challenge{d.markerName ? <> the mark from <b>{d.markerName}</b></> : ' their mark'}</p>
            <p className="muted">{d.question}</p>
            <div className="vs">
              <div><span className="lbl2">Their answer</span><b>{d.theirs}</b></div>
              <div className="k"><span className="lbl2">Correct</span><b>{d.correct}</b></div>
            </div>
            {d.reason && <p className="reason">“{d.reason}”</p>}
            <p className="muted">Marked {ptsText(d.from, d.max)}{onScreen ? ' · on the big screen now' : ''}</p>
            <div className="row-btns">
              {opts.map(v => (
                <button key={v} className={`btn ${v === d.from ? 'danger' : 'good'}`} disabled={ruling} onClick={() => run('dispute_rule', { key: d.key, pts: v })}>
                  {v === d.from ? `Uphold (${ptsText(v, d.max)})` : `Overturn → ${ptsText(v, d.max)}`}
                </button>
              ))}
              {onScreen ? <button className="btn" disabled={ruling} onClick={() => run('dispute_later', { key: d.key })}>Later</button>
                : <button className="btn" disabled={ruling} onClick={() => run('dispute_show', { key: d.key })}>Show on screen</button>}
            </div>
          </div>
        );
      })}
      <p className="muted">Ruling plays a drumroll and the verdict on the big screen.</p>
    </div>
  );
}

function Rows({ view, run }: { view: HostView; run: Run }) {
  const cur = view.current;
  if (!cur) return null;
  const isAns = view.slide.type === 'answer', isTb = view.slide.type === 'tb', music = cur.max > 1;
  const phones = cur.rows.filter(r => view.teams.find(t => t.id === r.team)?.phone);
  if (!phones.length) return <div className="card plain"><p className="muted">No teams have joined on phones yet.</p></div>;
  const done = phones.filter(r => (isAns ? r.mark != null : r.answer)).length;
  const opts = music ? [0, 1, 2] : [0, 1];
  return (
    <div className="card plain">
      <p className="kicker">{isAns ? `Marking · ${done}/${phones.length} marked` : `Answers in · ${done}/${phones.length}`}</p>
      <ul className="rows">
        {phones.map(r => {
          const team = view.teams.find(t => t.id === r.team)!;
          const marker = r.marker ? teamName(view, r.marker) : null;
          return (
            <li key={r.team}>
              <div className="rhead"><span className={`dot${team.online ? ' on' : ''}`} />{team.name}</div>
              <div className={`rans${r.answer ? '' : ' none'}`}>{r.answer || 'No answer yet'}</div>
              <div className="chips">
                {team.joker === view.slide.r && !isTb && <span className="chip">🃏 joker</span>}
                {isAns && r.suggest && <span className={`chip ${r.suggest.level}`}>{r.suggest.level === 'match' ? (music ? `looks like ${r.suggest.pts}` : r.suggest.pts ? 'looks right' : 'looks wrong') : 'close?'}</span>}
                {isAns && r.mark != null && <span className="chip">{r.src === 'host' ? 'marked by you' : r.src === 'auto' ? 'auto-marked' : marker ? `by ${marker}` : 'marked'}</span>}
                {isAns && r.mark == null && marker && <span className="chip">{marker} to mark</span>}
                {r.warn && <span className="chip warn">⚠ check this</span>}
                {r.dispute && <span className={`chip ${r.dispute === 'open' ? 'warn' : ''}`}>⚖️ {r.dispute === 'open' ? 'disputed' : r.dispute}</span>}
                {isTb && r.off != null && <span className="chip close">off by {fmtPts(r.off)}</span>}
              </div>
              {isAns && (
                <div className="mk">
                  {opts.map(v => (
                    <button key={v} className={r.mark === v ? `on ${v ? 'pos' : 'zero'}` : ''} aria-pressed={r.mark === v}
                      onClick={() => run('mark', { qk: cur.qk, team: r.team, pts: r.mark === v ? null : v })}>{music ? v : v ? '✓' : '✗'}</button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {isAns && <div className="row-btns"><button className="btn" onClick={() => run('auto_mark')}>Auto-mark the obvious ones</button></div>}
      {isTb && <p className="muted" style={{ marginTop: 8 }}>Closest first. Give the winner points in Scores → Adj.</p>}
    </div>
  );
}

/* ---------- Scores ---------- */

function ScoresTab({ view, run }: { view: HostView; run: Run }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => { if (!armed) return; const t = window.setTimeout(() => setArmed(null), 3000); return () => window.clearTimeout(t); }, [armed]);
  const teams = [...view.teams].sort((a, b) => a.rank - b.rank);
  if (!teams.length) return <div className="card plain"><p className="muted">No teams yet.</p></div>;
  const rc = teams[0].rounds.length;
  return (
    <div className="card plain">
      <p className="kicker">Standings</p>
      {teams.map(t => (
        <div key={t.id} className="score">
          <span className="rk">{t.rank}</span>
          <span><span className={`dot${t.online ? ' on' : ''}`} style={{ display: 'inline-block', marginRight: 6 }} /><b>{t.name}</b></span>
          <span className="tot">{fmtPts(t.total)}</span>
          <details open={open.has(t.id)} onToggle={e => { const o = (e.target as HTMLDetailsElement).open; setOpen(s => { const n = new Set(s); if (o) n.add(t.id); else n.delete(t.id); return n; }); }}>
            <summary>Rounds, joker and adjustments</summary>
            <div className="rounds">{t.rounds.map((v, k) => <span key={k} title={`Round ${k + 1}`}>R{k + 1}<br /><b>{v == null ? '–' : fmtPts(v)}</b>{t.joker === k ? '🃏' : ''}</span>)}</div>
            <div className="edit">
              <label className="field">Joker round
                <select className="inp" value={t.joker} onChange={e => run('team_update', { team: t.id, joker: +e.target.value })}>
                  <option value={-1}>None</option>
                  {Array.from({ length: rc }, (_, k) => <option key={k} value={k}>Round {k + 1}</option>)}
                </select>
              </label>
              <label className="field">Adj. (tiebreak / penalty)
                <NumberField value={t.adj} onCommit={v => run('team_update', { team: t.id, adj: v })} />
              </label>
            </div>
            <div className="row-btns">
              <button className="btn danger" onClick={() => { if (armed === t.id) { setArmed(null); run('team_remove', { team: t.id }); } else setArmed(t.id); }}>
                {armed === t.id ? 'Tap again to remove' : 'Remove team'}
              </button>
            </div>
          </details>
        </div>
      ))}
      <p className="muted" style={{ marginTop: 8 }}>Round scores fill in from marking. Totals include jokers and adjustments.</p>
    </div>
  );
}

/** A number box that only sends when you've finished typing (blur or Enter). */
function NumberField({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value || ''));
  useEffect(() => { setText(String(value || '')); }, [value]);
  const commit = () => { const v = text.trim() === '' ? 0 : Number(text); if (Number.isFinite(v) && v !== value) onCommit(v); };
  return <input className="inp" type="number" inputMode="decimal" step="0.5" value={text} onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); }} />;
}

/* ---------- Menu ---------- */

function MenuTab({ room, run, onJump }: { room: HostRoom; run: Run; onJump: () => void }) {
  const view = room.view!, quiz = room.quiz!, st = view.settings;
  const targets = jumpTargets(quiz, room.slides);
  let here = 0;
  targets.forEach((t, k) => { if (t[1] <= view.index) here = k; });
  const [name, setName] = useState(st.quiz_name);
  useEffect(() => setName(st.quiz_name), [st.quiz_name]);
  return (
    <>
      <div className="card plain">
        <p className="kicker">Jump to</p>
        <div className="jumps">
          {targets.map(([label, index], k) => <button key={label} className={`btn${k === here ? ' on' : ''}`} onClick={() => { run('jump', { index }); onJump(); }}>{label}</button>)}
        </div>
      </div>
      <div className="card plain">
        <p className="kicker">Settings</p>
        <label className="field">Quiz name<input className="inp" maxLength={40} value={name} onChange={e => setName(e.target.value)} onBlur={() => name !== st.quiz_name && run('settings', { quiz_name: name })} /></label>
        <div className="edit">
          <label className="field">Seconds per question<NumberField value={st.seconds} onCommit={v => run('settings', { seconds: v })} /></label>
          <label className="field">Half-time minutes<NumberField value={st.break_minutes} onCommit={v => run('settings', { break_minutes: v })} /></label>
        </div>
        <label className="field" style={{ marginTop: 10 }}>Volume
          <input type="range" min={0} max={1} step={0.05} defaultValue={view.tv.volume ?? 0.7} onChange={e => run('volume', { value: +e.target.value })} />
        </label>
        <label className="check"><input type="checkbox" checked={st.auto_read} onChange={e => run('settings', { auto_read: e.target.checked })} />Read questions and answers aloud</label>
        <label className="check"><input type="checkbox" checked={st.auto_timer} onChange={e => run('settings', { auto_timer: e.target.checked })} />Start the timer automatically</label>
        <div className="row-btns"><button className="btn" onClick={() => run('close_panels')}>Close pop-ups on the main screen</button></div>
      </div>
    </>
  );
}
