// A team's phone: join, answer, play the joker, mark another team's answers, dispute marks.
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { Flag } from '../../components/Flag';
import { joinRoom } from '../../lib/api';
import { fmtTime, timeLeft } from '../../lib/clock';
import type { MarkItem, PlayerView, PublicQuestion, SheetItem, Standing } from '../../lib/types';
import { useRoom } from '../../lib/useRoom';
import { useTick } from '../../lib/useTick';
import './play.css';

type Draft = { a: string; b: string };
type Status = { text: string; cls: '' | 'ok' | 'err' };

export default function Play() {
  const { code = '' } = useParams();
  const [session, setSession] = useState(0); // a new connection after joining
  const [note, setNote] = useState('');
  return (
    <div className="page-play">
      <PlayerSession key={session} code={code} note={note} onJoined={() => { setNote(''); setSession(s => s + 1); }} onKicked={m => setNote(m)} />
    </div>
  );
}

function PlayerSession({ code, note, onJoined, onKicked }: { code: string; note: string; onJoined: () => void; onKicked: (m: string) => void }) {
  const { status, view, send } = useRoom<PlayerView>(code, 'player', 'phone');
  const [msg, say] = useFlash();
  useEffect(() => { if (status === 'kicked') onKicked('You were removed from the quiz, or the quiz was reset. Join again.'); }, [status, onKicked]);

  const brand = view?.slide.quizName || 'Trivvoly';
  if (status === 'closed') return <Shell brand={brand}><Ended /></Shell>;
  if (status === 'needjoin' || status === 'kicked') return <Shell brand={brand}><JoinCard code={code} note={note} onJoined={onJoined} /></Shell>;
  return (
    <Shell brand={brand} me={view?.me.name} online={status === 'open'}>
      {view ? <Game view={view} send={send} say={say} /> : <WaitCard icon="⏳" title="Connecting…" text="" />}
      {status === 'reconnecting' && <div className="offline">Reconnecting…</div>}
      {msg && <div className="msg" role="status">{msg}</div>}
    </Shell>
  );
}

function Shell({ brand, me, online, children }: { brand: string; me?: string; online?: boolean; children: ReactNode }) {
  return (
    <div className="wrap">
      <header>
        <div className="brand">{brand}</div>
        {me && <div className="me"><span className={`dot${online ? ' on' : ''}`} /><span>{me}</span></div>}
      </header>
      <main aria-live="polite">{children}</main>
    </div>
  );
}

function JoinCard({ code, note, onJoined }: { code: string; note: string; onJoined: () => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState(note);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try { await joinRoom(code, name); onJoined(); } catch (err) { setError((err as Error).message); setBusy(false); }
  }
  return (
    <div className="card">
      <p className="kicker">Welcome</p>
      <h1>Join the quiz</h1>
      <p className="muted">Pick a team name. Just one phone per team: whoever joins is your team’s answer-writer.</p>
      <form onSubmit={submit} autoComplete="off">
        <label className="field" htmlFor="team-name">Team name</label>
        <input className="inp" id="team-name" maxLength={30} required placeholder="The Quizzly Bears" enterKeyHint="go" value={name} onChange={e => setName(e.target.value)} />
        <button className="btn primary block" type="submit" disabled={busy}>Join</button>
        <div className="err-box" role="alert">{error}</div>
      </form>
    </div>
  );
}

function Ended() {
  return (
    <div className="card plain center">
      <div className="wait-ico" aria-hidden="true">👋</div>
      <h2>This game has ended</h2>
      <p className="muted">Thanks for playing! Got a new room code? <Link to="/" style={{ color: 'var(--gold)' }}>Join another game</Link>.</p>
    </div>
  );
}

function WaitCard({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <div className="card plain center">
      <div className="wait-ico" aria-hidden="true">{icon}</div>
      <h2>{title}</h2>
      {text && <p className="muted">{text}</p>}
    </div>
  );
}

/* ---------- The game ---------- */

interface GameProps { view: PlayerView; send: (cmd: string, args?: Record<string, unknown>) => Promise<void>; say: (m: string) => void }

