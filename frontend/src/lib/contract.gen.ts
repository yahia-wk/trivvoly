/* Generated from backend/trivvoly/quiz.py and views.py by `npm run gen:types`. Do not edit by hand. */

export type Format = 1;
export type Title = string;
export type Icon = string | null;
export type Text = string;
/**
 * @maxItems 10
 */
export type Rules = Rule[];
export type Title1 = string;
export type Icon1 = string | null;
export type Kind = "standard" | "flag" | "music" | "emoji" | "vowels" | "versus";
export type Blurb = string | null;
export type Scoring = string | null;
export type Prompt = string | null;
export type A = string;
export type Fact = string | null;
export type Mark = string | null;
export type Say = string | null;
export type Kind1 = "standard";
export type Icon2 = string | null;
export type Q = string;
export type A1 = string;
export type Fact1 = string | null;
export type Mark1 = string | null;
export type Say1 = string | null;
export type Kind2 = "flag";
export type Flag = string | null;
export type Emoji = string | null;
export type Q1 = string | null;
export type A2 = string;
export type Fact2 = string | null;
export type Mark2 = string | null;
export type Say2 = string | null;
export type Kind3 = "music";
export type Tune = number | null;
export type Emoji1 = string | null;
export type By = string;
export type Year = string | null;
export type Hint = string | null;
export type A3 = string;
export type Fact3 = string | null;
export type Mark3 = string | null;
export type Say3 = string | null;
export type Kind4 = "emoji";
export type Emoji2 = string;
export type Q2 = string | null;
export type Year1 = string | null;
export type Hint1 = string | null;
export type A4 = string;
export type Fact4 = string | null;
export type Mark4 = string | null;
export type Say4 = string | null;
export type Kind5 = "vowels";
export type Cat = string;
export type Clue = string;
export type Kind6 = "versus";
export type Icon3 = string | null;
export type Text1 = string;
export type Date = string;
export type First = "a" | "b";
export type Fact5 = string | null;
export type Mark5 = string | null;
export type Say5 = string | null;
/**
 * @minItems 1
 * @maxItems 30
 */
export type Questions = (StandardQ | FlagQ | MusicQ | EmojiQ | VowelsQ | VersusQ)[];
/**
 * @minItems 1
 * @maxItems 12
 */
export type Rounds = Round[];
export type Icon4 = string | null;
export type Q3 = string;
export type A5 = string;
export type Say6 = string | null;
export type Fact6 = string | null;
/**
 * @maxItems 5
 */
export type Tiebreakers = Tiebreaker[];
export type Inst = "strings" | "organ" | "brass" | "piano" | "pluck";
export type Unit = number;
export type Transpose = number | null;
export type Double = number | null;
export type Notes = string;
/**
 * @maxItems 20
 */
export type Tunes = Tune1[];
export type Halftimeafter = number;
export type Index = number;
export type Type =
  | "title"
  | "rules"
  | "round"
  | "question"
  | "swap"
  | "answer"
  | "standings"
  | "halftime"
  | "tbIntro"
  | "tb"
  | "winner"
  | "end";
