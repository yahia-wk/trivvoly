// Quizmaster links look like /r/K7QM2X/host#k=<key>. The #fragment never reaches the server; we
// trade it for an HttpOnly cookie scoped to this room, then wipe it from the address bar (which may
// be on a projector). The key is also kept for this browser tab so the TV can show the remote's QR code.
import { useEffect, useState } from 'react';
import { claimRoom } from './api';

const storeKey = (code: string) => `trivvoly-key-${code}`;

export function rememberedKey(code: string): string | null {
  try { return sessionStorage.getItem(storeKey(code)); } catch { return null; }
}

export function useQuizmasterAccess(code: string): { ready: boolean; error: string | null } {
  const [state, setState] = useState<{ ready: boolean; error: string | null }>({ ready: false, error: null });
  useEffect(() => {
    const key = new URLSearchParams(location.hash.slice(1)).get('k');
    if (!key) { setState({ ready: true, error: null }); return; }
    claimRoom(code, key)
      .then(() => {
        try { sessionStorage.setItem(storeKey(code), key); } catch { /* private mode: no remote QR, that's all */ }
        history.replaceState(null, '', location.pathname);
        setState({ ready: true, error: null });
      })
      .catch((e: Error) => setState({ ready: false, error: e.message }));
  }, [code]);
  return state;
}