function Game({ view, send, say }: GameProps) {
  const answers = useAnswers(view, send);
  const s = view.slide, me = view.me;
  const timer = s.timer?.mode === 'q' ? <TimerBar view={view} /> : null;

  switch (s.type) {
    case 'title': case 'rules':
      return <WaitCard icon="🎉" title="You’re in!" text="Eyes on the big screen. The quiz starts soon." />;
    case 'round':
      return <RoundIntro view={view} send={send} />;
    case 'question': case 'tb': {
      const info = s.question!, item = view.sheet.find(x => x.qk === info.qk) ?? null;
      const others = view.sheet.filter(x => x.qk !== info.qk);
      return (
        <>
          {timer}
          <div className="card">
            <p className="kicker">{info.label}</p>
            <QuestionBody info={info} />
            <AnswerFields info={info} open={item ? item.open : true} answers={answers} prefix="q" />
            <SaveStatus status={answers.status[info.qk]} />
          </div>
          {others.length > 0 && (
            <div className="card plain">
              <p className="kicker">Earlier this round: change answers until pens down</p>
              <Sheet items={others} editable answers={answers} send={send} say={say} />
            </div>
          )}
        </>
      );
    }
    case 'swap':
      return (
        <>
          <WaitCard icon="✏️" title="Pens down!" text="Answers are locked. Marking is next." />
          {me.marking && (
            <div className="card">
              <p className="kicker">Your marking job</p>
              <h2>You’re marking {me.marking.name}</h2>
              <p className="muted">As each answer is revealed, their answer appears here. Tap ✓ or ✗. Be fair… ish.</p>
            </div>
          )}
          <div className="card plain"><p className="kicker">Your answers</p><Sheet items={view.sheet} answers={answers} send={send} say={say} /></div>
        </>
      );
    case 'answer': {
      const revealed = view.sheet.filter(x => x.key), total = revealed.reduce((n, x) => n + (x.mark || 0), 0);
      return (
        <>
          {me.marking && (
            <div className="card">
              <p className="kicker">You’re marking</p>
              <h2>{me.marking.name}</h2>
              {view.markSheet.length ? <MarkSheet items={view.markSheet} current={s.question?.qk} send={send} say={say} />
                : <p className="muted">Their answers appear here as each answer is revealed.</p>}
            </div>
          )}
          <div className="card plain">
            <p className="kicker">Your answers{me.markedBy ? `, marked by ${me.markedBy}` : ''}</p>
            <p className="muted">{revealed.length ? `So far this round: ${total} point${total === 1 ? '' : 's'}${me.joker === s.r ? `, doubled to ${total * 2} by your joker!` : ''}` : 'Watch the big screen for the answer.'}</p>
            <Sheet items={view.sheet} answers={answers} send={send} say={say} />
          </div>
        </>
      );
    }
    case 'standings':
      return <div className="card"><p className="kicker">Scoreboard</p><h2>After round {s.r! + 1} of {s.rounds}</h2><Standings list={s.standings} me={me.id} /></div>;
    case 'halftime': return <WaitCard icon="🍕" title="Half-time" text="Refills, snacks, and arguing about the flags." />;
    case 'tbIntro': return <WaitCard icon="⚖️" title="Tiebreaker" text="Only if teams are level at the top. Closest number wins." />;
    case 'winner':
      return s.standings ? (
        <>
          <div className="card center"><div className="wait-ico">🏆</div><p className="kicker">Tonight’s champions</p><h1>{s.standings.filter(x => x.rank === 1).map(x => x.name).join(' & ')}</h1></div>
          <div className="card plain"><Standings list={s.standings} me={me.id} /></div>
        </>
      ) : <WaitCard icon="🥁" title="And the winners are…" text="Drumroll, please. Look at the big screen!" />;
    case 'end':
      return (
        <>
          <WaitCard icon="🎉" title="Thanks for playing!" text="Get home safe." />
          {s.standings && <div className="card plain"><p className="kicker">Final scores</p><Standings list={s.standings} me={me.id} /></div>}
        </>
      );
  }
  return <WaitCard icon="📺" title="Eyes on the big screen" text="" />;
}