export type R = number | null;
export type Q4 = number | null;
export type T = number | null;
export type Revealed = boolean;
export type Hint2 = boolean;
export type Rolling = boolean;
export type Mode = "none" | "q" | "break";
export type Total = number;
export type Remaining = number;
export type Endsat = number | null;
export type Running = boolean;
export type Done = boolean;
export type QuizName = string;
export type Seconds = number;
export type BreakMinutes = number;
export type AutoRead = boolean;
export type AutoTimer = boolean;
export type Id = string;
export type Name = string;
export type Phone = boolean;
export type Online = boolean;
export type Joker = number;
export type Adj = number;
export type Rounds1 = (number | null)[];
export type Total1 = number;
export type Rank = number;
export type Teams = TeamRow[];
export type Qk = string;
export type Team = string;
export type Answer = string;
export type A6 = string;
export type B = string;
export type Mark6 = number | null;
export type Src = ("peer" | "auto" | "host") | null;
export type Dispute = ("open" | "upheld" | "overturned") | null;
export type Level = "match" | "close";
export type Pts = number;
export type Warn = boolean | null;
export type Marker = string | null;
export type Off = number | null;
export type Rows = AnswerRow[];
export type Max = number;
export type Key = string;
export type Qk1 = string;
export type Team1 = string;
export type Teamname = string;
export type Marker1 = string | null;
export type Markername = string | null;
export type Question = string;
export type Round1 = number | null;
export type N = number;
export type Theirs = string;
export type Correct = string;
export type Note = string;
export type Reason = string;
export type From = number;
export type Max1 = number;
export type Disputes = DisputeFacts[];
export type Key1 = string;
export type Qk2 = string;
export type Team2 = string;
export type Teamname1 = string;
export type Marker2 = string | null;
export type Markername1 = string | null;
export type Question1 = string;
export type Round2 = number | null;
export type N1 = number;
export type Theirs1 = string;
export type Correct1 = string;
export type Note1 = string;
export type Reason1 = string;
export type From1 = number;
export type Max2 = number;
export type Phase = "showing" | "deliberating" | "verdict";
export type Pts1 = number | null;
export type Verdict = ("upheld" | "overturned") | null;
export type Parked = string[];
export type Online1 = boolean;
export type Soundready = boolean | null;
export type Playing = boolean | null;
export type Muted = boolean | null;
export type Lounge = boolean | null;
export type Volume = number | null;
export type Servertime = number;
export type Id1 = string;
export type Name1 = string;
export type Joker1 = number;
export type Id2 = string;
export type Name2 = string;
export type Markedby = string | null;
export type Type1 =
  | "title"
  | "rules"
  | "round"
  | "question"
  | "swap"
  | "answer"
  | "standings"
  | "halftime"
  | "tbIntro"
  | "tb"
  | "winner"
  | "end";
export type R1 = number | null;
export type Q5 = number | null;
export type T1 = number | null;
export type Index1 = number;
export type Revealed1 = boolean;
export type Quizname = string;
export type Rounds2 = number;
export type Title2 = string;
export type Icon5 = string | null;
export type Blurb1 = string | null;
export type Scoring1 = string | null;
export type Qk3 = string;
export type N2 = number;
export type Label = string;
export type Input = "text" | "music" | "ab" | "number";
export type R2 = number | null;
export type Icon6 = string | null;
export type Text2 = string | null;
export type Emoji3 = string | null;
export type Flag1 = string | null;
export type Cat1 = string | null;
export type Clue1 = string | null;
export type Hint3 = string | null;
export type Blabel = string | null;
export type Icon7 = string | null;
export type Text3 = string;
export type Standings = Standing[] | null;
export type Id3 = string;
export type Name3 = string;
export type Total2 = string;
export type Rank1 = number;
export type Qk4 = string;
export type Open = boolean;
export type A7 = string;
export type Sub = string;
export type Note2 = string;
export type Mark7 = number | null;
export type Src1 = ("peer" | "auto" | "host") | null;
export type Status = "open" | "upheld" | "overturned";
export type Sheet = SheetItem[];
export type Qk5 = string;
export type Their = string | null;
export type Max3 = number;
export type Mark8 = number | null;
export type Src2 = ("peer" | "auto" | "host") | null;
export type Marksheet = MarkItem[];
export type Servertime1 = number;
export type Code = string;
export type Joinurl = string;
export type Siteurl = string;

/**
 * Everything the frontend receives from the server.
 */
