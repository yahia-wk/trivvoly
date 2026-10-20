// Shared by the quizmaster's two screens (TV and phone remote).
import { useMemo } from 'react';
import { buildSlides, isRevealable, questionOf } from './slides';
import type { HostView, Question, Quiz, Slide, Tiebreaker } from './types';
import { useQuizmasterAccess } from './quizmaster';
import { useRoom, type RoomConnection } from './useRoom';
import type { ServerMessage } from './types';

export interface HostRoom extends RoomConnection<HostView> {
  access: { ready: boolean; error: string | null };
  slides: Slide[];
  slide: Slide | null;
  question: Question | null;
  tiebreaker: Tiebreaker | null;
  nextLabel: string;
  canPrev: boolean;
  canNext: boolean;
}

export function useHostRoom(code: string, screen: 'tv' | 'remote', onEvent?: (msg: ServerMessage) => void): HostRoom {
  const access = useQuizmasterAccess(code);
  const conn = useRoom<HostView>(code, 'host', screen, onEvent, access.ready);
  const slides = useMemo(() => (conn.quiz ? buildSlides(conn.quiz) : []), [conn.quiz]);
  const view = conn.view, quiz = conn.quiz;
  const slide = view && slides.length ? slides[view.index] ?? null : null;
  const question = quiz && slide ? questionOf(quiz, slide) : null;
  const tiebreaker = quiz && slide?.type === 'tb' ? (quiz.tiebreakers ?? [])[slide.t!] ?? null : null;
  const pending = !!slide && isRevealable(slide) && !!view && !view.revealed;
  return {
    ...conn, access, slides, slide, question, tiebreaker,
    nextLabel: pending ? (slide!.type === 'winner' ? 'Drumroll' : 'Reveal') : 'Next',
    canPrev: !!view && view.index > 0 && !view.rolling && !view.theatre,
    canNext: !!view && (view.index < slides.length - 1 || pending) && !view.rolling && !view.theatre
  };
}

export const teamName = (view: HostView, id: string | null | undefined) => view.teams.find(t => t.id === id)?.name ?? 'A team';
export const ptsText = (v: number, max: number) => (max > 1 ? String(v) : v ? '✓' : '✗');
export const quizName = (view: HostView | null, quiz: Quiz | null) => view?.settings.quiz_name || quiz?.title || 'Trivvoly';
