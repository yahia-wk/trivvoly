// A dispute on the big screen. The server runs the sequence (showing → deliberating → verdict);
// this card just shows whichever step it's on.
import { ptsText } from '../../lib/host';
import type { HostView } from '../../lib/types';

export function DisputeCard({ view, onRule, onLater }: { view: HostView; onRule: (pts: number) => void; onLater: () => void }) {
  const th = view.theatre;
  if (!th) return null;
  const waiting = view.disputes.length;
  const label = (v: number) => (th.max > 1 ? `${v} point${v === 1 ? '' : 's'}` : v ? '✓ correct' : '✗ wrong');
  const opts = th.max > 1 ? [0, 1, 2] : [th.from, th.from ? 0 : 1];
  return (
    <div id="dispute" role="dialog" aria-modal="true" aria-label="Dispute">
      <div className="dp-card">
        {waiting > 1 && th.phase === 'showing' && <span className="dp-count">{waiting} disputes waiting</span>}
        <span className="dp-gavel" aria-hidden="true">⚖️</span>
        <h2 className="dp-title">Dispute!</h2>
        <p className="dp-who"><b>{th.teamName}</b> {th.markerName ? <>challenge the mark from <b>{th.markerName}</b></> : 'challenge their mark'}</p>
        <p className="dp-q">{th.round != null ? `Round ${th.round + 1}, question ${th.n}: ` : ''}{th.question}</p>
        <div className="dp-grid">
          <div className="dp-box"><div className="dp-label">Their answer</div><div className="dp-ans">{th.theirs}</div></div>
          <div className="dp-box"><div className="dp-label">Correct answer</div><div className="dp-ans key">{th.correct}</div></div>
        </div>
        {th.reason && <p className="dp-reason">“{th.reason}”</p>}
        <p className="dp-mark">Marked: {label(th.from)}{th.note ? ` · Marking note: ${th.note}` : ''}</p>
        {th.phase === 'verdict' && th.verdict ? <div className={`dp-verdict ${th.verdict}`}>{th.verdict === 'upheld' ? 'Upheld' : 'Overturned'}</div>
          : th.phase === 'deliberating' ? <p className="dp-wait">The quizmaster is deliberating…</p>
          : (
            <div className="dp-btns">
              {opts.map(v => (
                <button key={v} className={`pill-btn${v === th.from ? ' ghost' : ''}`} type="button" onClick={() => onRule(v)}>
                  {v === th.from ? `Uphold: ${th.max > 1 ? `keep ${v}` : label(v)}` : th.max > 1 ? `Overturn: give ${v}` : `Overturn: give ${ptsText(v, 1)}`}
                </button>
              ))}
              <button className="pill-btn ghost" type="button" onClick={onLater}>Later</button>
            </div>
          )}
      </div>
    </div>
  );
}
