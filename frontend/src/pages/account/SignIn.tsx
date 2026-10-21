// Sign in: with Google, or with a link sent by email. Accounts are only for keeping quizzes;
// nobody needs one to play or host.
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { authOptions, emailLink, googleSignInUrl } from '../../lib/api';
import { useMe } from '../../lib/useMe';
import '../landing/landing.css';
import './account.css';

const NEXT = /^\/(?![/\\])[A-Za-z0-9/_\-?=&.%]{0,199}$/; // the server checks this too

export default function SignIn() {
  const [params] = useSearchParams();
  const next = NEXT.test(params.get('next') || '') ? params.get('next')! : '/account';
  const me = useMe();
  const again = params.has('again'); // asked to sign in again (e.g. for the admin area) while signed in
  const [options, setOptions] = useState<{ google: boolean; email: boolean } | null>(null);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState('');
  const [error, setError] = useState(({
    google: 'Signing in with Google didn’t work out. Try again, or use your email instead.',
    banned: 'This account can’t sign in.',
    paused: 'New accounts are paused for now. Please try again later.'
  } as Record<string, string>)[params.get('error') || ''] || '');
  const [busy, setBusy] = useState(false);

  useEffect(() => { authOptions().then(setOptions).catch(() => setError('Can’t reach Trivvoly. Check your connection.')); }, []);

  async function sendLink(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try { await emailLink(email.trim(), next); setSent(email.trim()); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="page-landing page-account">
      <div className="wrap narrow">
        <header className="mini-head"><Link to="/" className="home">Trivvoly</Link></header>
        <section className="card plain" aria-labelledby="signin-h">
          <h2 id="signin-h">Sign in</h2>
          {me && !again ? (
            <>
              <p>You’re signed in as <b>{me.name}</b> ({me.email}).</p>
              <Link className="btn primary block" to={next}>Carry on</Link>
            </>
          ) : sent ? (
            <div role="status">
              <p className="big">📬 Check your inbox</p>
              <p>We’ve sent a sign-in link to <b>{sent}</b>. It works once, for 15 minutes. Open it on this device.</p>
              <p className="muted">Nothing there? Check your spam folder, or <button type="button" className="linkish" onClick={() => setSent('')}>try again</button>.</p>
            </div>
          ) : (
            <>
              <p className="muted">{again ? 'For safety, please sign in again to carry on.' : 'Sign in to keep your quizzes in your account and use them from any computer. You don’t need an account to play or host.'}</p>
              {options === null && !error && <p className="muted">Loading…</p>}
              {options?.google && <a className="btn block google" href={googleSignInUrl(next)}><span aria-hidden="true" className="g">G</span>Continue with Google</a>}
              {options?.google && options.email && <div className="or"><span>or</span></div>}
              {options?.email && (
                <form onSubmit={sendLink}>
                  <label className="muted" htmlFor="email">Email address</label>
                  <input className="text" id="email" type="email" autoComplete="email" required maxLength={254} placeholder="you@example.com"
                    value={email} onChange={e => setEmail(e.target.value)} />
                  <button className="btn primary block" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Email me a sign-in link'}</button>
                </form>
              )}
              {options && !options.google && !options.email && <p>Signing in isn’t set up on this server yet.</p>}
            </>
          )}
          <div className="err" role="alert">{error}</div>
        </section>
        <p className="fine">We keep your email address and name to run your account, and nothing else about you. You can delete your account, and everything in it, at any time. <Link to="/privacy" style={{ color: 'var(--gold)' }}>Privacy</Link></p>
      </div>
    </div>
  );
}
