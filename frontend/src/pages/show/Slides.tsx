// Everything that can appear on the big screen's board, one component per kind of slide.
import type { ReactNode } from 'react';
import { Flag } from '../../components/Flag';
import { Qr } from '../../components/Qr';
import { fmtPts, ordinal } from '../../lib/clock';
import { questionOf } from '../../lib/slides';
import type { HostView, Question, Quiz, RoomInfo, Slide } from '../../lib/types';

export interface SlideProps {
  quiz: Quiz;
  slide: Slide;
  view: HostView;
  room: RoomInfo | null;
  quizName: string;
  playing: boolean;       // a tune is playing on this screen
  lounge: boolean;
  breakClock: string;
  standingsShown: number; // how many scoreboard rows have animated in
  onAct: (act: 'play' | 'break-toggle' | 'break-minus' | 'break-plus' | 'lounge' | 'scores' | 'skip-winner') => void;
}

// While phones are in play, the house rules talk about phones instead of paper
const LIVE_RULES: Record<string, { icon: string; text: string }> = {
  '📵': { icon: '📱', text: 'Phones are for answering only. No searching, no texting your clever cousin.' },
  '📝': { icon: '📝', text: 'Type every answer on your team’s phone. A guess can score; a blank never does.' },
  '🃏': { icon: '🃏', text: 'Each team has one joker that doubles its points for one round. Play it on your phone before that round starts.' }
};

export function SlideContent(p: SlideProps): ReactNode {
  const { quiz, slide: s, view } = p;
  switch (s.type) {
    case 'title':
      return (
        <div className="center-stack" data-fitbox="">
          <h1 className="mega" data-fit="80">{p.quizName}</h1>
          <p className="lede">{quiz.rounds.length} rounds, {quiz.rounds.reduce((n, r) => n + r.questions.length, 0)} questions, one winning team.</p>
          {p.room && <JoinCard room={p.room} />}
        </div>
      );
    case 'rules':
      return (
        <div className="rules-wrap">
          <h2 className="display-md">How tonight works</h2>
          <ul className="rules">
            {(quiz.rules ?? []).map((x, k) => {
              const r = (x.icon && LIVE_RULES[x.icon]) || x;
              return <li key={k} className="rule"><span className="ico" aria-hidden="true">{r.icon}</span><span>{r.text}</span></li>;
            })}
          </ul>
        </div>
      );
    case 'round': {
      const r = quiz.rounds[s.r!];
      return (
        <div className="round-intro">
          <div className="ri-num"><span className="ri-word">Round</span><span className="ri-digit">{s.r! + 1}</span></div>
          <div>
            <div className="ri-icon" aria-hidden="true">{r.icon}</div>
            <h2 className="ri-title">{r.title}</h2>
            <p className="ri-blurb">{r.blurb}</p>
            <p className="ri-scoring">{r.scoring}</p>
            <div className="ri-joker"><span aria-hidden="true">🃏</span><span>Playing your joker on this round? Tap it on your phone now.</span></div>
          </div>
        </div>
      );
    }
    case 'question': case 'answer':
      return <QuestionSlide {...p} q={questionOf(quiz, s)!} />;
    case 'swap':
      return (
        <div className="center-stack">
          <div className="big-icon" aria-hidden="true">✏️</div>
          <h2 className="display-xl">Pens down</h2>
          <p className="lede">Answers are locked in. Time to mark each other’s answers.</p>
          <Pairings view={view} />
        </div>
      );
    case 'standings': return <Standings view={view} round={s.r!} rounds={quiz.rounds.length} shown={p.standingsShown} onScores={() => p.onAct('scores')} />;
    case 'halftime':
      return (
        <div className="center-stack">
          <h2 className="display-lg">Half-time</h2>
          <div className="break-clock">{p.breakClock}</div>
          <div className="row-btns">
            <button className="pill-btn" onClick={() => p.onAct('break-toggle')}>{view.timer.running ? 'Pause break' : view.timer.done ? 'Restart break' : view.timer.remaining < view.timer.total ? 'Resume break' : 'Start break'}</button>
            <button className="pill-btn ghost" onClick={() => p.onAct('break-minus')}>−1 min</button>
            <button className="pill-btn ghost" onClick={() => p.onAct('break-plus')}>+1 min</button>
            <button className="pill-btn ghost" onClick={() => p.onAct('lounge')}>{p.lounge ? 'Stop music' : 'Play lounge music'}</button>
          </div>
          <p className="lede">Refills, snacks, and plenty of time to argue about the flags.</p>
        </div>
      );
    case 'tbIntro':
      return (
        <div className="center-stack">
          <div className="big-icon" aria-hidden="true">⚖️</div>
          <h2 className="display-xl">Tiebreaker</h2>
          <p className="lede">Only needed if teams are level at the top. Each tied team writes down a number, and the closest answer wins.</p>
          <div className="row-btns"><button className="pill-btn ghost" onClick={() => p.onAct('skip-winner')}>Skip to the winner</button></div>
        </div>
      );
    case 'tb': {
      const t = (quiz.tiebreakers ?? [])[s.t!];
      return (
        <div className="q-grid">
          <div className="q-visual"><div className="medallion" aria-hidden="true">{t.icon}</div></div>
          <div className="q-main" data-fitbox="">
            <p className="q-text" data-fit="34">{t.q}</p>
            <p className="q-prompt">Closest answer wins.</p>
            <Plate main={t.a} revealed={view.revealed} fact={t.fact} />
          </div>
        </div>
      );
    }
    case 'winner': return <Winner view={view} />;
    case 'end':
      return (
        <div className="center-stack">
          <div className="big-icon" aria-hidden="true">🎉</div>
          <h2 className="display-xl">Thanks for playing!</h2>
          <p className="lede">Get home safe, and bring your brains back next time.</p>
        </div>
      );
  }
  return null;
}

