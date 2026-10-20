// Your account: your quizzes (edit, play, delete, add), your name, signing out, deleting it all.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { createRoom, createSavedQuiz, deleteMe, deleteSavedQuiz, myQuizzes, renameMe, signOut, type SavedQuiz } from '../../lib/api';
import { setMe, useMe } from '../../lib/useMe';
import { blankQuiz, toFile } from '../build/draft';
import '../landing/landing.css';
import './account.css';

const when = (t: number) => new Date(t * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export default function Account() {
  const navigate = useNavigate();
  const me = useMe();
  const [quizzes, setQuizzes] = useState<SavedQuiz[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const leaving = useRef(false); // signing out or deleting: go home, not to the sign-in page

  useEffect(() => {
    if (me === null && !leaving.current) navigate('/signin?next=/account', { replace: true });
    if (me) { setName(me.name); myQuizzes().then(d => setQuizzes(d.quizzes)).catch((e: Error) => setError(e.message)); }
  }, [me, navigate]);

  async function act(label: string, fn: () => Promise<void>) {
    setBusy(label); setError('');
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }

  const newQuiz = () => act('new', async () => navigate(`/build/${(await createSavedQuiz(toFile(blankQuiz()))).id}`));
  const play = (q: SavedQuiz) => act(q.id, async () => { window.location.href = (await createRoom({ savedQuizId: q.id })).hostUrl; });
  const remove = (q: SavedQuiz) => {
    if (!window.confirm(`Delete “${q.title}”? This can’t be undone.`)) return;
    act(q.id, async () => { await deleteSavedQuiz(q.id); setQuizzes(list => list!.filter(x => x.id !== q.id)); });
  };
  async function importFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 500 * 1024) { setError('That file is too big (max 500 KB).'); return; }
    let quiz: unknown;
    try { quiz = JSON.parse((await file.text()).replace(/^\s+/, '')); } catch { setError('That isn’t a valid quiz file.'); return; }
    act('import', async () => navigate(`/build/${(await createSavedQuiz(quiz)).id}`));
  }
  function rename(e: FormEvent) {
    e.preventDefault();
    act('rename', async () => { setMe((await renameMe(name)).user); setRenaming(false); });
  }
  const leave = (everywhere: boolean) => act('signout', async () => { await signOut(everywhere); leaving.current = true; setMe(null); navigate('/'); });
  function destroy() {
    if (!window.confirm('Delete your account and every quiz in it? This can’t be undone.')) return;
    act('delete', async () => { await deleteMe(); leaving.current = true; setMe(null); navigate('/'); });
  }

  if (!me) return <div className="page-landing page-account" />;
  return (
    <div className="page-landing page-account">
      <div className="wrap">
        <header className="mini-head">
          <Link to="/" className="home">Trivvoly</Link>
          <span className="who">{me.name}</span>
        </header>

        <section className="card plain" aria-labelledby="quizzes-h">
          <div className="head-row">
            <h2 id="quizzes-h">Your quizzes</h2>
            <div className="actions">
              <button type="button" className="btn small" onClick={() => fileInput.current?.click()} disabled={!!busy}>Import a file</button>
              <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={e => { importFile(e.target.files?.[0]); e.target.value = ''; }} />
              <button type="button" className="btn small primary" onClick={newQuiz} disabled={!!busy}>{busy === 'new' ? 'Creating…' : 'New quiz'}</button>
            </div>
          </div>
          {quizzes === null && !error && <p className="muted">Loading…</p>}
          {quizzes?.length === 0 && <p className="muted">Nothing here yet. Start a new quiz, import a .json quiz file, or copy a built-in quiz in the quiz builder and save it.</p>}
          <ul className="saved">
            {quizzes?.map(q => (
              <li key={q.id}>
                <div className="info">
                  <b>{q.title}</b>
                  <span>{q.rounds} round{q.rounds === 1 ? '' : 's'} · {q.questions} question{q.questions === 1 ? '' : 's'} · changed {when(q.updatedAt)}</span>
                  {!q.ok && <span className="needs">Needs a few fixes before it can be played</span>}
                </div>
                <div className="actions">
                  <Link className="btn small" to={`/build/${q.id}`}>Edit</Link>
                  <button type="button" className="btn small primary" disabled={!q.ok || !!busy} onClick={() => play(q)}>{busy === q.id ? 'Starting…' : 'Play'}</button>
                  <button type="button" className="btn small danger" disabled={!!busy} onClick={() => remove(q)} aria-label={`Delete ${q.title}`}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
          <div className="err" role="alert">{error}</div>
        </section>

        <section className="card plain" style={{ marginTop: 18 }} aria-labelledby="me-h">
          <h2 id="me-h">Your account</h2>
          {renaming ? (
            <form onSubmit={rename} className="inline">
              <label className="muted" htmlFor="name">Your name</label>
              <input className="text" id="name" maxLength={40} required value={name} onChange={e => setName(e.target.value)} autoFocus />
              <button className="btn small primary" type="submit" disabled={!!busy}>Save</button>
              <button className="btn small" type="button" onClick={() => { setRenaming(false); setName(me.name); }}>Cancel</button>
            </form>
          ) : (
            <p><b>{me.name}</b> <button type="button" className="linkish" onClick={() => setRenaming(true)}>Change name</button></p>
          )}
          <p className="muted">{me.email} · signs in with {me.google ? 'Google or an email link' : 'an email link'}</p>
          <div className="actions wrap-row">
            <button type="button" className="btn small" onClick={() => leave(false)} disabled={!!busy}>Sign out</button>
            <button type="button" className="btn small" onClick={() => leave(true)} disabled={!!busy}>Sign out on every device</button>
            <button type="button" className="btn small danger" onClick={destroy} disabled={!!busy}>Delete my account</button>
          </div>
        </section>
      </div>
    </div>
  );
}