function TimerBar({ view }: { view: PlayerView }) {
  useTick(200);
  const t = view.slide.timer!, left = timeLeft(t), frac = t.total ? left / t.total : 0;
  const label = t.done || left <= 0 ? 'Time’s up!' : `${fmtTime(left)}${t.running ? '' : left >= t.total ? ' (not started)' : ' (paused)'}`;
  return (
    <div>
      <div className={`timer${left <= 5 ? ' warn' : ''}`}><i style={{ transform: `scaleX(${frac})` }} /></div>
      <div className="timer-row"><span>Time left</span><span>{label}</span></div>
    </div>
  );
}

function RoundIntro({ view, send }: { view: PlayerView; send: GameProps['send'] }) {
  const s = view.slide, me = view.me, r = s.r!, rd = s.round ?? { title: '' };
  const used = me.joker >= 0 && me.joker < r, here = me.joker === r;
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true); setErr('');
    try { await send('joker', { round: r }); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  return (
    <>
      <div className="card">
        <p className="kicker">Round {r + 1} of {s.rounds}</p>
        <h1>{rd.icon} {rd.title}</h1>
        <p>{rd.blurb}</p>
        <p className="muted">{rd.scoring}</p>
      </div>
      <div className="card plain">
        <div className="joker">
          <span className="ico" aria-hidden="true">🃏</span>
          <div>
            <h2>Joker</h2>
            <p className="muted">{here ? 'Your joker is on this round: points count double!' : used ? `You played your joker in round ${me.joker + 1}.` : me.joker > r ? `Your joker is set for round ${me.joker + 1}.` : 'Double your points for one round. Play it before the round starts.'}</p>
          </div>
        </div>
        {!used && <button className={`btn ${here ? '' : 'primary'} block`} disabled={busy} onClick={toggle}>{here ? 'Take joker back' : 'Play joker on this round'}</button>}
        {err && <div className="status err">{err}</div>}
      </div>
    </>
  );
}

function QuestionBody({ info }: { info: PublicQuestion }) {
  return (
    <>
      {info.flag && <Flag id={info.flag} width={280} />}
      {info.cat && <><p><span className="chip">Category: {info.cat}</span></p><div className="clue">{info.clue}</div></>}
      {info.emoji ? <div className="big-emoji" role="img" aria-label="Emoji clue">{info.emoji}</div>
        : info.icon && !info.flag && !info.cat ? <div className="big-emoji" aria-hidden="true">{info.icon}</div> : null}
      {info.text && <p className="qtext">{info.text}</p>}
      {info.hint && <div className="hint">Hint: {info.hint}</div>}
    </>
  );
}

/* ---------- Answers: drafts, autosave, status ---------- */

interface Answers {
  value: (qk: string) => Draft;
  change: (qk: string, field: 'a' | 'b', v: string) => void;
  choose: (qk: string, letter: string) => void;
  flush: (qk: string) => void;
  status: Record<string, Status>;
}

function useAnswers(view: PlayerView, send: GameProps['send']): Answers {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [status, setStatus] = useState<Record<string, Status>>({});
  const timers = useRef<Record<string, number>>({});
  const latest = useRef(drafts);
  latest.current = drafts;

  const saved = useCallback((qk: string): Draft => {
    const my = view.sheet.find(x => x.qk === qk)?.my;
    return { a: my?.a ?? '', b: my?.b ?? '' };
  }, [view]);

  const save = useCallback(async (qk: string) => {
    window.clearTimeout(timers.current[qk]);
    delete timers.current[qk];
    const d = latest.current[qk];
    if (!d) return;
    try {
      await send('answer', { qk, a: d.a, b: d.b });
      setStatus(s => ({ ...s, [qk]: { text: d.a || d.b ? 'Saved ✓' : 'Cleared', cls: 'ok' } }));
    } catch (e) {
      setStatus(s => ({ ...s, [qk]: { text: (e as Error).message, cls: 'err' } }));
    }
  }, [send]);

  // Forget drafts the server has caught up with, or that can't be edited any more
  useEffect(() => {
    setDrafts(prev => {
      let changed = false;
      const next = { ...prev };
      for (const [qk, d] of Object.entries(prev)) {
        const item = view.sheet.find(x => x.qk === qk);
        const synced = item && (item.my ? item.my.a === d.a && (item.my.b || '') === (d.b || '') : !d.a && !d.b);
        if (!item || !item.open || (synced && !timers.current[qk])) { delete next[qk]; changed = true; }
      }
      return changed ? next : prev;
    });
  }, [view]);

  const value = (qk: string) => drafts[qk] ?? saved(qk);
  const change = (qk: string, field: 'a' | 'b', v: string) => {
    setDrafts(prev => ({ ...prev, [qk]: { ...(prev[qk] ?? saved(qk)), [field]: v } }));
    setStatus(s => ({ ...s, [qk]: { text: 'Saving…', cls: '' } }));
    window.clearTimeout(timers.current[qk]);
    timers.current[qk] = window.setTimeout(() => save(qk), 600);
  };
  const choose = (qk: string, letter: string) => {
    latest.current = { ...latest.current, [qk]: { a: letter, b: '' } };
    setDrafts(prev => ({ ...prev, [qk]: { a: letter, b: '' } }));
    save(qk);
  };
  const flush = (qk: string) => { if (timers.current[qk]) save(qk); };
  return { value, change, choose, flush, status };
}

