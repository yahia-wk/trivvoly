// The big screen. The server decides what's on it; this page draws it and adds the show:
// sound, speech, lights, animation. The quizmaster can drive it from here or from the phone remote.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { fmtTime, timeLeft } from '../../lib/clock';
import { quizName as nameOf, useHostRoom } from '../../lib/host';
import { hudLabels, isRevealable, isTimed } from '../../lib/slides';
import type { HostView, ServerMessage, Slide } from '../../lib/types';
import { useTick } from '../../lib/useTick';
import { Lounge, SFX, TunePlayer } from './audio';
import { Bulbs, type BulbMode } from './Bulbs';
import { DisputeCard } from './DisputeCard';
import { confetti, fitText, reducedMotion } from './effects';
import { AnswersPanel, MenuPanel, ScoresPanel } from './Panels';
import { SlideContent } from './Slides';
import { answerSpeech, questionSpeech, speak, stopSpeech } from './speech';
import './show.css';

const W = 1600, H = 900;
type Panel = null | 'answers' | 'scores' | 'menu';

function useStored<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => { try { const s = localStorage.getItem(key); return s == null ? initial : JSON.parse(s); } catch { return initial; } });
  const set = useCallback((x: T) => { setV(x); try { localStorage.setItem(key, JSON.stringify(x)); } catch { /* private mode */ } }, [key]);
  return [v, set];
}

