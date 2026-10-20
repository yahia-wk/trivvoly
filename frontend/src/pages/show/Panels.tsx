// The quizmaster's pop-up panels on the TV: answers from phones, scores, and the menu.
import { useEffect, useState, type ReactNode } from 'react';
import { Qr } from '../../components/Qr';
import { fmtPts } from '../../lib/clock';
import { teamName } from '../../lib/host';
import { rememberedKey } from '../../lib/quizmaster';
import { answerLine, hudLabels, isRevealable, jumpTargets, questionOf } from '../../lib/slides';
import type { HostView, Quiz, RoomInfo, Slide } from '../../lib/types';

type Run = (cmd: string, args?: Record<string, unknown>) => Promise<void>;

export function Modal({ id, title, onClose, children }: { id: string; title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal" id={id} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel">
        <div className="panel-head"><h2 id={`${id}-title`}>{title}</h2><button className="btn primary" type="button" onClick={onClose} autoFocus>Done</button></div>
        {children}
      </div>
    </div>
  );
}

/** A button that needs a second tap within 3 seconds. */
function ArmedButton({ className, label, armedLabel, onConfirm }: { className: string; label: ReactNode; armedLabel: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = window.setTimeout(() => setArmed(false), 3000); return () => window.clearTimeout(t); }, [armed]);
  return <button type="button" className={`${className}${armed ? ' armed' : ''}`} onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}>{armed ? armedLabel : label}</button>;
}

/* ---------- Answers from phones ---------- */

