// A QR code drawn as SVG squares (no injected markup).
import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

export function Qr({ text, size = 170 }: { text: string; size?: number }) {
  const cells = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount(), out: string[] = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) out.push(`M${c} ${r}h1v1h-1z`);
    return { n, d: out.join('') };
  }, [text]);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${cells.n} ${cells.n}`} shapeRendering="crispEdges" role="img" aria-label={`QR code for ${text}`}>
      <rect width={cells.n} height={cells.n} fill="#fff" />
      <path d={cells.d} fill="#000" />
    </svg>
  );
}
