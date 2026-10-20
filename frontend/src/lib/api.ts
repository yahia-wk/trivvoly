// REST calls: list quizzes, create and claim rooms, join as a team. Cookies do the authorising.

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

const post = <T>(path: string, data: unknown) =>
  call<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

export interface QuizSummary { id: string; title: string; rounds: number; questions: number }

export const listQuizzes = () => call<{ quizzes: QuizSummary[] }>('/api/quizzes');
export const createRoom = (body: { quizId: string } | { quiz: unknown }) => post<{ code: string; hostUrl: string }>('/api/rooms', body);
export const roomInfo = (code: string) => call<{ code: string; quizName: string }>(`/api/rooms/${code}`);
export const claimRoom = (code: string, key: string) => post<{ ok: true }>(`/api/rooms/${code}/claim`, { key });
export const joinRoom = (code: string, name: string) => post<{ id: string; name: string }>(`/api/rooms/${code}/join`, { name });

export const ROOM_CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/; // codes never use O, 0, I or 1
