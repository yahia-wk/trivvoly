/* Generated from backend/trivvoly/quiz.py by `npm run gen:types`. Do not edit by hand. */

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
 * This interface was referenced by `Quiz`'s JSON-Schema
 * via the `definition` "Rule".
 */
export interface Rule {
  icon?: Icon;
  text: Text;
}
/**
 * This interface was referenced by `Quiz`'s JSON-Schema
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
 * This interface was referenced by `Quiz`'s JSON-Schema
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
 * This interface was referenced by `Quiz`'s JSON-Schema
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
 * This interface was referenced by `Quiz`'s JSON-Schema
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
 * This interface was referenced by `Quiz`'s JSON-Schema
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
 * This interface was referenced by `Quiz`'s JSON-Schema
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
 * This interface was referenced by `Quiz`'s JSON-Schema
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
 * This interface was referenced by `Quiz`'s JSON-Schema
 * via the `definition` "Side".
 */
export interface Side {
  icon?: Icon3;
  text: Text1;
  date: Date;
}
/**
 * This interface was referenced by `Quiz`'s JSON-Schema
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
 * This interface was referenced by `Quiz`'s JSON-Schema
 * via the `definition` "Tune".
 */
export interface Tune1 {
  inst: Inst;
  unit: Unit;
  transpose?: Transpose;
  double?: Double;
  notes: Notes;
}
