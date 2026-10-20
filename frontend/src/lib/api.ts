// REST calls: list quizzes, create and claim rooms, join as a team, accounts. Cookies do the authorising.

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly problems: string[] = []) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError('Can’t reach Trivvoly. Check your connection.', 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error || 'Something went wrong.', res.status, body.problems || []);
  return body as T;
}

const send = <T>(method: string, path: string, data: unknown = {}) =>
  call<T>(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
const post = <T>(path: string, data: unknown) => send<T>('POST', path, data);

export interface QuizSummary { id: string; title: string; rounds: number; questions: number }

export const listQuizzes = () => call<{ quizzes: QuizSummary[] }>('/api/quizzes');
export const createRoom = (body: { quizId: string } | { quiz: unknown } | { savedQuizId: string }) => post<{ code: string; hostUrl: string }>('/api/rooms', body);
export const roomInfo = (code: string) => call<{ code: string; quizName: string }>(`/api/rooms/${code}`);
export const claimRoom = (code: string, key: string) => post<{ ok: true }>(`/api/rooms/${code}/claim`, { key });
export const joinRoom = (code: string, name: string) => post<{ id: string; name: string }>(`/api/rooms/${code}/join`, { name });

export const ROOM_CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/; // codes never use O, 0, I or 1

export const loadBuiltInQuiz = (id: string) => call<unknown>(`/api/quizzes/${encodeURIComponent(id)}`);
export const checkQuiz = (quiz: unknown) => post<{ ok: boolean; problems: string[]; summary?: { rounds: number; questions: number } }>('/api/quizzes/check', { quiz });

/* ---------- Accounts ---------- */

export interface User { name: string; email: string; google: boolean }
export interface SavedQuiz { id: string; title: string; ok: boolean; rounds: number; questions: number; updatedAt: number }

export const authOptions = () => call<{ google: boolean; email: boolean }>('/api/auth/options');
export const getMe = () => call<{ user: User | null }>('/api/me');
export const renameMe = (name: string) => send<{ user: User }>('PATCH', '/api/me', { name });
export const deleteMe = () => send<{ ok: true }>('DELETE', '/api/me');
export const signOut = (everywhere = false) => post<{ ok: true }>('/api/auth/signout', { everywhere });
export const emailLink = (email: string, next: string) => post<{ ok: true }>('/api/auth/email', { email, next });
export const verifyEmailLink = (token: string) => post<{ user: User; next: string }>('/api/auth/email/verify', { token });
export const googleSignInUrl = (next: string) => `/api/auth/google/start?next=${encodeURIComponent(next)}`;

export const myQuizzes = () => call<{ quizzes: SavedQuiz[] }>('/api/my/quizzes');
export const getSavedQuiz = (id: string) => call<SavedQuiz & { quiz: unknown }>(`/api/my/quizzes/${encodeURIComponent(id)}`);
export const createSavedQuiz = (quiz: unknown) => post<SavedQuiz>('/api/my/quizzes', { quiz });
export const updateSavedQuiz = (id: string, quiz: unknown) => send<SavedQuiz>('PUT', `/api/my/quizzes/${encodeURIComponent(id)}`, { quiz });
export const deleteSavedQuiz = (id: string) => send<{ ok: true }>('DELETE', `/api/my/quizzes/${encodeURIComponent(id)}`);
