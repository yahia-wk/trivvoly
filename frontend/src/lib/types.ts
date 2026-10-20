// Shapes of what the server sends. The quiz types are generated from the backend's Pydantic models
// (quiz.gen.ts); the view types below mirror `host_view` and `player_view` in backend/trivvoly/game.py.
import type { EmojiQ, FlagQ, MusicQ, Quiz, Round, StandardQ, Tiebreaker, VersusQ, VowelsQ } from './quiz.gen';

export type { EmojiQ, FlagQ, MusicQ, Quiz, Round, StandardQ, Tiebreaker, VersusQ, VowelsQ };
export type Question = StandardQ | FlagQ | MusicQ | EmojiQ | VowelsQ | VersusQ;

export type SlideType = 'title' | 'rules' | 'round' | 'question' | 'swap' | 'answer' | 'standings' | 'halftime' | 'tbIntro' | 'tb' | 'winner' | 'end';
export interface Slide { type: SlideType; r?: number; q?: number; t?: number }

export interface TimerView {
  mode: 'none' | 'q' | 'break';
  total: number;
  remaining: number;
  endsAt: number | null; // server clock, milliseconds
  running: boolean;
  done: boolean;
}

export interface Settings { quiz_name: string; seconds: number; break_minutes: number; auto_read: boolean; auto_timer: boolean }
export type MarkSource = 'peer' | 'auto' | 'host';
export type DisputeStatus = 'open' | 'upheld' | 'overturned';

/* ---------- Quizmaster (TV + remote) ---------- */

export interface TeamRow {
  id: string;
  name: string;
  phone: boolean;          // false: added by the quizmaster, plays on paper
  online: boolean;
  joker: number;
  adj: number;
  manual: Record<string, number>;
  rounds: (number | null)[];
  total: number;
  rank: number;
}

export interface AnswerRow {
  team: string;
  answer: string;
  raw: { a: string; b: string } | null;
  mark: number | null;
  src: MarkSource | null;
  dispute: DisputeStatus | null;
  suggest?: { level: 'match' | 'close'; pts: number } | null;
  warn?: boolean;
  marker?: string | null;
  off?: number | null;
}

export interface DisputeFacts {
  key: string;
  qk: string;
  team: string;
  teamName: string;
  marker: string | null;
  markerName: string | null;
  question: string;
  round: number | null;
  n: number;
  theirs: string;
  correct: string;
  note: string;
  reason: string;
  from: number;
  max: number;
}

export interface Theatre extends DisputeFacts {
  phase: 'showing' | 'deliberating' | 'verdict';
  pts: number | null;
  verdict: 'upheld' | 'overturned' | null;
}

export interface TvStatus { online?: boolean; soundReady?: boolean; playing?: boolean; muted?: boolean; lounge?: boolean; volume?: number }

export interface HostView {
  index: number;
  slide: Slide;
  revealed: boolean;
  hint: boolean;
  rolling: boolean;
  timer: TimerView;
  settings: Settings;
  teams: TeamRow[];
  current: { qk: string; rows: AnswerRow[]; max: number } | null;
  pairings: Record<string, string>;
  disputes: DisputeFacts[];
  theatre: Theatre | null;
  parked: string[];
  tv: TvStatus;
  serverTime: number;
}

export interface RoomInfo { code: string; joinUrl: string; siteUrl: string }

/* ---------- Teams ---------- */

export interface PublicQuestion {
  qk: string;
  n: number;
  label: string;
  input: 'text' | 'music' | 'ab' | 'number';
  r?: number;
  icon?: string;
  text?: string;
  emoji?: string;
  flag?: string;
  cat?: string;
  clue?: string;
  hint?: string;
  bLabel?: string;
  A?: { icon?: string | null; text: string };
  B?: { icon?: string | null; text: string };
}

export interface AnswerKey { a: string; sub: string; note: string }

export interface SheetItem {
  qk: string;
  info: PublicQuestion;
  my: { a: string; b: string } | null;
  open: boolean;
  key: AnswerKey | null;
  mark: number | null;
  src: MarkSource | null;
  dispute: { status: DisputeStatus } | null;
}

export interface MarkItem {
  qk: string;
  info: PublicQuestion;
  key: AnswerKey;
  their: string | null;
  max: number;
  mark: number | null;
  src: MarkSource | null;
  dispute: { status: DisputeStatus } | null;
}

export interface Standing { id: string; name: string; total: string; rank: number }

export interface PlayerSlide extends Slide {
  index: number;
  revealed: boolean;
  quizName: string;
  rounds: number;
  timer: TimerView | null;
  round?: { title: string; icon?: string | null; blurb?: string | null; scoring?: string | null };
  question?: PublicQuestion;
  standings?: Standing[];
}

export interface PlayerView {
  me: { id: string; name: string; joker: number; marking: { id: string; name: string } | null; markedBy: string | null };
  slide: PlayerSlide;
  sheet: SheetItem[];
  markSheet: MarkItem[];
  serverTime: number;
}

/* ---------- Socket messages ---------- */

export type ServerMessage =
  | { type: 'state'; view: HostView | PlayerView }
  | { type: 'quiz'; quiz: Quiz; room: RoomInfo }
  | { type: 'result'; id: number; ok: boolean; error?: string }
  | { type: 'effect'; effect: string; on?: boolean }
  | { type: 'toast'; text: string }
  | { type: 'needjoin' | 'kicked' | 'closed' };
