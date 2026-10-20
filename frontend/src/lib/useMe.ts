// Who is signed in (null: nobody; undefined: still asking). Asked once per page load and shared.
import { useEffect, useState } from 'react';
import { getMe, type User } from './api';

let known: Promise<User | null> | null = null;
const listeners = new Set<(u: User | null) => void>();

/** After signing in or out, or renaming: tell every screen. */
export function setMe(user: User | null) {
  known = Promise.resolve(user);
  listeners.forEach(fn => fn(user));
}

export function useMe(): User | null | undefined {
  const [me, set] = useState<User | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const update = (u: User | null) => { if (live) set(u); };
    listeners.add(update);
    (known ??= getMe().then(r => r.user).catch(() => null)).then(update);
    return () => { live = false; listeners.delete(update); };
  }, []);
  return me;
}
