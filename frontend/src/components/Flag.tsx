// Flags come only from the built-in library (shared/flags.json), looked up by name.
import FLAGS from '../../../shared/flags.json';

const LIBRARY = FLAGS as Record<string, { w: number; h: number; svg: string }>;

export function Flag({ id, height, width, className = 'flag', label = 'Mystery flag' }: { id: string; height?: number; width?: number; className?: string; label?: string }) {
  const f = Object.prototype.hasOwnProperty.call(LIBRARY, id) ? LIBRARY[id] : null;
  if (!f) return null;
  const h = height ?? Math.round((width ?? 280) * f.h / f.w);
  const w = width ?? Math.round(h * f.w / f.h);
  // The markup is our own library's, never a quiz's or a player's
  return <svg className={className} viewBox={`0 0 ${f.w} ${f.h}`} width={w} height={h} role="img" aria-label={label} shapeRendering="geometricPrecision" dangerouslySetInnerHTML={{ __html: f.svg }} />;
}
