// Visual effects for the big screen: confetti and fitting text into its box.

export const reducedMotion = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

let confettiRaf = 0;
export function confetti(canvas: HTMLCanvasElement | null, W = 1600, H = 900): void {
  if (reducedMotion || !canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const colors = ['#F5B83D', '#FFE9A8', '#7FE0C2', '#E2384D', '#FFF6E0', '#17606F'];
  const P = Array.from({ length: 260 }, (_, k) => ({
    x: Math.random() * W, y: -20 - Math.random() * H * 0.7, vx: (Math.random() - 0.5) * 4, vy: 2 + Math.random() * 4,
    r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3, w: 8 + Math.random() * 10, h: 5 + Math.random() * 7,
    c: colors[k % colors.length], sway: Math.random() * Math.PI * 2
  }));
  cancelAnimationFrame(confettiRaf);
  const t0 = performance.now();
  const frame = (now: number) => {
    ctx.clearRect(0, 0, W, H);
    let alive = 0;
    for (const p of P) {
      p.sway += 0.05; p.x += p.vx + Math.sin(p.sway) * 0.8; p.y += p.vy; p.vy += 0.03; p.r += p.vr;
      if (p.y < H + 30) { alive++; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.sway))); ctx.restore(); }
    }
    if (alive && now - t0 < 10000) confettiRaf = requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
  };
  frame(t0);
}

/** Shrink text marked with data-fit="<min px>" until it fits its box, and answer plates likewise. */
export function fitText(root: HTMLElement | null): void {
  if (!root) return;
  root.querySelectorAll<HTMLElement>('[data-fit]').forEach(el => {
    el.style.fontSize = '';
    const min = +(el.dataset.fit || 24), box = (el.closest('[data-fitbox]') as HTMLElement) || el.parentElement!;
    let fs = parseFloat(getComputedStyle(el).fontSize), guard = 60;
    while ((box.scrollHeight > box.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) && fs > min && guard--) { fs -= 3; el.style.fontSize = fs + 'px'; }
  });
  root.querySelectorAll<HTMLElement>('.plate-answer').forEach(el => {
    el.style.fontSize = '';
    const face = el.parentElement!, sub = face.querySelector<HTMLElement>('.plate-sub'), subH = sub ? sub.offsetHeight + 6 : 0;
    let fs = parseFloat(getComputedStyle(el).fontSize), guard = 40;
    while ((el.scrollHeight > face.clientHeight - 24 - subH || el.scrollWidth > face.clientWidth - 30) && fs > 22 && guard--) { fs -= 2; el.style.fontSize = fs + 'px'; }
  });
}
