// The quiz builder's forms. Each field shows the server's problem for it, if any.
import { useState } from 'react';
import FLAGS from '../../../../shared/flags.json';
import { Flag } from '../../components/Flag';
import type { Question, Quiz, Round } from '../../lib/types';
import { SFX, TunePlayer } from '../show/audio';
import { at, convertQuestion, describePath, KINDS, under, vowelClue, type Kind, type Problem, type Rule, type Tiebreaker, type Tune } from './draft';

const FLAG_IDS = Object.keys(FLAGS);
const INSTRUMENTS: Tune['inst'][] = ['strings', 'organ', 'brass', 'piano', 'pluck'];

/* ---------- Small building blocks ---------- */

interface FieldProps {
  label: string;
  value: string | number | null | undefined;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
  max?: number;
  multiline?: boolean;
  placeholder?: string;
  type?: 'text' | 'number';
  wide?: boolean;
  step?: number;
}

export function Field({ label, value, onChange, error, hint, max, multiline, placeholder, type = 'text', wide, step }: FieldProps) {
  const common = { className: `inp${error ? ' bad' : ''}`, value: value ?? '', placeholder, maxLength: max, 'aria-invalid': !!error || undefined, onChange: (e: { target: { value: string } }) => onChange(e.target.value) };
  return (
    <label className={`fld${wide ? ' wide' : ''}`}>
      <span className="lbl">{label}{max && typeof value === 'string' && value.length > max * 0.8 ? <em> {value.length}/{max}</em> : null}</span>
      {multiline ? <textarea rows={2} {...common} /> : <input type={type} step={step} {...common} />}
      {error ? <span className="err">This {error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

function ItemTools({ index, count, onMove, onDuplicate, onDelete, what }: { index: number; count: number; onMove: (to: number) => void; onDuplicate?: () => void; onDelete: () => void; what: string }) {
  return (
    <div className="tools">
      <button type="button" className="mini" disabled={index === 0} onClick={() => onMove(index - 1)} aria-label={`Move ${what} up`}>↑</button>
      <button type="button" className="mini" disabled={index === count - 1} onClick={() => onMove(index + 1)} aria-label={`Move ${what} down`}>↓</button>
      {onDuplicate && <button type="button" className="mini" onClick={onDuplicate}>Duplicate</button>}
      <button type="button" className="mini danger" disabled={count <= 1 && what !== 'tiebreaker' && what !== 'rule' && what !== 'tune'} onClick={onDelete}>Delete</button>
    </div>
  );
}

export function move<T>(list: T[], from: number, to: number): T[] {
  const out = list.slice();
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}

export function ProblemList({ problems }: { problems: Problem[] }) {
  if (!problems.length) return null;
  return <ul className="probs">{problems.map((p, k) => <li key={k}><b>{describePath(p.path)}</b> {p.message}</li>)}</ul>;
}

/* ---------- Quiz details ---------- */

export function DetailsEditor({ quiz, set, problems }: { quiz: Quiz; set: (q: Quiz) => void; problems: Problem[] }) {
  const rules = quiz.rules ?? [];
  const setRule = (i: number, r: Rule) => set({ ...quiz, rules: rules.map((x, k) => (k === i ? r : x)) });
  return (
    <section className="ed">
      <h2>Quiz details</h2>
      <div className="row">
        <Field label="Title (shown on the title slide)" value={quiz.title} max={40} error={at(problems, 'quiz.title')} onChange={v => set({ ...quiz, title: v })} wide />
        <label className="fld">
          <span className="lbl">Half-time break</span>
          <select className="inp" value={quiz.halftimeAfter ?? -1} onChange={e => set({ ...quiz, halftimeAfter: +e.target.value })}>
            <option value={-1}>No half-time</option>
            {quiz.rounds.slice(0, -1).map((r, k) => <option key={k} value={k}>After round {k + 1}: {r.title || 'untitled'}</option>)}
          </select>
          {at(problems, 'quiz.halftimeAfter') && <span className="err">{at(problems, 'quiz.halftimeAfter')}</span>}
        </label>
      </div>
      <h3>House rules <span className="sub">shown before round 1 (up to 10)</span></h3>
      {rules.map((r, i) => (
        <div key={i} className="card">
          <div className="row">
            <Field label="Icon" value={r.icon} max={16} error={at(problems, `quiz.rules[${i}].icon`)} onChange={v => setRule(i, { ...r, icon: v })} placeholder="📵" />
            <Field label="Rule" value={r.text} max={200} wide error={at(problems, `quiz.rules[${i}].text`)} onChange={v => setRule(i, { ...r, text: v })} />
          </div>
          <ItemTools index={i} count={rules.length} what="rule" onMove={to => set({ ...quiz, rules: move(rules, i, to) })} onDelete={() => set({ ...quiz, rules: rules.filter((_, k) => k !== i) })} />
        </div>
      ))}
      {rules.length < 10 && <button type="button" className="btn" onClick={() => set({ ...quiz, rules: [...rules, { icon: '✨', text: '' }] })}>Add a rule</button>}
    </section>
  );
}

/* ---------- Rounds ---------- */

export function RoundEditor({ quiz, index, set, problems, onPreview, previewing }: {
  quiz: Quiz; index: number; set: (q: Quiz) => void; problems: Problem[]; onPreview: (q: number) => void; previewing: number | null;
}) {
  const round = quiz.rounds[index], base = `quiz.rounds[${index}]`;
  const setRound = (r: Round) => set({ ...quiz, rounds: quiz.rounds.map((x, k) => (k === index ? r : x)) });
  const setQ = (qi: number, q: Question) => setRound({ ...round, questions: round.questions.map((x, k) => (k === qi ? q : x)) });
  const changeKind = (kind: Kind) => setRound({ ...round, kind, questions: round.questions.map(q => convertQuestion(q, kind)) });
  return (
    <section className="ed">
      <h2>Round {index + 1}</h2>
      <div className="row">
        <Field label="Title" value={round.title} max={40} error={at(problems, `${base}.title`)} onChange={v => setRound({ ...round, title: v })} wide />
        <Field label="Icon" value={round.icon} max={16} error={at(problems, `${base}.icon`)} onChange={v => setRound({ ...round, icon: v })} placeholder="🎲" />
        <label className="fld">
          <span className="lbl">Kind of round</span>
          <select className="inp" value={round.kind} onChange={e => changeKind(e.target.value as Kind)}>
            {KINDS.map(k => <option key={k.kind} value={k.kind}>{k.label}</option>)}
          </select>
          <span className="hint">{KINDS.find(k => k.kind === round.kind)!.hint}</span>
        </label>
      </div>
      <div className="row">
        <Field label="Blurb (round intro)" value={round.blurb} max={300} multiline wide error={at(problems, `${base}.blurb`)} onChange={v => setRound({ ...round, blurb: v })} />
        <Field label="Scoring" value={round.scoring} max={160} error={at(problems, `${base}.scoring`)} onChange={v => setRound({ ...round, scoring: v })} placeholder="8 questions, 1 point each." />
        {(round.kind === 'emoji' || round.kind === 'music') && (
          <Field label="Prompt under emoji clues" value={round.prompt} max={160} error={at(problems, `${base}.prompt`)} onChange={v => setRound({ ...round, prompt: v })} placeholder="Name the film." />
        )}
      </div>
      <h3>Questions <span className="sub">{round.questions.length} of up to 30</span></h3>
      {at(problems, `${base}.questions`) && <p className="err">{at(problems, `${base}.questions`)}</p>}
      {round.questions.map((q, qi) => {
        const qPath = `${base}.questions[${qi}]`, qProblems = under(problems, qPath);
        return (
          <div key={qi} className={`card${qProblems.length ? ' has-problems' : ''}${previewing === qi ? ' previewing' : ''}`}>
            <div className="card-head">
              <b>Question {qi + 1}</b>
              <button type="button" className="mini" onClick={() => onPreview(qi)}>{previewing === qi ? 'Previewing' : 'Preview'}</button>
              <ItemTools index={qi} count={round.questions.length} what="question"
                onMove={to => setRound({ ...round, questions: move(round.questions, qi, to) })}
                onDuplicate={round.questions.length < 30 ? () => setRound({ ...round, questions: [...round.questions.slice(0, qi + 1), structuredClone(q), ...round.questions.slice(qi + 1)] }) : undefined}
                onDelete={() => setRound({ ...round, questions: round.questions.filter((_, k) => k !== qi) })} />
            </div>
            <QuestionFields q={q} path={qPath} problems={problems} tunes={quiz.tunes ?? []} set={x => setQ(qi, x)} />
            {qProblems.filter(p => p.path === qPath).map((p, k) => <p key={k} className="err">{p.message}</p>)}
          </div>
        );
      })}
      {round.questions.length < 30 && (
        <button type="button" className="btn" onClick={() => { setRound({ ...round, questions: [...round.questions, convertQuestion({ kind: 'standard', q: '', a: '' }, round.kind)] }); onPreview(round.questions.length); }}>Add a question</button>
      )}
    </section>
  );
}

function QuestionFields({ q, path, problems, tunes, set }: { q: Question; path: string; problems: Problem[]; tunes: Tune[]; set: (q: Question) => void }) {
  const e = (f: string) => at(problems, `${path}.${f}`);
  const upd = (patch: Record<string, unknown>) => set({ ...q, ...patch } as Question);
  const extras = (
    <div className="row">
      <Field label="Fact after the reveal (optional)" value={'fact' in q ? q.fact : ''} max={400} multiline wide error={e('fact')} onChange={v => upd({ fact: v })} />
      <Field label="Marking note (optional)" value={'mark' in q ? q.mark : ''} max={240} error={e('mark')} hint="e.g. “Czechia” also counts. Shown to whoever marks." onChange={v => upd({ mark: v })} />
    </div>
  );
  switch (q.kind) {
    case 'standard':
      return (
        <>
          <div className="row">
            <Field label="Icon" value={q.icon} max={16} error={e('icon')} onChange={v => upd({ icon: v })} />
            <Field label="Question" value={q.q} max={300} multiline wide error={e('q')} onChange={v => upd({ q: v })} />
          </div>
          <div className="row">
            <Field label="Answer" value={q.a} max={120} wide error={e('a')} onChange={v => upd({ a: v })} />
            <Field label="Read aloud as (optional)" value={q.say} max={160} error={e('say')} hint="If the answer reads oddly, e.g. “−40°”." onChange={v => upd({ say: v })} />
          </div>
          {extras}
        </>
      );
    case 'flag': {
      const builtIn = q.flag != null;
      return (
        <>
          <div className="row">
            <label className="fld">
              <span className="lbl">Clue</span>
              <select className="inp" value={builtIn ? 'flag' : 'emoji'} onChange={ev => upd(ev.target.value === 'flag' ? { flag: FLAG_IDS[0], emoji: undefined, q: undefined } : { flag: undefined, emoji: '', q: '' })}>
                <option value="flag">A built-in flag</option>
                <option value="emoji">Emoji clues and a question</option>
              </select>
            </label>
            {builtIn ? (
              <label className="fld">
                <span className="lbl">Flag</span>
                <select className="inp" value={q.flag ?? ''} onChange={ev => upd({ flag: ev.target.value })}>
                  {FLAG_IDS.map(id => <option key={id} value={id}>{id[0].toUpperCase() + id.slice(1)}</option>)}
                </select>
                {e('flag') && <span className="err">{e('flag')}</span>}
              </label>
            ) : (
              <>
                <Field label="Emoji clues" value={q.emoji} max={60} error={e('emoji')} onChange={v => upd({ emoji: v })} placeholder="🦅 🐍 🌵" />
                <Field label="Question" value={q.q} max={300} wide error={e('q')} onChange={v => upd({ q: v })} />
              </>
            )}
            {builtIn && q.flag && <div className="flag-thumb"><Flag id={q.flag} height={60} /></div>}
          </div>
          <div className="row"><Field label="Answer (the country)" value={q.a} max={120} wide error={e('a')} onChange={v => upd({ a: v })} /></div>
          {extras}
        </>
      );
    }
    case 'music': {
      const tuneMode = q.tune != null;
      return (
        <>
          <div className="row">
            <label className="fld">
              <span className="lbl">Clue</span>
              <select className="inp" value={tuneMode ? 'tune' : 'emoji'} onChange={ev => upd(ev.target.value === 'tune' ? { tune: 0, emoji: undefined } : { tune: undefined, emoji: '' })} disabled={!tunes.length && !tuneMode}>
                <option value="emoji">Emoji clues</option>
                <option value="tune">A tune played live{tunes.length ? '' : ' (add one under Tunes first)'}</option>
              </select>
            </label>
            {tuneMode ? (
              <label className="fld">
                <span className="lbl">Tune</span>
                <select className="inp" value={q.tune ?? 0} onChange={ev => upd({ tune: +ev.target.value })}>
                  {tunes.map((t, k) => <option key={k} value={k}>Tune {k + 1} ({t.inst})</option>)}
                </select>
                {e('tune') && <span className="err">{e('tune')}</span>}
              </label>
            ) : <Field label="Emoji clues" value={q.emoji} max={60} error={e('emoji')} onChange={v => upd({ emoji: v })} placeholder="🔺 🟦 ⭕ 👉" />}
          </div>
          <div className="row">
            <Field label="Song or piece" value={q.a} max={120} wide error={e('a')} onChange={v => upd({ a: v })} />
            <Field label="Artist or composer (bonus point)" value={q.by} max={80} error={e('by')} onChange={v => upd({ by: v })} />
            <Field label="Year (optional)" value={q.year} max={12} error={e('year')} onChange={v => upd({ year: v })} />
          </div>
          <div className="row"><Field label="Hint (optional, the quizmaster can show it)" value={q.hint} max={160} wide error={e('hint')} onChange={v => upd({ hint: v })} /></div>
          {extras}
        </>
      );
    }
    case 'emoji':
      return (
        <>
          <div className="row">
            <Field label="Emoji clues" value={q.emoji} max={60} error={e('emoji')} onChange={v => upd({ emoji: v })} placeholder="🦈 🏖️ 🚤" />
            <Field label="Question (optional)" value={q.q} max={300} wide error={e('q')} onChange={v => upd({ q: v })} hint="Leave empty to use the round’s prompt." />
          </div>
          <div className="row">
            <Field label="Answer" value={q.a} max={120} wide error={e('a')} onChange={v => upd({ a: v })} />
            <Field label="Year (optional)" value={q.year} max={12} error={e('year')} onChange={v => upd({ year: v })} />
          </div>
          <div className="row"><Field label="Hint (optional)" value={q.hint} max={160} wide error={e('hint')} onChange={v => upd({ hint: v })} /></div>
          {extras}
        </>
      );
    case 'vowels':
      return (
        <>
          <div className="row">
            <Field label="Category" value={q.cat} max={40} error={e('cat')} onChange={v => upd({ cat: v })} placeholder="Animals" />
            <Field label="Answer" value={q.a} max={120} wide error={e('a')} onChange={v => upd({ a: v })} />
          </div>
          <div className="row">
            <Field label="Clue (consonants only)" value={q.clue} max={60} wide error={e('clue')} onChange={v => upd({ clue: v.toUpperCase() })} placeholder="HPPP TMS" />
            <button type="button" className="btn self-end" onClick={() => upd({ clue: vowelClue(q.a ?? '') })} disabled={!q.a}>Make the clue from the answer</button>
          </div>
          {extras}
        </>
      );
    case 'versus':
      return (
        <>
          {(['A', 'B'] as const).map(side => (
            <div key={side} className="row">
              <b className="ab">{side}</b>
              <Field label="Icon" value={q[side].icon} max={16} error={e(`${side}.icon`)} onChange={v => upd({ [side]: { ...q[side], icon: v } })} />
              <Field label="Event" value={q[side].text} max={160} wide error={e(`${side}.text`)} onChange={v => upd({ [side]: { ...q[side], text: v } })} />
              <Field label="When" value={q[side].date} max={40} error={e(`${side}.date`)} onChange={v => upd({ [side]: { ...q[side], date: v } })} placeholder="Nov 1989" />
            </div>
          ))}
          <div className="row">
            <label className="fld">
              <span className="lbl">Which came first?</span>
              <select className="inp" value={q.first} onChange={ev => upd({ first: ev.target.value })}>
                <option value="a">A</option><option value="b">B</option>
              </select>
            </label>
            <Field label="Fact after the reveal (optional)" value={q.fact} max={400} multiline wide error={e('fact')} onChange={v => upd({ fact: v })} />
          </div>
        </>
      );
  }
}

/* ---------- Tiebreakers ---------- */

export function TiebreakerEditor({ quiz, set, problems }: { quiz: Quiz; set: (q: Quiz) => void; problems: Problem[] }) {
  const list = quiz.tiebreakers ?? [];
  const setTb = (i: number, t: Tiebreaker) => set({ ...quiz, tiebreakers: list.map((x, k) => (k === i ? t : x)) });
  return (
    <section className="ed">
      <h2>Tiebreakers</h2>
      <p className="note">Only used if teams are level at the top. Each answer must be a number: the closest team wins. Up to 5.</p>
      {list.map((t, i) => {
        const e = (f: string) => at(problems, `quiz.tiebreakers[${i}].${f}`);
        return (
          <div key={i} className="card">
            <div className="row">
              <Field label="Icon" value={t.icon} max={16} error={e('icon')} onChange={v => setTb(i, { ...t, icon: v })} />
              <Field label="Question" value={t.q} max={300} wide error={e('q')} onChange={v => setTb(i, { ...t, q: v })} />
              <Field label="Answer (a number)" value={t.a} max={60} error={e('a')} onChange={v => setTb(i, { ...t, a: v })} placeholder="206" />
            </div>
            <div className="row">
              <Field label="Fact (optional)" value={t.fact} max={400} wide error={e('fact')} onChange={v => setTb(i, { ...t, fact: v })} />
              <Field label="Read aloud as (optional)" value={t.say} max={160} error={e('say')} onChange={v => setTb(i, { ...t, say: v })} />
            </div>
            <ItemTools index={i} count={list.length} what="tiebreaker" onMove={to => set({ ...quiz, tiebreakers: move(list, i, to) })} onDelete={() => set({ ...quiz, tiebreakers: list.filter((_, k) => k !== i) })} />
          </div>
        );
      })}
      {list.length < 5 && <button type="button" className="btn" onClick={() => set({ ...quiz, tiebreakers: [...list, { icon: '⚖️', q: '', a: '' }] })}>Add a tiebreaker</button>}
    </section>
  );
}

/* ---------- Tunes ---------- */

const player = new TunePlayer();

export function TuneEditor({ quiz, set, problems }: { quiz: Quiz; set: (q: Quiz) => void; problems: Problem[] }) {
  const list = quiz.tunes ?? [];
  const [playing, setPlaying] = useState(-1);
  const [msg, setMsg] = useState('');
  player.onChange = p => setPlaying(p);
  const setTune = (i: number, t: Tune) => set({ ...quiz, tunes: list.map((x, k) => (k === i ? t : x)) });
  const play = (i: number) => {
    if (playing === i) { player.stop(); return; }
    SFX.ensure();
    setMsg(player.play(list, i) ?? '');
  };
  return (
    <section className="ed">
      <h2>Tunes</h2>
      <p className="note">Melodies played live on the TV in music rounds. Write notes as <code>C4:2</code> (note, octave, length in beats); <code>F#3:1</code> for sharps, <code>Bb3:1</code> for flats, <code>R:1</code> for a rest. Up to 20 tunes; please only use music that’s out of copyright.</p>
      {msg && <p className="err">{msg}</p>}
      {list.map((t, i) => {
        const e = (f: string) => at(problems, `quiz.tunes[${i}].${f}`);
        return (
          <div key={i} className="card">
            <div className="card-head">
              <b>Tune {i + 1}</b>
              <button type="button" className="mini" onClick={() => play(i)}>{playing === i ? 'Stop' : 'Play'}</button>
              <ItemTools index={i} count={list.length} what="tune" onMove={to => set({ ...quiz, tunes: move(list, i, to) })} onDelete={() => set({ ...quiz, tunes: list.filter((_, k) => k !== i) })} />
            </div>
            <div className="row">
              <label className="fld">
                <span className="lbl">Instrument</span>
                <select className="inp" value={t.inst} onChange={ev => setTune(i, { ...t, inst: ev.target.value as Tune['inst'] })}>
                  {INSTRUMENTS.map(x => <option key={x} value={x}>{x}</option>)}
                </select>
              </label>
              <Field label="Seconds per beat" type="number" step={0.01} value={t.unit} error={e('unit')} onChange={v => setTune(i, { ...t, unit: +v })} />
              <Field label="Transpose (semitones)" type="number" value={t.transpose ?? ''} error={e('transpose')} onChange={v => setTune(i, { ...t, transpose: v === '' ? null : Math.round(+v) })} />
              <Field label="Double an octave (semitones)" type="number" value={t.double ?? ''} error={e('double')} onChange={v => setTune(i, { ...t, double: v === '' ? null : Math.round(+v) })} hint="e.g. -12 adds a lower octave" />
            </div>
            <div className="row"><Field label="Notes" value={t.notes} max={3000} multiline wide error={e('notes')} onChange={v => setTune(i, { ...t, notes: v })} placeholder="C4:2 D4:1 E4:1 R:1 G4:4" /></div>
          </div>
        );
      })}
      {list.length < 20 && <button type="button" className="btn" onClick={() => set({ ...quiz, tunes: [...list, { inst: 'piano', unit: 0.2, notes: 'C4:1 D4:1 E4:1 F4:1 G4:2 G4:2' }] })}>Add a tune</button>}
    </section>
  );
}
