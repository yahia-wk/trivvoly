// Start page: join a game with its room code, or host a quiz (built-in, from your account, or uploaded).
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ApiError, ROOM_CODE, createRoom, listQuizzes, myQuizzes, type QuizSummary, type SavedQuiz } from '../../lib/api';
import { useMe } from '../../lib/useMe';
import './landing.css';

const MAX_UPLOAD = 500 * 1024;

export default function Landing() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const missing = (params.get('missing') || '').toUpperCase();
  const [code, setCode] = useState(ROOM_CODE.test(missing) ? missing : '');
  const [joinError, setJoinError] = useState(ROOM_CODE.test(missing) ? `There’s no game with the code ${missing} right now. Check the code on the big screen.` : '');

  const [quizzes, setQuizzes] = useState<QuizSummary[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [pick, setPick] = useState<string>('');
  const [upload, setUpload] = useState<{ quiz?: unknown; name?: string; error?: string } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [hostError, setHostError] = useState('');
  const [busy, setBusy] = useState(false);
  const me = useMe();
  const [mine, setMine] = useState<SavedQuiz[]>([]);

  useEffect(() => {
    if (params.has('missing')) setParams({}, { replace: true });
    listQuizzes()
      .then(d => { setQuizzes(d.quizzes); setPick(d.quizzes[0]?.id ?? '__upload'); })
      .catch(() => setLoadError('Couldn’t load the quizzes. Refresh to try again.'));
  }, []); // once, on arrival

  useEffect(() => { if (me) myQuizzes().then(d => setMine(d.quizzes)).catch(() => {}); }, [me]);

  function join(e: FormEvent) {
    e.preventDefault();
    if (!ROOM_CODE.test(code)) { setJoinError('Room codes are 6 letters and numbers (they never use O, 0, I or 1).'); return; }
    navigate(`/r/${code}`);
  }

  async function chooseFile(file: File | undefined) {
    setPick('__upload'); setProblems([]); setUpload(null);
    if (!file) return;
    if (file.size > MAX_UPLOAD) { setUpload({ error: 'That file is too big (max 500 KB).' }); return; }
    try {
      setUpload({ quiz: JSON.parse((await file.text()).replace(/^\s+/, '')), name: file.name });
    } catch {
      setUpload({ error: 'That isn’t a valid JSON file.' });
    }
  }

  async function host() {
    setHostError(''); setProblems([]);
    if (pick === '__upload' && !upload?.quiz) { setHostError('Choose a quiz file first.'); return; }
    setBusy(true);
    try {
      const r = await createRoom(pick === '__upload' ? { quiz: upload!.quiz } : pick.startsWith('saved:') ? { savedQuizId: pick.slice(6) } : { quizId: pick });
      window.location.href = r.hostUrl; // full load, so the quizmaster screen starts fresh
    } catch (e) {
      setHostError((e as Error).message);
      if (e instanceof ApiError) setProblems(e.problems);
      setBusy(false);
    }
  }

  return (
    <div className="page-landing">
      <div className="wrap">
        <nav className="account-link" aria-label="Account">
          {me ? <Link to="/account">{me.name}: your quizzes</Link> : me === null && <Link to="/signin">Sign in</Link>}
        </nav>
        <header>
          <h1>Trivvoly</h1>
          <p className="tag">Pens down! A live trivia night for a TV and everyone’s phones: free-text answers, jokers, teams marking each other, and disputes ruled on the big screen.</p>
        </header>

        <div className="grid">
          <section className="card" aria-labelledby="join-h">
            <h2 id="join-h">Join a game</h2>
            <p className="muted">Enter the room code on the big screen, or scan its QR code.</p>
            <form onSubmit={join} autoComplete="off">
              <label className="muted" htmlFor="code">Room code</label>
              <input className="code" id="code" maxLength={6} placeholder="K7QM2X" autoCapitalize="characters" spellCheck={false} enterKeyHint="go" required
                value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} />
              <button className="btn primary block" type="submit">Join</button>
              <div className="err" role="alert">{joinError}</div>
            </form>
          </section>

          <section className="card plain" aria-labelledby="host-h">
            <h2 id="host-h">Host a quiz</h2>
            <p className="muted">Do this on the computer connected to the TV. You’ll be able to run everything from your phone afterwards.</p>
            <ul className="quizzes">
              {quizzes === null && !loadError && <li className="muted">Loading quizzes…</li>}
              {loadError && <li className="err">{loadError}</li>}
              {quizzes?.length === 0 && <li className="muted">No built-in quizzes on this server. Upload one below.</li>}
              {quizzes?.map(q => (
                <li key={q.id}>
                  <label className="quiz">
                    <input type="radio" name="quiz" value={q.id} checked={pick === q.id} onChange={() => setPick(q.id)} />
                    <span><b>{q.title}</b><span>{q.rounds} rounds · {q.questions} questions</span></span>
                  </label>
                </li>
              ))}
              {mine.map(q => (
                <li key={q.id}>
                  <label className={`quiz${q.ok ? '' : ' unready'}`}>
                    <input type="radio" name="quiz" value={q.id} disabled={!q.ok} checked={pick === `saved:${q.id}`} onChange={() => setPick(`saved:${q.id}`)} />
                    <span><b>{q.title}</b><span>Yours · {q.ok ? `${q.rounds} round${q.rounds === 1 ? '' : 's'} · ${q.questions} question${q.questions === 1 ? '' : 's'}` : 'needs a few fixes in the quiz builder'}</span></span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="upload">
              <label className="quiz" style={{ border: 0, background: 'none', padding: 0 }}>
                <input type="radio" name="quiz" value="__upload" checked={pick === '__upload'} onChange={() => setPick('__upload')} />
                <span><b>Upload your own quiz</b><span>A .json quiz file, e.g. one from the quiz builder.</span></span>
              </label>
              <input type="file" accept=".json,application/json" aria-label="Quiz file" onChange={e => chooseFile(e.target.files?.[0])} />
              {upload?.error && <p className="err">{upload.error}</p>}
              {upload?.name && !problems.length && <p className="ok">Ready to check: {upload.name}</p>}
              {problems.length > 0 && <><p className="err">This quiz needs a few fixes:</p><ul className="problems">{problems.map(p => <li key={p}>{p}</li>)}</ul></>}
            </div>
            <button className="btn primary block" type="button" onClick={host} disabled={busy}>{busy ? 'Starting…' : 'Start a game'}</button>
            <p className="muted" style={{ marginTop: 12, textAlign: 'center' }}>Want your own questions? <Link to="/build" style={{ color: 'var(--gold)' }}>Write a quiz in the quiz builder</Link></p>
            <div className="err" role="alert">{hostError}</div>
          </section>
        </div>

        <section className="card plain" style={{ marginTop: 18 }} aria-labelledby="how-h">
          <h2 id="how-h">How it works</h2>
          <div className="steps">
            <div className="step"><b>1. Put it on the TV</b>Start a game on the TV computer. The big screen shows the questions, the timer and a QR code.</div>
            <div className="step"><b>2. Teams join</b>One phone per team scans the code and picks a team name. Answers are typed on the phone.</div>
            <div className="step"><b>3. Pens down</b>Teams mark each other’s answers. Disagree? Dispute it, and the quizmaster rules on the big screen.</div>
          </div>
        </section>

        <footer>Trivvoly is free and open source. <a href="https://github.com/yahia-wk/trivvoly" rel="noopener">Code on GitHub</a></footer>
      </div>
    </div>
  );
}