function SaveStatus({ status }: { status?: Status }) {
  return <div className={`status ${status?.cls ?? ''}`}>{status?.text ?? ''}</div>;
}

function AnswerFields({ info, open, answers, prefix }: { info: PublicQuestion; open: boolean; answers: Answers; prefix: string }) {
  const v = answers.value(info.qk), id = (f: string) => `${prefix}-${info.qk}-${f}`;
  if (info.input === 'ab') {
    return (
      <div className="ab">
        {(['A', 'B'] as const).map(k => (
          <button key={k} type="button" className={v.a === k ? 'sel' : ''} aria-pressed={v.a === k} disabled={!open} onClick={() => answers.choose(info.qk, k)}>
            <b>{k}</b><span className="ico" aria-hidden="true">{info[k]?.icon}</span><span>{info[k]?.text}</span>
          </button>
        ))}
      </div>
    );
  }
  const field = (f: 'a' | 'b', label: string, extra: Record<string, string> = {}) => (
    <>
      <label className="field" htmlFor={id(f)}>{label}</label>
      <input className="inp" id={id(f)} value={v[f]} maxLength={120} autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="done" disabled={!open}
        onChange={e => answers.change(info.qk, f, e.target.value)} onBlur={() => answers.flush(info.qk)} {...extra} />
    </>
  );
  if (info.input === 'music') return <>{field('a', 'Song title')}{field('b', `${info.bLabel || 'Artist'} (bonus point)`)}</>;
  if (info.input === 'number') return field('a', 'Your number', { inputMode: 'decimal' });
  return field('a', 'Your answer');
}

/* ---------- Answer sheets ---------- */

const whatOf = (i: PublicQuestion) => i.cat ? `${i.cat}: ${i.clue}` : i.emoji ? i.emoji : i.flag ? 'Flag' : i.input === 'ab' ? `${i.A?.text} / ${i.B?.text}` : i.text ?? '';

function KeyLine({ k }: { k: { a: string; sub: string } }) {
  return <div className="right">Answer: {k.a}{k.sub ? ` · ${k.sub}` : ''}</div>;
}

function DisputeLine({ status }: { status: string }) {
  if (status === 'open') return <div className="dsp">⚖️ Disputed! The quizmaster will rule on the big screen.</div>;
  return <div className={`dsp ${status}`}>⚖️ {status === 'upheld' ? 'Dispute rejected: the mark stands.' : 'Dispute won: mark overturned!'}</div>;
}

function ResultBadge({ item }: { item: SheetItem }) {
  if (!item.key) return null;
  if (item.mark == null) return <span className="res wait">marking…</span>;
  const max = item.info.input === 'music' ? 2 : 1;
  return <span className={`res ${item.mark > 0 ? 'good' : 'bad'}`}>{item.mark > 0 ? (max > 1 ? `+${item.mark}` : '✓') : '✗'}</span>;
}

function Sheet({ items, editable = false, answers, send, say }: { items: SheetItem[]; editable?: boolean; answers: Answers; send: GameProps['send']; say: (m: string) => void }) {
  if (!items.length) return null;
  return (
    <ul className="sheet">
      {items.map(it => {
        const i = it.info, edit = editable && it.open;
        return (
          <li key={it.qk}>
            <span className="n">{i.n}</span>
            <div>
              <div className="what">{whatOf(i)}</div>
              {!edit && <MyAnswer info={i} my={it.my} />}
              {!edit && it.key && <KeyLine k={it.key} />}
              {!edit && <DisputeControl item={it} send={send} say={say} />}
            </div>
            <ResultBadge item={it} />
            {edit && <div className="edit"><AnswerFields info={i} open answers={answers} prefix="sh" /><SaveStatus status={answers.status[it.qk]} /></div>}
          </li>
        );
      })}
    </ul>
  );
}

