// A small copy of the TV, drawing the selected question exactly as the big screen will.
import { Component, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { hudLabels } from '../../lib/slides';
import type { HostView, Quiz, Slide } from '../../lib/types';
import { Bulbs } from '../show/Bulbs';
import { fitText } from '../show/effects';
import { SlideContent } from '../show/Slides';
import '../show/show.css';

class SafeSlide extends Component<{ children: ReactNode }, { broken: boolean }> {
  state = { broken: false };
  static getDerivedStateFromError() { return { broken: true }; }
  render() {
    return this.state.broken
      ? <div className="center-stack"><p className="lede">The preview appears once this question is filled in.</p></div>
      : this.props.children;
  }
}

function fakeView(slide: Slide, revealed: boolean, quiz: Quiz): HostView {
  return {
    index: 0, slide, revealed, hint: false, rolling: false,
    timer: { mode: 'none', total: 0, remaining: 0, endsAt: null, running: false, done: false },
    settings: { quiz_name: quiz.title, seconds: 45, break_minutes: 10, auto_read: false, auto_timer: false },
    teams: [], current: null, pairings: {}, disputes: [], theatre: null, parked: [], tv: { online: true }, serverTime: Date.now()
  };
}

export function TvPreview({ quiz, slide, revealed }: { quiz: Quiz; slide: Slide; revealed: boolean }) {
  const box = useRef<HTMLDivElement>(null), slideRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / 1600);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => { fitText(slideRef.current); });
  const [left, right] = hudLabels(quiz, slide, quiz.title);
  const kind = slide.r != null ? quiz.rounds[slide.r]?.kind : null;
  const key = JSON.stringify(slide) + JSON.stringify(slide.r != null && slide.q != null ? quiz.rounds[slide.r]?.questions[slide.q] : null);
  return (
    <div className="page-tv tv-preview" ref={box} style={{ height: 900 * scale }} aria-label="Preview of the big screen">
      <div id="stage" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
        <header id="hud"><div id="hud-left">{left}</div><div id="hud-right"><span id="qcount">{right}</span></div></header>
        <div id="frame">
          <Bulbs mode="steady" level={1} danger={false} flash={false} />
          <div id="board" className={`k-${slide.type}${kind ? ` kind-${kind}` : ''}`}>
            <div id="slide" ref={slideRef}>
              <SafeSlide key={key}>
                <SlideContent quiz={quiz} slide={slide} view={fakeView(slide, revealed, quiz)} room={null} quizName={quiz.title}
                  playing={false} lounge={false} breakClock="10:00" standingsShown={0} onAct={() => {}} />
              </SafeSlide>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
