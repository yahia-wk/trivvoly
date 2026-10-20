// The quiz builder: write a quiz in the browser, checked live by the server's own rules,
// previewed as the TV draws it. Then download it or start a game with it straight away.
// At /build the draft lives in this browser; at /build/:id it's a quiz in your account, saved as you type.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError, checkQuiz, createRoom, createSavedQuiz, getSavedQuiz, listQuizzes, loadBuiltInQuiz, updateSavedQuiz, type QuizSummary } from '../../lib/api';
import { useMe } from '../../lib/useMe';
import type { Quiz, Slide } from '../../lib/types';
import { blankQuiz, blankRound, kindLabel, parseProblems, tagKinds, toFile, under, type Problem } from './draft';
import { DetailsEditor, move, ProblemList, RoundEditor, TiebreakerEditor, TuneEditor } from './Editors';
import { TvPreview } from './Preview';
import './build.css';

const DRAFT_KEY = 'trivvoly-draft';
type Selection = { section: 'details' } | { section: 'round'; round: number } | { section: 'tiebreakers' } | { section: 'tunes' };

type SaveState = 'saved' | 'pending' | 'saving' | 'failed';
const SAVE_LABEL: Record<SaveState, string> = { saved: 'Saved in your account', pending: 'Saving…', saving: 'Saving…', failed: 'Couldn’t save: check your connection' };

/** A quiz file or saved draft may be half-finished; make sure the builder can at least open it. */
function openable(raw: unknown): Quiz | null {
  try {
    const quiz = tagKinds(raw);
    return Array.isArray(quiz.rounds) && quiz.rounds.length > 0 && quiz.rounds.every(r => r && Array.isArray(r.questions)) ? quiz : null;
  } catch { return null; }
}

function loadDraft(): { quiz: Quiz; restored: boolean } {
  try {
    const saved = localStorage.getItem(DRAFT_KEY);
    const quiz = saved ? openable(JSON.parse(saved)) : null;
    if (quiz) return { quiz, restored: true };
  } catch { /* nothing saved, or storage is off */ }
  return { quiz: blankQuiz(), restored: false };
}

export default function Build() {
  const { id } = useParams();
  const [saved, setSaved] = useState<{ id: string; quiz: Quiz } | null>(null);
  const [error, setError] = useState<{ text: string; signIn: boolean } | null>(null);
  useEffect(() => {
    if (!id) return;
    setSaved(null); setError(null);
    getSavedQuiz(id)
      .then(r => { const quiz = openable(r.quiz); if (quiz) setSaved({ id, quiz }); else setError({ text: 'This saved quiz is too damaged to open in the builder.', signIn: false }); })
      .catch((e: Error) => setError(e instanceof ApiError && e.status === 401
        ? { text: 'Sign in to open the quizzes in your account.', signIn: true } : { text: e.message, signIn: false }));
  }, [id]);
  if (!id) return <Editor key="draft" {...loadDraft()} />;
  if (saved) return <Editor key={saved.id} quiz={saved.quiz} restored={false} savedId={saved.id} />;
  return (
    <div className="page-build">
      <div className="loading">
        {!error ? <p>Loading your quiz…</p> : <>
          <p className="err">{error.text}</p>
          <p>{error.signIn ? <Link to={`/signin?next=/build/${id}`}>Sign in</Link> : <Link to="/account">Back to your quizzes</Link>}</p>
        </>}
      </div>
    </div>
  );
}

