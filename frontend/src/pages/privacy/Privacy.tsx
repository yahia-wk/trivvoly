// What Trivvoly keeps about people, in plain words. Keep in step with docs/HOSTING.md.
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { siteInfo } from '../../lib/api';
import '../landing/landing.css';
import '../account/account.css';

export default function Privacy() {
  const [contact, setContact] = useState('');
  useEffect(() => { siteInfo().then(s => setContact(s.contact)).catch(() => {}); }, []);
  return (
    <div className="page-landing page-account">
      <div className="wrap" style={{ maxWidth: 760 }}>
        <header className="mini-head"><Link to="/" className="home">Trivvoly</Link></header>
        <section className="card plain prose">
          <h2>Privacy</h2>
          <p>Trivvoly keeps as little about you as it can, uses it only to run the game and your account, and never sells it or shows you ads based on it. There are no tracking or advertising cookies.</p>

          <h3>Playing</h3>
          <p>Players don’t have accounts. When your team joins a game, Trivvoly keeps your team name, your answers, marks and scores, and a cookie on your phone so you stay in the game. All of it is deleted when the game ends: when the quizmaster ends it, after 3 hours without anything happening, or after 12 hours at most.</p>

          <h3>Quizmaster accounts</h3>
          <p>If you sign in, we keep your email address, your name, your Google account ID (only if you sign in with Google) and the quizzes you save. Signing in sets one cookie that keeps you signed in for 30 days. You can delete your account, and everything in it, at any time from your account page.</p>
          <p>Signing in with Google gives us your Google account ID, email address and name, nothing else. Sign-in emails are sent through our email provider.</p>

          <h3>Server logs</h3>
          <p>Like most websites, the server logs requests (the page asked for, the time and your internet address) to keep Trivvoly running and to stop abuse. Logs never contain your answers, team names, full email address or anything you type. Old logs are deleted automatically.</p>

          <h3>Backups</h3>
          <p>The database is backed up once a day, and backups are kept for 14 days, so something you delete can stay in a backup for up to two weeks before it’s gone for good.</p>

          <h3>Questions</h3>
          <p>{contact ? <>Ask about your data, or ask us to delete it: <a href={`mailto:${contact}`} style={{ color: 'var(--gold)' }}>{contact}</a>.</> : 'Ask the person who runs this Trivvoly server.'} Trivvoly is open source: you can read exactly what it does <a href="https://github.com/yahia-wk/trivvoly" rel="noopener" style={{ color: 'var(--gold)' }}>on GitHub</a>.</p>
        </section>
      </div>
    </div>
  );
}