export interface Contract {
  quiz: Quiz;
  hostView: HostView;
  playerView: PlayerView;
  room: RoomInfo;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "Quiz".
 */
export interface Quiz {
  format?: Format;
  title: Title;
  rules?: Rules;
  rounds: Rounds;
  tiebreakers?: Tiebreakers;
  tunes?: Tunes;
  halftimeAfter?: Halftimeafter;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "Rule".
 */
export interface Rule {
  icon?: Icon;
  text: Text;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "Round".
 */
export interface Round {
  title: Title1;
  icon?: Icon1;
  kind: Kind;
  blurb?: Blurb;
  scoring?: Scoring;
  prompt?: Prompt;
  questions: Questions;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "StandardQ".
 */
export interface StandardQ {
  a: A;
  fact?: Fact;
  mark?: Mark;
  say?: Say;
  kind: Kind1;
  icon?: Icon2;
  q: Q;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "FlagQ".
 */
export interface FlagQ {
  a: A1;
  fact?: Fact1;
  mark?: Mark1;
  say?: Say1;
  kind: Kind2;
  flag?: Flag;
  emoji?: Emoji;
  q?: Q1;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "MusicQ".
 */
export interface MusicQ {
  a: A2;
  fact?: Fact2;
  mark?: Mark2;
  say?: Say2;
  kind: Kind3;
  tune?: Tune;
  emoji?: Emoji1;
  by: By;
  year?: Year;
  hint?: Hint;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "EmojiQ".
 */
export interface EmojiQ {
  a: A3;
  fact?: Fact3;
  mark?: Mark3;
  say?: Say3;
  kind: Kind4;
  emoji: Emoji2;
  q?: Q2;
  year?: Year1;
  hint?: Hint1;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "VowelsQ".
 */
export interface VowelsQ {
  a: A4;
  fact?: Fact4;
  mark?: Mark4;
  say?: Say4;
  kind: Kind5;
  cat: Cat;
  clue: Clue;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "VersusQ".
 */
export interface VersusQ {
  kind: Kind6;
  A: Side;
  B: Side;
  first: First;
  fact?: Fact5;
  mark?: Mark5;
  say?: Say5;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "Side".
 */
export interface Side {
  icon?: Icon3;
  text: Text1;
  date: Date;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "Tiebreaker".
 */
export interface Tiebreaker {
  icon?: Icon4;
  q: Q3;
  a: A5;
  say?: Say6;
  fact?: Fact6;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "Tune".
 */
export interface Tune1 {
  inst: Inst;
  unit: Unit;
  transpose?: Transpose;
  double?: Double;
  notes: Notes;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "HostView".
 */
export interface HostView {
  index: Index;
  slide: Slide;
  revealed: Revealed;
  hint: Hint2;
  rolling: Rolling;
  timer: TimerView;
  settings: GameSettings;
  teams: Teams;
  current: CurrentQuestion | null;
  pairings: Pairings;
  disputes: Disputes;
  theatre: Theatre | null;
  parked: Parked;
  tv: TvStatus;
  serverTime: Servertime;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "Slide".
 */
export interface Slide {
  type: Type;
  r?: R;
  q?: Q4;
  t?: T;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "TimerView".
 */
export interface TimerView {
  mode: Mode;
  total: Total;
  remaining: Remaining;
  endsAt: Endsat;
  running: Running;
  done: Done;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "GameSettings".
 */
export interface GameSettings {
  quiz_name: QuizName;
  seconds: Seconds;
  break_minutes: BreakMinutes;
  auto_read: AutoRead;
  auto_timer: AutoTimer;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "TeamRow".
 */
export interface TeamRow {
  id: Id;
  name: Name;
  phone: Phone;
  online: Online;
  joker: Joker;
  adj: Adj;
  manual: Manual;
  rounds: Rounds1;
  total: Total1;
  rank: Rank;
}
export interface Manual {
  [k: string]: number;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "CurrentQuestion".
 */
export interface CurrentQuestion {
  qk: Qk;
  rows: Rows;
  max: Max;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "AnswerRow".
 */
export interface AnswerRow {
  team: Team;
  answer: Answer;
  raw: AnswerPair | null;
  mark: Mark6;
  src: Src;
  dispute: Dispute;
  suggest?: Suggestion | null;
  warn?: Warn;
  marker?: Marker;
  off?: Off;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "AnswerPair".
 */
export interface AnswerPair {
  a: A6;
  b: B;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "Suggestion".
 */
export interface Suggestion {
  level: Level;
  pts: Pts;
}
export interface Pairings {
  [k: string]: string;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "DisputeFacts".
 */
export interface DisputeFacts {
  key: Key;
  qk: Qk1;
  team: Team1;
  teamName: Teamname;
  marker: Marker1;
  markerName: Markername;
  question: Question;
  round: Round1;
  n: N;
  theirs: Theirs;
  correct: Correct;
  note: Note;
  reason: Reason;
  from: From;
  max: Max1;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "Theatre".
 */
export interface Theatre {
  key: Key1;
  qk: Qk2;
  team: Team2;
  teamName: Teamname1;
  marker: Marker2;
  markerName: Markername1;
  question: Question1;
  round: Round2;
  n: N1;
  theirs: Theirs1;
  correct: Correct1;
  note: Note1;
  reason: Reason1;
  from: From1;
  max: Max2;
  phase: Phase;
  pts: Pts1;
  verdict: Verdict;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "TvStatus".
 */
export interface TvStatus {
  online: Online1;
  soundReady?: Soundready;
  playing?: Playing;
  muted?: Muted;
  lounge?: Lounge;
  volume?: Volume;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "PlayerView".
 */
export interface PlayerView {
  me: Me;
  slide: PlayerSlide;
  sheet: Sheet;
  markSheet: Marksheet;
  serverTime: Servertime1;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "Me".
 */
export interface Me {
  id: Id1;
  name: Name1;
  joker: Joker1;
  marking: TeamRef | null;
  markedBy: Markedby;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "TeamRef".
 */
export interface TeamRef {
  id: Id2;
  name: Name2;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "PlayerSlide".
 */
export interface PlayerSlide {
  type: Type1;
  r?: R1;
  q?: Q5;
  t?: T1;
  index: Index1;
  revealed: Revealed1;
  quizName: Quizname;
  rounds: Rounds2;
  timer: TimerView | null;
  round?: RoundInfo | null;
  question?: PublicQuestion | null;
  standings?: Standings;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "RoundInfo".
 */
export interface RoundInfo {
  title: Title2;
  icon?: Icon5;
  blurb?: Blurb1;
  scoring?: Scoring1;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "PublicQuestion".
 */
export interface PublicQuestion {
  qk: Qk3;
  n: N2;
  label: Label;
  input: Input;
  r?: R2;
  icon?: Icon6;
  text?: Text2;
  emoji?: Emoji3;
  flag?: Flag1;
  cat?: Cat1;
  clue?: Clue1;
  hint?: Hint3;
  bLabel?: Blabel;
  A?: VersusSide | null;
  B?: VersusSide | null;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "VersusSide".
 */
export interface VersusSide {
  icon?: Icon7;
  text: Text3;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "Standing".
 */
export interface Standing {
  id: Id3;
  name: Name3;
  total: Total2;
  rank: Rank1;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "SheetItem".
 */
export interface SheetItem {
  qk: Qk4;
  info: PublicQuestion;
  my: AnswerPair | null;
  open: Open;
  key: AnswerKey | null;
  mark: Mark7;
  src: Src1;
  dispute: DisputeBadge | null;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "AnswerKey".
 */
export interface AnswerKey {
  a: A7;
  sub: Sub;
  note: Note2;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "DisputeBadge".
 */
export interface DisputeBadge {
  status: Status;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "MarkItem".
 */
export interface MarkItem {
  qk: Qk5;
  info: PublicQuestion;
  key: AnswerKey;
  their: Their;
  max: Max3;
  mark: Mark8;
  src: Src2;
  dispute: DisputeBadge | null;
}
/**
 * This interface was referenced by `Contract`'s JSON-Schema
 * via the `definition` "RoomInfo".
 */
export interface RoomInfo {
  code: Code;
  joinUrl: Joinurl;
  siteUrl: Siteurl;
}
