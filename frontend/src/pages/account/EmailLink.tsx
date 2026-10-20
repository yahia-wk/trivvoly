// The page an emailed sign-in link opens. The token is in the #fragment (never sent to servers
// or logged); we post it, which uses it up, so a mail scanner opening the link can't.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { verifyEmailLink } from '../../lib/api';
import { setMe } from '../../lib/useMe';
import '../landing/landing.css';
import './account.css';

export default function EmailLink() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // once, even in React's development double-run
    started.current = true;
    const token = new URLSearchParams(window.location.hash.slice(1)).get('t') || '';
    history.replaceState(null, '', window.location.pathname); // don't leave the token in history
    if (!token) { setError('This sign-in link is missing its code. Ask for a new one.'); return; }
    verifyEmailLink(token)
      .then(r => { setMe(r.user); navigate(r.next, { replace: true }); })
      .catch((e: Error) => setError(e.message));
  }, [navigate]);

  return (
    <div className="page-landing page-account">
      <div className="wrap narrow">
        <header className="mini-head"><Link to="/" className="home">Trivvoly</Link></header>
        <section className="card plain">
          <h2>Signing you in</h2>
          {error ? (
            <>
              <p className="err" role="alert">{error}</p>
              <Link className="btn primary block" to="/signin">Get a new link</Link>
            </>
          ) : <p className="muted" role="status">One moment…</p>}
        </section>
      </div>
    </div>
  );
}
