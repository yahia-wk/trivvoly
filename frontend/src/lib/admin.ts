// The admin area's API. Every call answers 404 unless you're signed in as an admin.

const json = { 'Content-Type': 'application/json' };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || 'Something went wrong.'), { status: res.status });
  return body as T;
}
const send = <T>(method: string, path: string, data: unknown = {}) => call<T>(path, { method, headers: json, body: JSON.stringify(data) });

export interface Switches { pauseNewGames: boolean; pauseSignUps: boolean; notice: string }
export interface Problem { time: number; level: string; msg: string; event: string | null; requestId: string | null; error: string | null }
export interface Overview {
  now: number; uptimeSeconds: number;
  games: { live: number; max: number; teams: number; screens: number; startedSinceBoot: number };
  accounts: { users: number; newUsers7d: number; activeUsers7d: number; savedQuizzes: number; banned: number };
  signInsSinceBoot: { ok: number; failed: number };
  errorsSinceBoot: number; rateLimitedSinceBoot: number;
  switches: Switches;
  signIn: { google: boolean; email: string | null };
  problems: Problem[];
}
export interface AdminRoom {
  code: string; quiz: string; builtIn: string | null; createdAt: number; lastActive: number; ageMinutes: number;
  slide: number; slides: number; ip: string;
  screens: { tv: boolean; remotes: number; phones: number };
  teams: { id: string; name: string; online: boolean }[];
}
export interface AdminUser { id: string; email: string; name: string; google: boolean; createdAt: number; lastLogin: number; quizzes: number; banned: boolean; admin: boolean }
export interface AdminQuiz { id: string; title: string; ok: boolean; rounds: number; questions: number; updatedAt: number }
export interface LogEntry { at: number; admin: string; action: string; target: string; detail: string }

export const overview = () => call<Overview>('/api/admin/overview');
export const rooms = () => call<{ rooms: AdminRoom[] }>('/api/admin/rooms');
export const endRoom = (code: string) => send<{ ok: true }>('POST', `/api/admin/rooms/${code}/end`);
export const removeTeam = (code: string, team: string) => send<{ ok: true }>('POST', `/api/admin/rooms/${code}/teams/${encodeURIComponent(team)}/remove`);
export const users = (q: string) => call<{ users: AdminUser[] }>(`/api/admin/users?q=${encodeURIComponent(q)}`);
export const userQuizzes = (id: string) => call<{ quizzes: AdminQuiz[] }>(`/api/admin/users/${id}/quizzes`);
export const signUserOut = (id: string) => send<{ ok: true }>('POST', `/api/admin/users/${id}/signout`);
export const ban = (id: string, reason: string) => send<{ ok: true }>('POST', `/api/admin/users/${id}/ban`, { reason });
export const unban = (id: string) => send<{ ok: true }>('POST', `/api/admin/users/${id}/unban`);
export const deleteUser = (id: string) => send<{ ok: true }>('DELETE', `/api/admin/users/${id}`);
export const deleteQuiz = (id: string) => send<{ ok: true }>('DELETE', `/api/admin/quizzes/${id}`);
export const setSwitches = (s: Partial<Switches>) => send<Switches>('PUT', '/api/admin/switches', s);
export const adminLog = () => call<{ entries: LogEntry[] }>('/api/admin/log');