function Editor({ quiz: initialQuiz, restored, savedId }: { quiz: Quiz; restored: boolean; savedId?: string }) {
  const navigate = useNavigate();
  const me = useMe();
  const [quiz, setQuiz] = useState<Quiz>(initialQuiz);
  const [note, setNote] = useState(restored ? 'Welcome back: your last draft was restored from this browser.' : '');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const loaded = useRef(initialQuiz);
  const [sel, setSel] = useState<Selection>({ section: 'details' });
  const [preview, setPreview] = useState<{ r: number; q: number; answer: boolean }>({ r: 0, q: 0, answer: false });
  const [problems, setProblems] = useState<Problem[]>([]);
  const [summary, setSummary] = useState<{ rounds: number; questions: number } | null>(null);
  const [checking, setChecking] = useState(true);
  const [checkFailed, setCheckFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [builtIns, setBuiltIns] = useState<QuizSummary[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => { listQuizzes().then(d => setBuiltIns(d.quizzes)).catch(() => {}); }, []);

  // Save the draft in this browser, and check it with the server, shortly after each change
  useEffect(() => {
    setChecking(true);
    const t = window.setTimeout(() => {
      const file = toFile(quiz);
      if (!savedId) try { localStorage.setItem(DRAFT_KEY, JSON.stringify(file)); } catch { /* storage full or off */ }
      checkQuiz(file)
        .then(r => { setProblems(parseProblems(r.problems)); setSummary(r.summary ?? null); setCheckFailed(false); })
        .catch(() => setCheckFailed(true))
        .finally(() => setChecking(false));
    }, 500);
    return () => window.clearTimeout(t);
  }, [quiz, savedId]);

  // A quiz in your account saves itself shortly after each change
  useEffect(() => {
    if (!savedId || quiz === loaded.current) return;
    setSaveState('pending');
    const t = window.setTimeout(() => {
      setSaveState('saving');
      updateSavedQuiz(savedId, toFile(quiz)).then(() => setSaveState('saved')).catch(() => setSaveState('failed'));
    }, 800);
    return () => window.clearTimeout(t);
  }, [quiz, savedId]);
  useEffect(() => { // don't let the page close with changes not yet saved
    if (saveState === 'saved') return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saveState]);

  async function saveToAccount() {
    setBusy(true);
    try {
      const row = await createSavedQuiz(toFile(quiz));
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* storage off */ }
      navigate(`/build/${row.id}`, { replace: true });
    } catch (e) { setNote((e as Error).message); setBusy(false); }
  }

  const hasContent = quiz.rounds.some(r => r.questions.some(q => ('a' in q && q.a) || ('q' in q && q.q)));
  const replace = (next: Quiz, message: string) => {
    if (hasContent && !window.confirm('Replace the quiz you’re working on? Download it first if you want to keep it.')) return;
    setQuiz(next); setSel({ section: 'details' }); setPreview({ r: 0, q: 0, answer: false }); setNote(message);
  };

  async function openFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 500 * 1024) { setNote('That file is too big (max 500 KB).'); return; }
    let opened: Quiz | null = null;
    try { opened = openable(JSON.parse((await file.text()).replace(/^\s+/, ''))); } catch { /* not JSON */ }
    if (opened) replace(opened, `Opened ${file.name}.`); else setNote('That isn’t a valid quiz file.');
  }

  async function startFrom(id: string) {
    if (!id) return;
    try { replace(tagKinds(await loadBuiltInQuiz(id)), 'Loaded a copy of a built-in quiz. Change anything you like.'); }
    catch (e) { setNote((e as Error).message); }
  }

  function download() {
    const name = (quiz.title || 'quiz').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'quiz';
    const url = URL.createObjectURL(new Blob([JSON.stringify(toFile(quiz), null, 2) + '\n'], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `${name}.json`; document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function play() {
    setBusy(true);
    try { window.location.href = (await createRoom({ quiz: toFile(quiz) })).hostUrl; }
    catch (e) { setNote((e as Error).message); setBusy(false); }
  }

  /* ---------- Rounds ---------- */
  const addRound = () => {
    if (quiz.rounds.length >= 12) return;
    setQuiz({ ...quiz, rounds: [...quiz.rounds, blankRound('standard', quiz.rounds.length + 1)] });
    setSel({ section: 'round', round: quiz.rounds.length });
    setPreview({ r: quiz.rounds.length, q: 0, answer: false });
  };
  const deleteRound = (i: number) => {
    const rounds = quiz.rounds.filter((_, k) => k !== i);
    const ha = quiz.halftimeAfter ?? -1;
    setQuiz({ ...quiz, rounds, halftimeAfter: ha >= rounds.length - 1 ? -1 : ha > i ? ha - 1 : ha });
    setSel({ section: 'details' }); setPreview({ r: 0, q: 0, answer: false });
  };
  const moveRound = (i: number, to: number) => {
    setQuiz({ ...quiz, rounds: move(quiz.rounds, i, to) });
    setSel({ section: 'round', round: to }); setPreview(p => ({ ...p, r: to }));
  };

  /* ---------- Preview ---------- */
  const r = Math.min(preview.r, quiz.rounds.length - 1), round = quiz.rounds[r];
  const q = Math.min(preview.q, Math.max(0, round.questions.length - 1));
  const slide: Slide = sel.section === 'details' ? { type: 'title' } : { type: preview.answer ? 'answer' : 'question', r, q };

  const status = checking ? <span className="st">Checking…</span>
    : checkFailed ? <span className="st bad">Couldn’t reach the server to check this quiz</span>
    : problems.length ? <span className="st bad">{problems.length} thing{problems.length === 1 ? '' : 's'} to fix</span>
    : <span className="st ok">Ready to play{summary ? `: ${summary.rounds} round${summary.rounds === 1 ? '' : 's'}, ${summary.questions} question${summary.questions === 1 ? '' : 's'}` : ''}</span>;

  const count = (path: string) => under(problems, path).length;
  const outline: { label: string; sel: Selection; path: string; sub?: string }[] = [
    { label: 'Quiz details and rules', sel: { section: 'details' }, path: 'quiz.title' },
    ...quiz.rounds.map((rd, k) => ({ label: `${k + 1}. ${rd.title || 'Untitled round'}`, sub: `${kindLabel(rd.kind)} · ${rd.questions.length} q`, sel: { section: 'round', round: k } as Selection, path: `quiz.rounds[${k}]` })),
    { label: 'Tiebreakers', sel: { section: 'tiebreakers' }, path: 'quiz.tiebreakers', sub: String((quiz.tiebreakers ?? []).length) },
    { label: 'Tunes', sel: { section: 'tunes' }, path: 'quiz.tunes', sub: String((quiz.tunes ?? []).length) }
  ];
  const isSel = (s: Selection) => s.section === sel.section && (s.section !== 'round' || (sel.section === 'round' && sel.round === s.round));
  const detailsProblems = problems.filter(p => !p.path.startsWith('quiz.rounds') && !p.path.startsWith('quiz.tiebreakers') && !p.path.startsWith('quiz.tunes')).length;

  return (
    <div className="page-build">
      <header className="bar">
        <Link to="/" className="brand">Trivvoly</Link>
        <span className="crumb">Quiz builder</span>
        {status}
        {savedId && <span className={`st${saveState === 'failed' ? ' bad' : ''}`} role="status">{SAVE_LABEL[saveState]}</span>}
        <div className="actions">
          {savedId ? <Link className="btn" to="/account">Your quizzes</Link> : <>
            <button type="button" className="btn" onClick={() => replace(blankQuiz(), 'Started a new quiz.')}>New</button>
            <button type="button" className="btn" onClick={() => fileInput.current?.click()}>Open file</button>
            <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={e => { openFile(e.target.files?.[0]); e.target.value = ''; }} />
            {builtIns.length > 0 && (
              <select className="btn" value="" onChange={e => startFrom(e.target.value)} aria-label="Start from a built-in quiz">
                <option value="">Copy a built-in quiz…</option>
                {builtIns.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
              </select>
            )}
            {me ? <button type="button" className="btn" onClick={saveToAccount} disabled={busy}>Save to my quizzes</button>
              : me === null && <Link className="btn" to="/signin?next=/build">Sign in to save</Link>}
          </>}
          <button type="button" className="btn" onClick={download}>Download</button>
          <button type="button" className="btn primary" disabled={busy || checking || checkFailed || problems.length > 0} onClick={play} title={problems.length ? 'Fix the problems first' : 'Open this quiz on the TV'}>Start a game</button>
        </div>
      </header>
      {note && <div className="note-bar" role="status">{note}<button type="button" className="mini" onClick={() => setNote('')} aria-label="Dismiss">×</button></div>}

      <div className="layout">
        <nav className="outline-nav" aria-label="Quiz outline">
          {outline.map(o => {
            const n = o.sel.section === 'details' ? detailsProblems : count(o.path);
            return (
              <button key={o.label} type="button" className={`ol${isSel(o.sel) ? ' on' : ''}`}
                onClick={() => { setSel(o.sel); if (o.sel.section === 'round') setPreview({ r: o.sel.round, q: 0, answer: false }); }}>
                <span className="ol-label">{o.label}</span>
                {o.sub && <span className="ol-sub">{o.sub}</span>}
                {n > 0 && <span className="ol-bad">{n}</span>}
              </button>
            );
          })}
          {quiz.rounds.length < 12 && <button type="button" className="btn add" onClick={addRound}>Add a round</button>}
        </nav>

        <main className="editor">
          {sel.section === 'details' && <DetailsEditor quiz={quiz} set={setQuiz} problems={problems} />}
          {sel.section === 'round' && quiz.rounds[sel.round] && (
            <>
              <div className="round-tools">
                <button type="button" className="mini" disabled={sel.round === 0} onClick={() => moveRound(sel.round, sel.round - 1)}>Move round earlier</button>
                <button type="button" className="mini" disabled={sel.round === quiz.rounds.length - 1} onClick={() => moveRound(sel.round, sel.round + 1)}>Move round later</button>
                <button type="button" className="mini danger" disabled={quiz.rounds.length <= 1} onClick={() => { if (window.confirm('Delete this round and its questions?')) deleteRound(sel.round); }}>Delete round</button>
              </div>
              <RoundEditor quiz={quiz} index={sel.round} set={setQuiz} problems={problems}
                previewing={preview.r === sel.round ? preview.q : null} onPreview={qi => setPreview({ r: sel.round, q: qi, answer: preview.answer })} />
            </>
          )}
          {sel.section === 'tiebreakers' && <TiebreakerEditor quiz={quiz} set={setQuiz} problems={problems} />}
          {sel.section === 'tunes' && <TuneEditor quiz={quiz} set={setQuiz} problems={problems} />}
        </main>

        <aside className="side">
          <div className="side-head">
            <b>On the TV</b>
            {sel.section !== 'details' && (
              <div className="toggle" role="group" aria-label="Preview">
                <button type="button" className={!preview.answer ? 'on' : ''} onClick={() => setPreview(p => ({ ...p, answer: false }))}>Question</button>
                <button type="button" className={preview.answer ? 'on' : ''} onClick={() => setPreview(p => ({ ...p, answer: true }))}>Answer</button>
              </div>
            )}
          </div>
          <TvPreview quiz={quiz} slide={slide} revealed={preview.answer} />
          <p className="side-note">{sel.section === 'details' ? 'The title slide. Pick a round to preview its questions.' : `Round ${r + 1}, question ${q + 1}. Click “Preview” on any question.`}</p>
          {problems.length > 0 && <><h3>To fix before playing</h3><ProblemList problems={problems} /></>}
        </aside>
      </div>
    </div>
  );
}