export function AnswersPanel({ view, quiz, slide, quizName, run, onClose }: { view: HostView; quiz: Quiz; slide: Slide; quizName: string; run: Run; onClose: () => void }) {
  const [peek, setPeek] = useState(false);
  const cur = view.current, isQ = slide.type === 'question', isTb = slide.type === 'tb', isAns = slide.type === 'answer';
  const [left, right] = hudLabels(quiz, slide, quizName);
  const phones = view.teams.filter(t => t.phone);
  const nav = (
    <div className="panel-foot">
      <div>
        <button className="btn" type="button" onClick={() => run('prev')}>Back</button>
        <button className="btn primary" type="button" onClick={() => run('next')}>{isRevealable(slide) && !view.revealed ? 'Reveal' : 'Next slide'}</button>
      </div>
      <div>
        {isQ && <button className="btn" type="button" onClick={() => setPeek(p => !p)}>{peek ? 'Hide answers' : 'Show answers'}</button>}
        {isAns && phones.length > 0 && <button className="btn" type="button" title="Marks blanks and clear matches. Anything unclear is left for you." onClick={() => run('auto_mark')}>Auto-mark the obvious ones</button>}
      </div>
    </div>
  );
  if (!cur) {
    return (
      <Modal id="answers" title="Answers from phones" onClose={onClose}>
        <p className="panel-note">Go to a question or answer slide to see what teams sent in.</p>
        {!phones.length && <p className="empty-note">No teams have joined yet.</p>}
        <table className="ans-table"><tbody>
          {phones.map(t => (
            <tr key={t.id}><td className="a-team"><span className={`on-dot${t.online ? ' on' : ''}`} />{t.name}</td><td>{t.online ? 'Connected' : 'Offline'}</td><td>{t.joker >= 0 ? `🃏 Joker on round ${t.joker + 1}` : ''}</td></tr>
          ))}
        </tbody></table>
        {nav}
      </Modal>
    );
  }
  const q = questionOf(quiz, slide), tb = isTb ? (quiz.tiebreakers ?? [])[slide.t!] : null;
  const key = q ? answerLine(q) : tb ? { a: tb.a, sub: '' } : null;
  const music = cur.max > 1, opts = music ? [0, 1, 2] : [0, 1];
  const pairing = Object.keys(view.pairings).length > 0;
  return (
    <Modal id="answers" title="Answers from phones" onClose={onClose}>
      <div className="ans-head">
        <p className="ans-q">{left} · {right}</p>
        {(isAns || isTb) && key && <span className="ans-key">Answer: {key.a}{key.sub ? ` · ${key.sub}` : ''}</span>}
      </div>
      {isAns && q?.mark && <p className="panel-note">Marking: {q.mark}</p>}
      {isQ && <p className="panel-note">Answers stay editable until the “Pens down” slide. {peek ? '' : 'Answer text is hidden so the room can’t see it.'}</p>}
      {isTb && <p className="panel-note">Sorted closest first. Give the winner tiebreak points under Scores → Adj.</p>}
      {isAns && pairing && <p className="panel-note">Teams are marking each other. Anything you click here overrides their mark and is final.</p>}
      {!phones.length && <p className="empty-note">No teams have joined yet.</p>}
      <div className="table-wrap">
        <table className="ans-table"><tbody>
          {cur.rows.filter(r => view.teams.find(t => t.id === r.team)?.phone).map(r => {
            const team = view.teams.find(t => t.id === r.team)!;
            const marker = r.marker ? teamName(view, r.marker) : null;
            return (
              <tr key={r.team}>
                <td className="a-team"><span className={`on-dot${team.online ? ' on' : ''}`} />{team.name}{!isTb && team.joker === slide.r ? ' 🃏' : ''}</td>
                <td>
                  {isQ && !peek ? (r.answer ? <span className="a-text">✓ Answered</span> : <span className="a-none">Waiting…</span>)
                    : r.answer ? <span className="a-text">{r.answer}</span> : <span className="a-none">No answer</span>}
                  {r.suggest && <span className={`sug ${r.suggest.level}`}>{r.suggest.level === 'match' ? (music ? `looks like ${r.suggest.pts}` : r.suggest.pts ? 'looks right' : 'looks wrong') : 'close?'}</span>}
                  {isTb && r.off != null && <span className="sug close">off by {fmtPts(r.off)}</span>}
                  {isAns && (r.mark != null ? <span className="sug src">{r.src === 'host' ? 'marked by you' : r.src === 'auto' ? 'auto-marked' : marker ? `marked by ${marker}` : 'marked'}</span>
                    : marker && <span className="sug src">{marker} to mark</span>)}
                  {r.warn && <span className="sug warn">⚠ check this</span>}
                  {r.dispute === 'open' && <><span className="sug warn">⚖️ disputed</span><button className="btn tiny" type="button" onClick={() => { run('dispute_show', { key: `${cur.qk}|${r.team}` }); onClose(); }}>Rule on it</button></>}
                  {r.dispute && r.dispute !== 'open' && <span className="sug src">⚖️ {r.dispute}</span>}
                </td>
                <td>
                  {isAns && (
                    <div className="mk">
                      {opts.map(v => (
                        <button key={v} type="button" className={r.mark === v ? `on ${v ? 'pos' : 'zero'}` : ''} aria-pressed={r.mark === v} title={`${v} point${v === 1 ? '' : 's'}`}
                          onClick={() => run('mark', { qk: cur.qk, team: r.team, pts: r.mark === v ? null : v })}>{music ? v : v ? '✓' : '✗'}</button>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody></table>
      </div>
      {nav}
    </Modal>
  );
}

/* ---------- Scores ---------- */

/** A text or number box that only sends when you've finished (blur or Enter). */
function CommitInput({ value, onCommit, ...rest }: { value: string; onCommit: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => { if (text !== value) onCommit(text); };
  return <input {...rest} value={text} onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
}

export function ScoresPanel({ view, round, run, onClose }: { view: HostView; round: number; run: Run; onClose: () => void }) {
  const rc = view.teams[0]?.rounds.length ?? 0;
  const downloadCsv = () => {
    const q = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
    const rows = [['Team', ...Array.from({ length: rc }, (_, k) => `R${k + 1}`), 'Joker', 'Adj', 'Total'],
      ...view.teams.map(t => [t.name, ...t.rounds.map(v => fmtPts(v)), t.joker >= 0 ? `R${t.joker + 1}` : '', fmtPts(t.adj), fmtPts(t.total)])];
    const url = URL.createObjectURL(new Blob([rows.map(r => r.map(q).join(',')).join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'trivvoly-scores.csv'; document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  return (
    <Modal id="scores" title="Scores" onClose={onClose}>
      <p className="panel-note">Rounds fill in automatically as answers are marked. For teams playing on paper, type their round points in yourself. Choose the round where a team played its joker and it counts double. Use Adj. for tiebreak points or penalties.</p>
      <div className="table-wrap">
        <table className="scores">
          <thead><tr>
            <th className="th-name">Team</th>
            {Array.from({ length: rc }, (_, k) => <th key={k} className={k === round ? 'cur' : ''}>R{k + 1}</th>)}
            <th>Joker</th><th title="Tiebreak points or penalties">Adj.</th><th>Total</th><th><span className="sr">Remove</span></th>
          </tr></thead>
          <tbody>
            {!view.teams.length && <tr><td colSpan={rc + 5} className="empty-note">No teams yet. They join on their phones, or add one for each table playing on paper.</td></tr>}
            {view.teams.map(t => (
              <tr key={t.id}>
                <td><CommitInput className="t-name" type="text" maxLength={30} aria-label="Team name" value={t.name} onCommit={v => run('team_update', { team: t.id, name: v })} /></td>
                {t.rounds.map((v, k) => (
                  <td key={k}><CommitInput className={`t-s${k === round ? ' cur' : ''}`} type="number" inputMode="decimal" step="0.5" aria-label={`Round ${k + 1} points`}
                    value={v == null ? '' : fmtPts(v)} onCommit={x => run('team_update', { team: t.id, manual: { round: k, points: x === '' ? null : x } })} /></td>
                ))}
                <td>
                  <select className="t-j" aria-label="Joker round" value={t.joker} onChange={e => run('team_update', { team: t.id, joker: +e.target.value })}>
                    <option value={-1}>None</option>
                    {Array.from({ length: rc }, (_, k) => <option key={k} value={k}>R{k + 1}</option>)}
                  </select>
                </td>
                <td><CommitInput className="t-adj" type="number" inputMode="decimal" step="0.5" aria-label="Adjustment" value={t.adj ? fmtPts(t.adj) : ''} onCommit={x => run('team_update', { team: t.id, adj: x === '' ? 0 : x })} /></td>
                <td className="t-total">{fmtPts(t.total)}</td>
                <td><ArmedButton className="x-btn" label="×" armedLabel="Remove?" onConfirm={() => run('team_remove', { team: t.id })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel-foot">
        <div><button className="btn primary" type="button" onClick={() => run('team_add', { name: `Table ${view.teams.length + 1}` })}>Add a paper team</button></div>
        <div>
          <button className="btn" type="button" onClick={downloadCsv}>Download CSV</button>
          <ArmedButton className="btn danger" label="Clear all teams" armedLabel="Tap again to clear" onConfirm={() => run('teams_clear')} />
        </div>
      </div>
    </Modal>
  );
}

/* ---------- Menu ---------- */

export function MenuPanel({ view, quiz, slides, room, volume, onVolume, run, onClose }: {
  view: HostView; quiz: Quiz; slides: Slide[]; room: RoomInfo | null; volume: number; onVolume: (v: number) => void; run: Run; onClose: () => void;
}) {
  const st = view.settings;
  const targets = jumpTargets(quiz, slides);
  let here = 0;
  targets.forEach((t, k) => { if (t[1] <= view.index) here = k; });
  const [showRemote, setShowRemote] = useState(false);
  const key = room ? rememberedKey(room.code) : null;
  const remoteUrl = room && key ? `${room.siteUrl}/r/${room.code}/remote#k=${key}` : null;
  return (
    <Modal id="menu" title="Menu" onClose={onClose}>
      <h3>Jump to</h3>
      <div className="jump-grid">
        {targets.map(([label, index], k) => <button key={label} className={`btn${k === here ? ' here' : ''}`} type="button" onClick={() => { run('jump', { index }); onClose(); }}>{label}</button>)}
      </div>
      <h3>Settings</h3>
      <div className="set-grid">
        <label className="set-row"><span>Quiz name (shown on the title slide)</span><CommitInput type="text" maxLength={40} value={st.quiz_name} onCommit={v => run('settings', { quiz_name: v })} /></label>
        <label className="set-row"><span>Seconds per question</span><CommitInput type="number" min={10} max={180} step={5} value={String(st.seconds)} onCommit={v => run('settings', { seconds: v })} /></label>
        <label className="set-row"><span>Half-time length in minutes</span><CommitInput type="number" min={1} max={30} value={String(st.break_minutes)} onCommit={v => run('settings', { break_minutes: v })} /></label>
        <label className="set-row"><span>Sound volume</span><input type="range" min={0} max={1} step={0.05} value={volume} onChange={e => onVolume(+e.target.value)} /></label>
        <label className="set-row check"><input type="checkbox" checked={st.auto_read} onChange={e => run('settings', { auto_read: e.target.checked })} /><span>Read questions and answers aloud automatically</span></label>
        <label className="set-row check"><input type="checkbox" checked={st.auto_timer} onChange={e => run('settings', { auto_timer: e.target.checked })} /><span>Start the timer automatically (in the music round, after the clip plays)</span></label>
      </div>
      <h3>Remote control</h3>
      <p className="panel-note">Run everything from your phone: slides, timer, marking, disputes and scores. The code below includes the answers key, so only show it when the room isn’t looking.</p>
      <div className="remote-box">
        {remoteUrl ? (
          <>
            <button className="btn" type="button" onClick={() => setShowRemote(s => !s)}>{showRemote ? 'Hide it' : 'Show remote QR code'}</button>
            {showRemote && <><div className="jc-qr"><Qr text={remoteUrl} size={180} /></div><div className="remote-url">{remoteUrl}</div></>}
          </>
        ) : <p className="panel-note">To show the remote’s code, open this screen from your quizmaster link again (the one you got when the game started).</p>}
      </div>
      <h3>Keyboard shortcuts</h3>
      <dl className="keys">
        <dt>Space, → or clicker</dt><dd>Next slide, or reveal the answer</dd>
        <dt>←</dt><dd>Previous slide</dd>
        <dt>T</dt><dd>Start or pause the timer</dd>
        <dt>P</dt><dd>Play or stop the tune (music round)</dd>
        <dt>H</dt><dd>Show or hide the hint (emoji round)</dd>
        <dt>V</dt><dd>Read the current question or answer aloud</dd>
        <dt>A</dt><dd>Answers from phones</dd>
        <dt>D</dt><dd>Show the next dispute</dd>
        <dt>S</dt><dd>Open scores</dd>
        <dt>G</dt><dd>Open this menu</dd>
        <dt>M</dt><dd>Mute or unmute</dd>
        <dt>F</dt><dd>Full screen</dd>
      </dl>
      <h3>End this game</h3>
      <p className="panel-note">Closes the room for everyone and deletes its teams, answers and scores from the server. Rooms also end on their own after a few hours.</p>
      <ArmedButton className="btn danger" label="End game and delete data" armedLabel="Tap again to end the game" onConfirm={() => run('end')} />
    </Modal>
  );
}
