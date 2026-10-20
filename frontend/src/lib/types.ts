// What the server sends. Everything here comes from the backend's Pydantic models
// (backend/trivvoly/quiz.py and views.py) via `npm run gen:types`, so it can't drift from the server.
import type {
  AnswerKey, AnswerRow, DisputeFacts, EmojiQ, FlagQ, HostView, MarkItem, MusicQ, PlayerSlide, PlayerView, PublicQuestion,
  Quiz, RoomInfo, Round, SheetItem, Slide, StandardQ, Standing, TeamRow, Theatre, Tiebreaker, TimerView, TvStatus, VersusQ, VowelsQ
} from './contract.gen';

export type {
  AnswerKey, AnswerRow, DisputeFacts, EmojiQ, FlagQ, HostView, MarkItem, MusicQ, PlayerSlide, PlayerView, PublicQuestion,
  Quiz, RoomInfo, Round, SheetItem, Slide, StandardQ, Standing, TeamRow, Theatre, Tiebreaker, TimerView, TvStatus, VersusQ, VowelsQ
};

export type Question = StandardQ | FlagQ | MusicQ | EmojiQ | VowelsQ | VersusQ;
export type SlideType = Slide['type'];

/** Messages on a screen's WebSocket. */
export type ServerMessage =
  | { type: 'state'; view: HostView | PlayerView }
  | { type: 'quiz'; quiz: Quiz; room: RoomInfo }
  | { type: 'result'; id: number; ok: boolean; error?: string }
  | { type: 'effect'; effect: string; on?: boolean; value?: number }
  | { type: 'toast'; text: string }
  | { type: 'needjoin' | 'kicked' | 'closed' };