function JoinCard({ room }: { room: RoomInfo }) {
  const short = room.joinUrl.replace(/^https?:\/\//, '');
  const local = /^http:\/\/(\d+\.){3}\d+/.test(room.joinUrl);
  return (
    <div className="join-card">
      <div className="jc-qr"><Qr text={room.joinUrl} size={170} /></div>
      <div>
        <p className="jc-k">Join on your phone</p>
        <p className="jc-url">{short}</p>
        <p className="jc-code">{room.code}</p>
        <p className="jc-sub">{local ? 'Same Wi-Fi as this screen. Scan the code or open that address.' : 'Scan the code, or go to the address and enter the room code.'}</p>
      </div>
    </div>
  );
}

function Pairings({ view }: { view: HostView }) {
  const name = (id: string) => view.teams.find(t => t.id === id)?.name ?? '';
  const pairs = Object.entries(view.pairings);
  if (!pairs.length) return null;
  return <ul className="pairs">{pairs.map(([m, t]) => <li key={m}><b>{name(m)}</b><span>marks</span><b>{name(t)}</b></li>)}</ul>;
}

/* ---------- Questions and answers ---------- */

function Plate({ main, sub, fact, mark, revealed }: { main: string; sub?: string | null; fact?: string | null; mark?: string | null; revealed: boolean }) {
  return (
    <>
      <div className={`plate${revealed ? ' is-revealed' : ''}`}>
        <div className="plate-inner">
          <div className="plate-face plate-front"><span>?</span></div>
          <div className="plate-face plate-back"><div className="plate-answer">{main}</div>{sub && <div className="plate-sub">{sub}</div>}</div>
        </div>
      </div>
      <div className="after-reveal">{fact && <p className="fact">{fact}</p>}{mark && <p className="mark">Marking: {mark}</p>}</div>
    </>
  );
}

function Record({ n }: { n: number }) {
  return (
    <>
      <div className="record-wrap"><div className="record"><div className="record-label">{n}</div></div><div className="sheen" /></div>
      <div className="eq" aria-hidden="true">
        {Array.from({ length: 12 }, (_, k) => <i key={k} style={{ animationDelay: `${(-k * 0.13).toFixed(2)}s`, animationDuration: `${(0.5 + ((k * 37) % 5) * 0.12).toFixed(2)}s` }} />)}
      </div>
    </>
  );
}

const EmojiRow = ({ str }: { str: string }) => (
  <div className="emoji-clue" role="img" aria-label="Emoji clue" data-fit="56">{str.split(/\s+/).map((e, k) => <span key={k}>{e}</span>)}</div>
);

function QuestionSlide({ quiz, slide: s, view, playing, onAct, q }: SlideProps & { q: Question }) {
  const round = quiz.rounds[s.r!], ans = s.type === 'answer', n = s.q! + 1, revealed = view.revealed;
  const hintChip = 'hint' in q && q.hint ? <div className={`hint${view.hint ? ' show' : ''}`}>Hint: {q.hint}</div> : null;

  if (q.kind === 'music' && q.tune != null) {
    return (
      <div className="q-grid">
        <div className="q-visual"><Record n={n} /></div>
        <div className="q-main">
          <p className="q-text track">Track {n}</p>
          {ans ? <Plate main={q.a} sub={q.by} fact={q.fact} mark={q.mark} revealed={revealed} />
            : <p className="q-prompt">Listen up! Name the piece for 1 point.<br />Name the composer for a bonus point.</p>}
          <button className="pill-btn" onClick={() => onAct('play')}>{playing ? 'Stop tune' : ans ? 'Play it again' : 'Play tune'}</button>
        </div>
      </div>
    );
  }
  if (q.kind === 'flag' && q.flag) {
    return (
      <div className="q-stack">
        <Flag id={q.flag} height={ans ? 230 : 390} />
        {ans ? <Plate main={q.a} fact={q.fact} mark={q.mark} revealed={revealed} /> : <p className="q-prompt">Which country’s flag is this?</p>}
      </div>
    );
  }
  if (q.kind === 'vowels') {
    return (
      <div className="q-stack">
        <p className="cat-chip">Category: {q.cat}</p>
        <div className="tiles" data-fit="36">
          {q.clue.split(' ').map((w, k) => <span key={k} className="tw">{[...w].map((ch, j) => <span key={j} className="tile">{ch}</span>)}</span>)}
        </div>
        {ans ? <Plate main={q.a} fact={q.fact} mark={q.mark} revealed={revealed} /> : <p className="q-prompt">Put the vowels back to find the answer.</p>}
      </div>
    );
  }
  if (q.kind === 'versus') {
    const card = (k: 'a' | 'b') => {
      const o = k === 'a' ? q.A : q.B;
      return (
        <div className={`vs-card${q.first === k ? ' win' : ''}`}>
          <span className="vs-letter">{k.toUpperCase()}</span>
          <span className="vs-icon" aria-hidden="true">{o.icon}</span>
          <p className="vs-text">{o.text}</p>
          <span className="vs-date">{o.date}</span>
        </div>
      );
    };
    return (
      <div className="vs-wrap">
        <p className="q-prompt">Which came first? Write A or B.</p>
        <div className={`vs${revealed ? ' is-revealed' : ''}`}>{card('a')}<div className="vs-or">or</div>{card('b')}</div>
        {ans && <div className="after-reveal">{q.fact && <p className="fact">{q.fact}</p>}</div>}
      </div>
    );
  }
  if ('emoji' in q && q.emoji) {
    const sub = q.kind === 'music' ? `${q.by}${q.year ? ` (${q.year})` : ''}` : ('year' in q && q.year) || '';
    const text = 'q' in q && q.q ? <p className="q-text center" data-fit="30">{q.q}</p> : null;
    return (
      <div className="q-stack" data-fitbox="">
        <EmojiRow str={q.emoji} />
        {text}
        {ans ? <Plate main={q.a} sub={sub} fact={q.fact} mark={q.mark} revealed={revealed} />
          : <>{!text && <p className="q-prompt">{round.prompt || ''}</p>}{hintChip}</>}
      </div>
    );
  }
  const std = q as Extract<Question, { kind: 'standard' }>;
  return (
    <div className="q-grid">
      <div className="q-visual"><div className="medallion" aria-hidden="true">{std.icon}</div></div>
      <div className="q-main" data-fitbox="">
        <p className="q-text" data-fit="34">{std.q}</p>
        {ans && <Plate main={std.a} fact={std.fact} mark={std.mark} revealed={revealed} />}
      </div>
    </div>
  );
}

/* ---------- Scores ---------- */

function Standings({ view, round, rounds, shown, onScores }: { view: HostView; round: number; rounds: number; shown: number; onScores: () => void }) {
  const ranked = [...view.teams].sort((a, b) => a.rank - b.rank);
  const head = <h2 className="display-md">{round === rounds - 1 ? 'Final standings' : `Standings after round ${round + 1}`}</h2>;
  if (!ranked.length) {
    return (
      <div className="center-stack">
        <h2 className="display-md">Standings after round {round + 1}</h2>
        <p className="lede">No teams yet. Teams join on their phones, or add paper teams under Scores.</p>
        <div className="row-btns"><button className="pill-btn" onClick={onScores}>Open scores</button></div>
      </div>
    );
  }
  const max = Math.max(1, ...ranked.map(x => x.total));
  const list = ranked.slice(0, 20);
  return (
    <div className="standings">
      {head}
      <ol className={`board-list${list.length > 8 ? ' two' : ''}`}>
        {list.map((x, i) => (
          <li key={x.id} className={`${x.rank === 1 && x.total > 0 ? 'leader' : ''}${list.length - 1 - i < shown ? ' go' : ''}`}>
            <span className="rank">{x.rank}</span>
            <span className="tname">{x.name}</span>
            <span className="bar"><i style={{ ['--w' as string]: `${Math.max(0, x.total) / max * 100}%` }} /></span>
            <span className="tscore">{fmtPts(x.total)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Winner({ view }: { view: HostView }) {
  if (!view.revealed) {
    return (
      <div className="center-stack">
        <h2 className={`display-lg${view.rolling ? ' rolling' : ''}`}>And the winners are…</h2>
        <p className="lede">{view.rolling ? 'Drumroll, please.' : 'Press Next for the drumroll.'}</p>
      </div>
    );
  }
  const ranked = [...view.teams].sort((a, b) => a.rank - b.rank);
  if (!ranked.length) return <div className="winner"><h2 className="w-name" data-fit="60">Congratulations!</h2><p className="w-score">Add teams under Scores to crown a named winner.</p></div>;
  const top = ranked.filter(x => x.rank === 1), rest = ranked.filter(x => x.rank > 1).slice(0, 2);
  return (
    <div className="winner" data-fitbox="">
      <p className="w-label">{top.length > 1 ? 'Joint champions' : 'Tonight’s champions'}</p>
      <h2 className="w-name" data-fit="56">{top.map(x => x.name).join(' & ')}</h2>
      <p className="w-score">{fmtPts(top[0].total)} points</p>
      {rest.length > 0 && <div className="podium">{rest.map(x => <span key={x.id}>{ordinal(x.rank)}: {x.name} ({fmtPts(x.total)})</span>)}</div>}
    </div>
  );
}