export default function Show() {
  const { code = '' } = useParams();
  const onMessage = useRef<(m: ServerMessage) => void>(() => {});
  const room = useHostRoom(code, 'tv', m => onMessage.current(m));
  const { view, quiz, slide, slides } = room;

  /* ---------- Local presentation state ---------- */
  const [toastMsg, setToastMsg] = useState('');
  const toastTimer = useRef(0);
  const toast = useCallback((m: string) => { setToastMsg(m); window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToastMsg(''), 2600); }, []);
  const run = useCallback((cmd: string, args: Record<string, unknown> = {}) => room.send(cmd, args).catch((e: Error) => toast(e.message)), [room.send, toast]);

  const [volume, setVolume] = useStored('trivvoly-volume', 0.7);
  const [muted, setMuted] = useStored('trivvoly-muted', false);
  const [soundReady, setSoundReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(-1);
  const [loungeOn, setLoungeOn] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [fs, setFs] = useState(false);
  const [idle, setIdle] = useState(false);
  const [scale, setScale] = useState(1);
  const [stamp, setStamp] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [chaseUntil, setChaseUntil] = useState(0);
  const [standingsShown, setStandingsShown] = useState(0);
  const [dir, setDir] = useState(1);
  const tunes = useRef(new TunePlayer()).current;
  const lounge = useRef(new Lounge()).current;
  const slideRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  SFX.volume = volume; SFX.muted = muted;
  useEffect(() => { SFX.applyVolume(); }, [volume, muted]);
  useEffect(() => { SFX.onState = () => setSoundReady(SFX.ready); }, []);

  const settings = view?.settings;
  const latest = useRef({ view, slide, settings, muted, volume, quiz });
  latest.current = { view, slide, settings, muted, volume, quiz };
  const say = useCallback((text: string, onEnd?: () => void) => {
    const err = speak(text, { volume: latest.current.volume, muted: latest.current.muted, onEnd });
    if (err) toast(err);
  }, [toast]);
  const chase = (ms: number) => setChaseUntil(Date.now() + ms);

  tunes.onChange = (idx, natural) => {
    setPlaying(idx);
    const { view: v, slide: s, settings: st } = latest.current;
    if (natural && st?.auto_timer && s?.type === 'question' && v && !v.timer.running && !v.timer.done && v.timer.remaining >= v.timer.total) run('timer_start');
  };

  const playCurrent = useCallback(() => {
    const { quiz: qz, slide: s } = latest.current;
    if (!qz || !s || s.r == null || s.q == null) return;
    const q = qz.rounds[s.r].questions[s.q];
    if (q.kind !== 'music' || q.tune == null) return;
    if (tunes.playing >= 0) { tunes.stop(); return; }
    stopSpeech();
    const err = tunes.play(qz.tunes ?? [], q.tune);
    if (err) toast(err);
  }, [tunes, toast]);

  const readCurrent = useCallback(() => {
    const { quiz: qz, slide: s, view: v } = latest.current;
    if (!qz || !s || !v) return;
    const text = isRevealable(s) && v.revealed ? answerSpeech(qz, s) : questionSpeech(qz, s);
    if (text) say(text);
  }, [say]);

  const toggleLounge = useCallback(() => {
    if (lounge.on) { lounge.stop(); setLoungeOn(false); return; }
    const err = lounge.start();
    if (err) toast(err); else setLoungeOn(true);
  }, [lounge, toast]);

  const toggleMute = useCallback(() => {
    const m = !latest.current.muted;
    setMuted(m); SFX.muted = m; SFX.ensure(); SFX.applyVolume();
    if (m) { stopSpeech(); tunes.stop(); lounge.stop(); setLoungeOn(false); }
    toast(m ? 'Sound off' : 'Sound on');
  }, [setMuted, tunes, lounge, toast]);

  const toggleFS = useCallback(() => {
    const d = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    const fail = () => toast('Full screen isn’t available here. Try your browser’s full-screen option.');
    try {
      if (!d.fullscreenElement && !d.webkitFullscreenElement) {
        const p = el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen?.();
        if (p && 'catch' in p) p.catch(fail);
      } else if (d.exitFullscreen) d.exitFullscreen(); else d.webkitExitFullscreen?.();
    } catch { fail(); }
  }, [toast]);

  /* ---------- Messages that only the TV acts on ---------- */
  onMessage.current = (m: ServerMessage) => {
    if (m.type === 'toast') return toast(m.text);
    if (m.type !== 'effect') return;
    switch (m.effect) {
      case 'tune': return playCurrent();
      case 'read': return readCurrent();
      case 'lounge': return toggleLounge();
      case 'mute': return toggleMute();
      case 'fullscreen': return toggleFS();
      case 'close_panels': return setPanel(null);
      case 'volume': { const v = (m as unknown as { value: number }).value; if (Number.isFinite(v)) setVolume(v); return; }
      case 'hint':
        SFX.hint();
        if (m.on && latest.current.settings?.auto_read) {
          const { quiz: qz, slide: s } = latest.current;
          const q = qz && s && s.r != null && s.q != null ? qz.rounds[s.r].questions[s.q] : null;
          if (q && 'hint' in q && q.hint) say('Hint: ' + q.hint);
        }
    }
  };

  // Tell the remote what this screen's sound is doing
  useEffect(() => {
    if (room.status !== 'open') return;
    const t = window.setTimeout(() => room.send('tv_status', { soundReady, playing: playing >= 0, muted, lounge: loungeOn, volume }).catch(() => {}), 150);
    return () => window.clearTimeout(t);
  }, [room.status, soundReady, playing, muted, loungeOn, volume]);

  /* ---------- Slide changes, reveals, the drumroll, disputes ---------- */
  const prev = useRef<{ index: number | null; revealed: boolean; rolling: boolean; theatreKey: string | null; phase: string | null }>({ index: null, revealed: false, rolling: false, theatreKey: null, phase: null });
  const entryToken = useRef(0);

  useEffect(() => {
    if (!view || !slide || !quiz) return;
    const p = prev.current, first = p.index === null;
    const changed = p.index !== view.index;

    if (changed) {
      const d = first || view.index >= (p.index ?? 0) ? 1 : -1;
      setDir(d);
      const token = ++entryToken.current;
      tunes.stop(); stopSpeech();
      if (slide.type !== 'halftime' && lounge.on) { lounge.stop(); setLoungeOn(false); }
      setStamp(null); setFlash(false); setChaseUntil(0);
      if (slide.type === 'standings') animateStandings(view, token);
      if (!first) {
        if (slide.type === 'round') { SFX.whoosh(); window.setTimeout(() => { if (token === entryToken.current) SFX.fanfare(); }, 220); }
        else if (isTimed(slide)) SFX.chime();
        else if (slide.type === 'swap') SFX.swap();
        autoActions(slide, view, token);
      }
    } else if (view.revealed && !p.revealed && slide.type !== 'winner') {
      // Just revealed
      SFX.reveal(); chase(1500); setStamp(null); setFlash(false);
      if (view.settings.auto_read) { const token = entryToken.current; window.setTimeout(() => { if (token === entryToken.current) say(answerSpeech(quiz, slide)); }, 700); }
    }
    if (slide.type === 'winner' && !first) {
      if (view.rolling && !p.rolling) { stopSpeech(); SFX.drumroll(2.6); }
      if (view.revealed && !p.revealed && !changed) {
        SFX.winFanfare(); confetti(canvasRef.current, W, H);
        const top = [...view.teams].filter(t => t.rank === 1).map(t => t.name);
        if (view.settings.auto_read && top.length) say(`Congratulations, ${top.join(' and ')}!`);
      }
    }
    // Disputes on the big screen
    const th = view.theatre;
    if (!first && th) {
      if (th.key !== p.theatreKey && th.phase === 'showing') SFX.swap();
      if (th.phase === 'deliberating' && p.phase !== 'deliberating') { stopSpeech(); SFX.drumroll(1.8); chase(1900); }
      if (th.phase === 'verdict' && p.phase !== 'verdict') {
        if (th.verdict === 'overturned') { SFX.fanfare(); chase(1500); }
        else { SFX.buzzer(); setFlash(true); window.setTimeout(() => setFlash(false), 1200); }
      }
    }
    prev.current = { index: view.index, revealed: view.revealed, rolling: view.rolling, theatreKey: th?.key ?? null, phase: th?.phase ?? null };
  }); // runs after every render; compares with the previous state itself

  function autoActions(s: Slide, v: HostView, token: number) {
    const q = s.type === 'question' && s.r != null && s.q != null ? quiz!.rounds[s.r].questions[s.q] : null;
    const tuneQ = !!q && q.kind === 'music' && q.tune != null;
    const startLater = () => { if (token === entryToken.current && latest.current.settings?.auto_timer && isTimed(s) && !tuneQ) run('timer_start'); };
    if (v.settings.auto_read && (isTimed(s) || s.type === 'round')) {
      window.setTimeout(() => { if (token === entryToken.current) say(questionSpeech(quiz!, s), startLater); }, s.type === 'round' ? 1500 : 500);
    } else if (isTimed(s) && v.settings.auto_timer && !tuneQ) {
      window.setTimeout(startLater, 900);
    }
  }

  function animateStandings(v: HostView, token: number) {
    const n = Math.min(20, v.teams.length);
    if (reducedMotion || !n) { setStandingsShown(n); return; }
    setStandingsShown(0);
    for (let k = 0; k < n; k++) {
      window.setTimeout(() => {
        if (token !== entryToken.current) return;
        setStandingsShown(k + 1);
        if (k === n - 1) SFX.reveal(); else SFX.blip(k);
      }, 350 + k * 260);
    }
  }

  /* ---------- The timer: sounds, stamp, lights ---------- */
  const timer = view?.timer;
  useTick(100, !!timer && timer.mode !== 'none');
  const left = timeLeft(timer);
  const timerRef = useRef<{ index: number; sec: number; fired: boolean } | null>(null);
  useEffect(() => {
    if (!view || !timer || timer.mode === 'none') { timerRef.current = null; return; }
    const sec = Math.ceil(left), r = timerRef.current;
    if (!r || r.index !== view.index) { timerRef.current = { index: view.index, sec, fired: timer.done }; return; }
    if (timer.running && left > 0) r.fired = false;
    if (sec !== r.sec) {
      r.sec = sec;
      if (timer.running && timer.mode === 'q' && sec > 0) { if (sec <= 3) SFX.beep(); else if (sec <= 10) SFX.tick(); }
    }
    if (!r.fired && (timer.done || (timer.running && left <= 0))) {
      r.fired = true;
      if (timer.mode === 'q') { SFX.buzzer(); setStamp('Time’s up'); } else { SFX.breakOver(); toast('Break’s over. Time for the next round.'); }
      setFlash(true);
    }
    if (timer.running && left > 0 && stamp) { setStamp(null); setFlash(false); }
  });

  /* ---------- Layout: scale the 1600×900 stage, full screen, idle cursor ---------- */
  useEffect(() => {
    const fit = () => {
      const bar = fs ? 0 : document.getElementById('controls')?.offsetHeight ?? 58;
      setScale(Math.max(0.1, Math.min(window.innerWidth / W, (window.innerHeight - bar) / H)));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [fs]);
  useEffect(() => {
    const onFs = () => setFs(!!(document.fullscreenElement || (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
    return () => { document.removeEventListener('fullscreenchange', onFs); document.removeEventListener('webkitfullscreenchange', onFs); };
  }, []);
  useEffect(() => {
    let t = 0;
    const wake = () => { setIdle(false); window.clearTimeout(t); if (fs) t = window.setTimeout(() => setIdle(true), 2500); };
    wake();
    window.addEventListener('mousemove', wake);
    return () => { window.removeEventListener('mousemove', wake); window.clearTimeout(t); };
  }, [fs]);
  useEffect(() => {
    const unlock = () => SFX.ensure();
    document.addEventListener('pointerdown', unlock);
    return () => document.removeEventListener('pointerdown', unlock);
  }, []);
  useLayoutEffect(() => { fitText(slideRef.current); });

  /* ---------- Keyboard and swipes ---------- */
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName?.toLowerCase();
    if (!started) { start(); return; }
    if (view?.theatre && view.theatre.phase === 'showing') { if (e.key === 'Escape') run('dispute_later', { key: view.theatre.key }); return; }
    if (e.key === 'Escape') { setPanel(null); return; }
    if (tag === 'input' || tag === 'select' || tag === 'textarea' || panel) return;
    if ((e.key === ' ' || e.key === 'Enter') && tag === 'button') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    SFX.ensure();
    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown': case 'PageDown': case ' ': case 'Enter': e.preventDefault(); run('next'); break;
      case 'ArrowLeft': case 'ArrowUp': case 'PageUp': case 'Backspace': e.preventDefault(); run('prev'); break;
      case 't': case 'T': if (view && view.timer.mode !== 'none') run('timer'); break;
      case 'p': case 'P': playCurrent(); break;
      case 'h': case 'H': run('hint'); break;
      case 'v': case 'V': readCurrent(); break;
      case 'a': case 'A': e.preventDefault(); setPanel('answers'); break;
      case 'd': case 'D': if (view?.disputes.length) run('dispute_show', { key: view.disputes.find(d => !view.parked.includes(d.key))?.key ?? view.disputes[0].key }); break;
      case 's': case 'S': e.preventDefault(); setPanel('scores'); break;
      case 'g': case 'G': case '?': e.preventDefault(); setPanel('menu'); break;
      case 'm': case 'M': toggleMute(); break;
      case 'f': case 'F': toggleFS(); break;
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    document.addEventListener('keydown', onKey);
    let tx: number | null = null, ty = 0;
    const vp = document.getElementById('viewport');
    const down = (e: TouchEvent) => { if (e.touches.length === 1) { tx = e.touches[0].clientX; ty = e.touches[0].clientY; } };
    const up = (e: TouchEvent) => {
      if (tx == null) return;
      const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty; tx = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { SFX.ensure(); run(dx < 0 ? 'next' : 'prev'); }
    };
    vp?.addEventListener('touchstart', down, { passive: true });
    vp?.addEventListener('touchend', up);
    return () => { document.removeEventListener('keydown', onKey); vp?.removeEventListener('touchstart', down); vp?.removeEventListener('touchend', up); };
  }, [view !== null]);

  function start() {
    SFX.ensure();
    setStarted(true);
    if (!document.fullscreenElement) toggleFS();
  }

  /* ---------- Not able to show the game ---------- */
  const message = room.access.error ? room.access.error
    : room.status === 'denied' ? 'This screen is for the quizmaster. Open the quizmaster link you got when the game was created. If you’re playing, use the room code instead.'
    : room.status === 'closed' ? 'This game has ended and its data has been deleted.' : null;
  if (message) {
    return (
      <div className="page-tv">
        <p style={{ maxWidth: 560, margin: '15vh auto', padding: '0 20px', font: '22px/1.5 system-ui', color: '#FFF6E0', textAlign: 'center' }}>
          {message}<br /><a href="/" style={{ color: '#F5B83D' }}>Start a new game</a>
        </p>
      </div>
    );
  }
  if (!view || !quiz || !slide) return <div className="page-tv" />;

  /* ---------- The show ---------- */
  const name = nameOf(view, quiz);
  const [hudLeft, hudRight] = hudLabels(quiz, slide, name);
  const kind = slide.r != null ? quiz.rounds[slide.r].kind : null;
  const q = slide.r != null && slide.q != null ? quiz.rounds[slide.r].questions[slide.q] : null;
  const timed = isTimed(slide);
  const warn = timer!.mode === 'q' && left <= 5 && (timer!.running || timer!.done);
  const bulbMode: BulbMode = view.rolling ? 'chase-fast'
    : Date.now() < chaseUntil || ['title', 'round', 'end'].includes(slide.type) || (slide.type === 'winner' && view.revealed) ? 'chase' : 'steady';
  const level = timer!.mode !== 'none' && timer!.total ? left / timer!.total : 1;
  const phones = view.teams.filter(t => t.phone), cur = view.current;
  const answersLabel = !cur ? `Teams ${phones.length}`
    : slide.type === 'answer' ? `Mark ${cur.rows.filter(r => r.mark != null && phones.some(t => t.id === r.team)).length}/${phones.length}`
    : `Answers ${cur.rows.filter(r => r.answer && phones.some(t => t.id === r.team)).length}/${phones.length}`;
  const tuneQ = q?.kind === 'music' && q.tune != null;
  const hasHint = slide.type === 'question' && !!q && 'hint' in q && !!q.hint;
  const timerLabel = view.timer.running ? 'Pause timer' : view.timer.done ? 'Restart timer' : left < view.timer.total ? 'Resume timer' : 'Start timer';
  const currentRound = (() => { for (let k = view.index; k >= 0; k--) if (slides[k].r != null) return slides[k].r!; return -1; })();

  const act = (a: 'play' | 'break-toggle' | 'break-minus' | 'break-plus' | 'lounge' | 'scores' | 'skip-winner') => {
    SFX.ensure();
    if (a === 'play') playCurrent();
    else if (a === 'break-toggle') run('timer');
    else if (a === 'break-minus') run('break_adjust', { minutes: -1 });
    else if (a === 'break-plus') run('break_adjust', { minutes: 1 });
    else if (a === 'lounge') toggleLounge();
    else if (a === 'scores') setPanel('scores');
    else if (a === 'skip-winner') run('jump', { index: slides.findIndex(s => s.type === 'winner') });
  };

  return (
    <div className={`page-tv${fs ? ' fs' : ''}${idle ? ' idle' : ''}`}>
      <div id="viewport">
        <div id="stage" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
          <header id="hud">
            <div id="hud-left">{hudLeft}</div>
            <div id="hud-right">
              <span id="qcount">{hudRight}</span>
              {timed && <span id="clock" className={`${warn && !timer!.done ? 'warn' : ''}${timer!.done && timer!.mode === 'q' ? ' done' : ''}`}>{fmtTime(left)}</span>}
            </div>
          </header>
          <div id="frame">
            <Bulbs mode={bulbMode} level={level} danger={warn} flash={flash} />
            <div id="board" className={`k-${slide.type}${kind ? ` kind-${kind}` : ''}${playing >= 0 ? ' is-playing' : ''}`}>
              <div id="slide" key={view.index} ref={slideRef} className={dir < 0 ? 'enter-back' : 'enter'} aria-live="polite">
                <SlideContent quiz={quiz} slide={slide} view={view} room={room.room} quizName={name} playing={playing >= 0} lounge={loungeOn}
                  breakClock={fmtTime(left)} standingsShown={standingsShown} onAct={act} />
              </div>
              {stamp && <div className="stamp">{stamp}</div>}
            </div>
          </div>
          <canvas id="confetti" ref={canvasRef} width={W} height={H} aria-hidden="true" />
          <DisputeCard view={view} onRule={pts => { SFX.ensure(); run('dispute_rule', { key: view.theatre!.key, pts }); }} onLater={() => run('dispute_later', { key: view.theatre!.key })} />
        </div>
      </div>

      <nav id="controls" aria-label="Presenter controls">
        <div className="c-group">
          <button type="button" disabled={!room.canPrev} onClick={() => run('prev')}>Back</button>
          <button type="button" className="primary" disabled={!room.canNext} onClick={() => { SFX.ensure(); run('next'); }}>{room.nextLabel}</button>
        </div>
        <div className="c-group">
          {(timed || slide.type === 'halftime') && <button type="button" onClick={() => run('timer')}>{timerLabel}<kbd>T</kbd></button>}
          {tuneQ && <button type="button" onClick={playCurrent}>{playing >= 0 ? 'Stop tune' : 'Play tune'}<kbd>P</kbd></button>}
          {hasHint && <button type="button" onClick={() => run('hint')}>{view.hint ? 'Hide hint' : 'Show hint'}<kbd>H</kbd></button>}
          {(questionSpeech(quiz, slide) || (view.revealed && answerSpeech(quiz, slide))) && <button type="button" onClick={readCurrent}>Read aloud<kbd>V</kbd></button>}
        </div>
        <div className="c-group">
          <span id="progress">{view.index + 1} / {slides.length}</span>
          {view.disputes.length > 0 && <button type="button" onClick={() => run('dispute_show', { key: view.disputes[0].key })}>⚖️ Disputes {view.disputes.length}<kbd>D</kbd></button>}
          <button type="button" onClick={() => setPanel('answers')}>{answersLabel}<kbd>A</kbd></button>
          <button type="button" onClick={() => setPanel('scores')}>Scores<kbd>S</kbd></button>
          <button type="button" onClick={() => setPanel('menu')}>Menu<kbd>G</kbd></button>
          <button type="button" onClick={toggleMute}>{muted ? 'Unmute' : 'Mute'}<kbd>M</kbd></button>
          <button type="button" onClick={toggleFS}>{fs ? 'Exit full screen' : 'Full screen'}<kbd>F</kbd></button>
        </div>
      </nav>

      {panel === 'answers' && <AnswersPanel view={view} quiz={quiz} slide={slide} quizName={name} run={run} onClose={() => setPanel(null)} />}
      {panel === 'scores' && <ScoresPanel view={view} round={currentRound} run={run} onClose={() => setPanel(null)} />}
      {panel === 'menu' && <MenuPanel view={view} quiz={quiz} slides={slides} room={room.room} volume={volume} onVolume={v => { setVolume(v); SFX.ensure(); }} run={run} onClose={() => setPanel(null)} />}

      <div id="toast" className={toastMsg ? 'show' : ''} role="status" aria-live="polite">{toastMsg}</div>

      {!started && (
        <div id="start-show">
          <div>
            <h2>Ready when you are</h2>
            <p>Click once here on the main screen to switch on sound and go full screen. After that you can run the whole quiz from your phone (Menu → Remote control).</p>
            <button className="pill-btn" type="button" onClick={start}>Start the show</button>
          </div>
        </div>
      )}
    </div>
  );
}
