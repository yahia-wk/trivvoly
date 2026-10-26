// The admin area: what's happening now, and the tools to step in. Only admins get past the first request.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import * as A from '../../lib/admin';
import { useMe } from '../../lib/useMe';
import '../landing/landing.css';
import '../account/account.css';
import './admin.css';

type Tab = 'overview' | 'games' | 'accounts' | 'log';
const ago = (t: number) => {
  const s = Math.max(0, Date.now() / 1000 - t);
  return s < 90 ? `${Math.round(s)}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 172800 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`;
};
const date = (t: number) => new Date(t * 1000).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const uptime = (s: number) => s < 3600 ? `${Math.round(s / 60)} min` : s < 172800 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} days`;

const SIGN_IN_AGAIN = '/signin?next=/admin&again=1';

/** Admin access lasts a few hours from signing in; after that, the server asks for a fresh sign-in. */
function SignInAgain() {
  return (
    <section className="card plain">
      <h2>Please sign in again</h2>
      <p className="muted">For safety, the admin area only works for a few hours after you sign in. Your other sign-in carries on as normal.</p>
      <Link className="btn primary block" to={SIGN_IN_AGAIN}>Sign in again</Link>
    </section>
  );
}

/** Re-run `load` every few seconds while the tab is visible. An expired admin sign-in shows "sign in again". */
function usePoll<T>(load: () => Promise<T>, ms: number): [T | null, string, () => void] {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const refresh = useCallback(() => {
    load().then(d => { setData(d); setError(''); })
      .catch((e: Error & { status?: number }) => { if (e.status === 401) setData(null); setError(e.status === 401 ? 'reauth' : e.message); });
  }, [load]);
  useEffect(() => {
    refresh();
    const t = window.setInterval(() => { if (!document.hidden) refresh(); }, ms);
    return () => window.clearInterval(t);
  }, [refresh, ms]);
  return [data, error, refresh];
}

export default function Admin() {
  const me = useMe();
  const [tab, setTab] = useState<Tab>('overview');
  if (me === undefined) return <div className="page-landing page-account" />;
  if (!me?.admin) {
    return (
      <div className="page-landing page-account"><div className="wrap narrow">
        <header className="mini-head"><Link to="/" className="home">Trivvoly</Link></header>
        <section className="card plain"><h2>Not found</h2><p className="muted">There’s nothing here.</p><Link className="btn primary block" to="/">Go to the start page</Link></section>
      </div></div>
    );
  }
  const expired = (me.adminUntil ?? 0) * 1000 < Date.now();
  const until = new Date((me.adminUntil ?? 0) * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="page-landing page-account page-admin">
      <div className="wrap">
        <header className="mini-head">
          <Link to="/" className="home">Trivvoly</Link>
          <span className="who">Admin · {me.email}{!expired && <span className="until"> · until {until}</span>}</span>
        </header>
        {expired ? <SignInAgain /> : <>
        <nav className="tabs" aria-label="Admin sections">
          {(['overview', 'games', 'accounts', 'log'] as Tab[]).map(t => (
            <button key={t} type="button" className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {{ overview: 'Overview', games: 'Live games', accounts: 'Accounts', log: 'Admin log' }[t]}
            </button>
          ))}
        </nav>
        {tab === 'overview' && <OverviewTab />}
        {tab === 'games' && <GamesTab />}
        {tab === 'accounts' && <AccountsTab />}
        {tab === 'log' && <LogTab />}
        </>}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, bad }: { label: string; value: number | string; sub?: string; bad?: boolean }) {
  return <div className={`stat${bad ? ' bad' : ''}`}><span className="v">{value}</span><span className="l">{label}</span>{sub && <span className="s">{sub}</span>}</div>;
}

function OverviewTab() {
  const [o, error, refresh] = usePoll(A.overview, 5000);
  if (error === 'reauth') return <SignInAgain />;
  if (!o) return <p className="muted">{error || 'Loading…'}</p>;
  return (
    <>
      <div className="stats">
        <Stat label="games running" value={o.games.live} sub={`of ${o.games.max} max · ${o.games.teams} teams · ${o.games.screens} screens`} />
        <Stat label="games since restart" value={o.games.startedSinceBoot} sub={`up ${uptime(o.uptimeSeconds)} · version ${o.version.slice(0, 7)}`} />
        <Stat label="accounts" value={o.accounts.users} sub={`${o.accounts.newUsers7d} new, ${o.accounts.activeUsers7d} active this week`} />
        <Stat label="saved quizzes" value={o.accounts.savedQuizzes} sub={`${o.accounts.banned} banned addresses`} />
        <Stat label="sign-ins since restart" value={o.signInsSinceBoot.ok} sub={`${o.signInsSinceBoot.failed} failed`} />
        <Stat label="errors since restart" value={o.errorsSinceBoot} sub={`${o.rateLimitedSinceBoot} requests slowed down`} bad={o.errorsSinceBoot > 0} />
      </div>
      <SwitchesCard switches={o.switches} onChange={refresh} />
      <section className="card plain">
        <h2>Sign-in</h2>
        <p className="muted">Google: {o.signIn.google ? 'on' : 'off (set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)'} · Email links: {o.signIn.email ? (o.signIn.email === 'console' ? 'printed in the server terminal (local only)' : `sent by ${o.signIn.email}`) : 'off (see docs/HOSTING.md)'}</p>
      </section>
      <section className="card plain">
        <h2>Recent problems</h2>
        {o.problems.length === 0 ? <p className="muted">None since the server started. 🎉</p> : (
          <ul className="problems-list">
            {o.problems.map((p, i) => (
              <li key={i} className={p.level}>
                <span className="when">{ago(p.time)}</span><b>{p.level}</b> {p.msg}
                {p.error && <code>{p.error}</code>}
                {p.requestId && <span className="rid">request {p.requestId}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function SwitchesCard({ switches, onChange }: { switches: A.Switches; onChange: () => void }) {
  const [notice, setNotice] = useState(switches.notice);
  const [error, setError] = useState('');
  const save = (s: Partial<A.Switches>) => A.setSwitches(s).then(onChange).catch((e: Error) => setError(e.message));
  const flip = (key: 'pauseNewGames' | 'pauseSignUps', on: boolean, ask: string) => { if (window.confirm(ask)) save({ [key]: on }); };
  return (
    <section className="card plain">
      <h2>Switches</h2>
      <div className="switch-row">
        <div><b>New games</b><span className="muted">{switches.pauseNewGames ? 'Paused: nobody can start a game. Running games carry on.' : 'Anyone can start a game.'}</span></div>
        <button type="button" className={`btn small${switches.pauseNewGames ? ' primary' : ' danger'}`}
          onClick={() => flip('pauseNewGames', !switches.pauseNewGames, switches.pauseNewGames ? 'Let people start games again?' : 'Pause new games? Running games carry on.')}>
          {switches.pauseNewGames ? 'Resume' : 'Pause'}
        </button>
      </div>
      <div className="switch-row">
        <div><b>New accounts</b><span className="muted">{switches.pauseSignUps ? 'Paused: existing accounts can still sign in.' : 'Anyone can make an account.'}</span></div>
        <button type="button" className={`btn small${switches.pauseSignUps ? ' primary' : ' danger'}`}
          onClick={() => flip('pauseSignUps', !switches.pauseSignUps, switches.pauseSignUps ? 'Let new people sign up again?' : 'Pause new sign-ups?')}>
          {switches.pauseSignUps ? 'Resume' : 'Pause'}
        </button>
      </div>
      <form className="inline" onSubmit={(e: FormEvent) => { e.preventDefault(); save({ notice }); }}>
        <label className="muted" htmlFor="notice">Notice on the start page (empty for none)</label>
        <input className="text" id="notice" maxLength={200} value={notice} onChange={e => setNotice(e.target.value)} placeholder="e.g. Trivvoly will restart for an update at 9pm" />
        <button className="btn small primary" type="submit" disabled={notice === switches.notice}>Save notice</button>
      </form>
      <div className="err" role="alert">{error}</div>
    </section>
  );
}

function GamesTab() {
  const [data, error, refresh] = usePoll(A.rooms, 5000);
  const [busy, setBusy] = useState('');
  const act = (key: string, ask: string, fn: () => Promise<unknown>) => {
    if (!window.confirm(ask)) return;
    setBusy(key);
    fn().catch((e: Error) => window.alert(e.message)).finally(() => { setBusy(''); refresh(); });
  };
  if (error === 'reauth') return <SignInAgain />;
  if (!data) return <p className="muted">{error || 'Loading…'}</p>;
  if (!data.rooms.length) return <section className="card plain"><p className="muted">No games running right now.</p></section>;
  return (
    <div className="room-list">
      {data.rooms.map(r => (
        <section key={r.code} className="card plain room">
          <div className="head-row">
            <div>
              <h2 className="room-code">{r.code}</h2>
              <span className="muted">{r.quiz}{r.builtIn ? ' (built-in)' : ''} · slide {r.slide}/{r.slides} · started {r.ageMinutes} min ago · last action {ago(r.lastActive)} · from {r.ip}</span>
            </div>
            <button type="button" className="btn small danger" disabled={busy === r.code}
              onClick={() => act(r.code, `End game ${r.code} for everyone in it?`, () => A.endRoom(r.code))}>End game</button>
          </div>
          <p className="muted">TV {r.screens.tv ? 'on' : 'off'} · {r.screens.remotes} remote{r.screens.remotes === 1 ? '' : 's'} · {r.screens.phones} phone{r.screens.phones === 1 ? '' : 's'}</p>
          {r.teams.length > 0 && (
            <ul className="team-list">
              {r.teams.map(t => (
                <li key={t.id}>
                  <span className={`dot${t.online ? ' on' : ''}`} aria-label={t.online ? 'online' : 'offline'} />{t.name}
                  <button type="button" className="linkish" disabled={busy === t.id}
                    onClick={() => act(t.id, `Remove the team “${t.name}” from game ${r.code}?`, () => A.removeTeam(r.code, t.id))}>remove</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function AccountsTab() {
  const [q, setQ] = useState('');
  const [list, setList] = useState<A.AdminUser[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [quizzes, setQuizzes] = useState<A.AdminQuiz[]>([]);
  const [error, setError] = useState('');
  const search = useCallback((query: string) => A.users(query).then(d => setList(d.users)).catch((e: Error & { status?: number }) => setError(e.status === 401 ? 'reauth' : e.message)), []);
  useEffect(() => { search(''); }, [search]);
  const show = (id: string) => { setOpen(open === id ? null : id); setQuizzes([]); if (open !== id) A.userQuizzes(id).then(d => setQuizzes(d.quizzes)).catch(() => {}); };
  const act = (ask: string | null, fn: () => Promise<unknown>) => {
    if (ask && !window.confirm(ask)) return;
    fn().then(() => search(q)).catch((e: Error) => setError(e.message));
  };
  if (error === 'reauth') return <SignInAgain />;
  return (
    <section className="card plain">
      <form className="inline" onSubmit={(e: FormEvent) => { e.preventDefault(); search(q); }}>
        <label className="muted" htmlFor="q">Find an account by email or name</label>
        <input className="text" id="q" value={q} onChange={e => setQ(e.target.value)} placeholder="sam@example.com" />
        <button className="btn small primary" type="submit">Search</button>
      </form>
      <div className="err" role="alert">{error}</div>
      {list?.length === 0 && <p className="muted">No accounts found.</p>}
      <ul className="saved">
        {list?.map(u => (
          <li key={u.id} className="user">
            <div className="info">
              <b>{u.name} {u.admin && <span className="tag">admin</span>} {u.banned && <span className="tag bad">banned</span>}</b>
              <span>{u.email} · {u.google ? 'Google + email' : 'email'} · joined {date(u.createdAt)} · last sign-in {ago(u.lastLogin)}</span>
              <button type="button" className="linkish" onClick={() => show(u.id)}>{u.quizzes} saved quiz{u.quizzes === 1 ? '' : 'zes'}</button>
              {open === u.id && (
                <ul className="mini-list">
                  {quizzes.map(z => (
                    <li key={z.id}>{z.title} <span className="muted">({z.questions} q{z.ok ? '' : ', unfinished'})</span>
                      <button type="button" className="linkish danger" onClick={() => act(`Delete the quiz “${z.title}” from ${u.email}’s account?`, () => A.deleteQuiz(z.id).then(() => show(u.id)))}>delete</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {!u.admin && (
              <div className="actions">
                <button type="button" className="btn small" onClick={() => act(`Sign ${u.email} out on every device?`, () => A.signUserOut(u.id))}>Sign out</button>
                {u.banned
                  ? <button type="button" className="btn small" onClick={() => act(`Lift the ban on ${u.email}?`, () => A.unban(u.id))}>Unban</button>
                  : <button type="button" className="btn small danger" onClick={() => { const reason = window.prompt(`Ban ${u.email}? They’ll be signed out and can’t sign in again. Reason (for the admin log):`); if (reason !== null) act(null, () => A.ban(u.id, reason)); }}>Ban</button>}
                <button type="button" className="btn small danger" onClick={() => act(`Delete ${u.email}’s account and all ${u.quizzes} of its quizzes? This can’t be undone. (Ban them first if they shouldn’t come back.)`, () => A.deleteUser(u.id))}>Delete</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function LogTab() {
  const [data, error] = usePoll(A.adminLog, 15000);
  if (error === 'reauth') return <SignInAgain />;
  if (!data) return <p className="muted">{error || 'Loading…'}</p>;
  return (
    <section className="card plain">
      <h2>Admin log</h2>
      <p className="muted">Every admin action, newest first.</p>
      {data.entries.length === 0 ? <p className="muted">Nothing yet.</p> : (
        <table className="log">
          <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>On</th><th>Detail</th></tr></thead>
          <tbody>{data.entries.map((e, i) => <tr key={i}><td>{date(e.at)}</td><td>{e.admin}</td><td>{e.action.replace(/_/g, ' ')}</td><td>{e.target}</td><td>{e.detail}</td></tr>)}</tbody>
        </table>
      )}
    </section>
  );
}