function MyAnswer({ info, my }: { info: PublicQuestion; my: SheetItem['my'] }) {
  if (!my || (!my.a && !my.b)) return <div className="mine none">No answer</div>;
  if (info.input === 'ab') return <div className="mine">{my.a}: {(my.a === 'A' ? info.A : info.B)?.text ?? ''}</div>;
  return <div className="mine">{my.a || '—'}{my.b && <span className="muted"> · {my.b}</span>}</div>;
}

function DisputeControl({ item, send, say }: { item: SheetItem; send: GameProps['send']; say: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  if (item.dispute) return <DisputeLine status={item.dispute.status} />;
  if (!item.key || item.mark == null) return null;
  if (item.src === 'host') return <div className="dsp">Marked by the quizmaster. Their decision is final.</div>;
  if (!open) return <button type="button" className="link" onClick={() => setOpen(true)}>Dispute this mark</button>;
  const submit = async () => {
    setBusy(true);
    try { await send('dispute', { qk: item.qk, reason }); setOpen(false); say('Dispute sent. All eyes on the big screen!'); }
    catch (e) { say((e as Error).message); setBusy(false); }
  };
  return (
    <div className="dform">
      <input className="inp sm" maxLength={100} placeholder="Why? (optional, shown on the big screen)" autoComplete="off" autoFocus value={reason} onChange={e => setReason(e.target.value)} />
      <button type="button" className="btn primary sm" disabled={busy} onClick={submit}>Send dispute</button>
      <button type="button" className="btn sm" onClick={() => setOpen(false)}>Cancel</button>
    </div>
  );
}

function MarkSheet({ items, current, send, say }: { items: MarkItem[]; current?: string; send: GameProps['send']; say: (m: string) => void }) {
  const mark = async (it: MarkItem, v: number) => {
    try { await send('peer_mark', { qk: it.qk, pts: it.mark === v ? null : v }); } catch (e) { say((e as Error).message); }
  };
  return (
    <ul className="sheet">
      {items.slice().reverse().map(it => {
        const locked = it.src === 'host' || !!it.dispute, opts = it.max === 2 ? [0, 1, 2] : [0, 1];
        return (
          <li key={it.qk} className={it.qk === current ? 'cur' : ''}>
            <span className="n">{it.info.n}</span>
            <div className="mcol">
              <div className="what">{whatOf(it.info)}</div>
              <div className={`mine${it.their ? '' : ' none'}`}>{it.their || 'No answer'}</div>
              <KeyLine k={it.key} />
              {it.key.note && <div className="note">Marking note: {it.key.note}</div>}
              <div className="pm">
                {opts.map(v => (
                  <button key={v} type="button" className={it.mark === v ? `on ${v ? 'pos' : 'zero'}` : ''} aria-pressed={it.mark === v}
                    aria-label={`${v} point${v === 1 ? '' : 's'}`} disabled={locked} onClick={() => mark(it, v)}>
                    {it.max === 2 ? v : v ? '✓' : '✗'}
                  </button>
                ))}
              </div>
              {it.dispute ? <DisputeLine status={it.dispute.status} /> : it.src === 'host' ? <div className="dsp">The quizmaster marked this one.</div> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Standings({ list, me }: { list?: Standing[]; me: string }) {
  if (!list?.length) return <p className="muted">No scores yet.</p>;
  return (
    <ol className="board">
      {list.map(x => <li key={x.id} className={x.id === me ? 'mine' : ''}><span className="rk">{x.rank}</span><span>{x.name}</span><span className="sc">{x.total}</span></li>)}
    </ol>
  );
}

/** A message that disappears after a few seconds. */
function useFlash(): [string, (m: string) => void] {
  const [msg, setMsg] = useState('');
  const timer = useRef(0);
  const say = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(''), 3500);
  }, []);
  return [msg, say];
}
