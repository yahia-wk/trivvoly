// The marquee light bulbs around the board. They chase on big moments, count down with the
// timer (lit bulbs = time left), turn red when time is nearly up and flash when it's out.
import { useMemo } from 'react';
import { reducedMotion } from './effects';

export type BulbMode = 'steady' | 'chase' | 'chase-fast';

function positions(): [number, number][] {
  const fw = 1460, fh = 712, inset = 13, sp = 36, w = fw - 2 * inset, h = fh - 2 * inset;
  const nx = Math.round(w / sp), ny = Math.round(h / sp), pts: [number, number][] = [];
  for (let k = 0; k < nx; k++) pts.push([inset + k * w / nx, inset]);
  for (let k = 0; k < ny; k++) pts.push([inset + w, inset + k * h / ny]);
  for (let k = 0; k < nx; k++) pts.push([inset + w - k * w / nx, inset + h]);
  for (let k = 0; k < ny; k++) pts.push([inset, inset + h - k * h / ny]);
  const start = Math.floor(nx / 2);
  return pts.slice(start).concat(pts.slice(0, start)); // start at the top middle
}

export function Bulbs({ mode, level, danger, flash }: { mode: BulbMode; level: number; danger: boolean; flash: boolean }) {
  const pts = useMemo(positions, []);
  const n = pts.length, lit = Math.ceil(Math.max(0, Math.min(1, level)) * n - 1e-9);
  const cls = [
    (mode === 'chase' || mode === 'chase-fast') && !reducedMotion ? 'chase' : '',
    mode === 'chase-fast' && !reducedMotion ? 'fast' : '',
    danger ? 'danger' : '',
    flash && !reducedMotion ? 'flash' : ''
  ].filter(Boolean).join(' ');
  return (
    <div id="bulbs" className={cls} aria-hidden="true">
      {pts.map(([x, y], k) => <i key={k} className={`bulb p${k % 3}${k >= n - lit ? ' on' : ''}`} style={{ left: x, top: y }} />)}
    </div>
  );
}
