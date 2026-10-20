// Reading questions and answers aloud with the browser's built-in voices.
import { questionOf } from '../../lib/slides';
import type { Quiz, Slide } from '../../lib/types';

let voiceCache: SpeechSynthesisVoice | false | null = null;
const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
if (supported) speechSynthesis.onvoiceschanged = () => { voiceCache = null; };

function pickVoice(): SpeechSynthesisVoice | null {
  if (voiceCache !== null) return voiceCache || null;
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return null;
  const en = voices.filter(v => /^en/i.test(v.lang));
  const preferred = en.find(v => /natural|neural|google uk|google us|daniel|samantha|serena|aria|jenny|libby|sonia/i.test(v.name));
  voiceCache = preferred || en[0] || false;
  return voiceCache || null;
}

export function stopSpeech(): void { if (supported) speechSynthesis.cancel(); }

/** Speak `text`; `onEnd` runs when it finishes (or straight away if speech isn't possible). */
export function speak(text: string, { volume, muted, onEnd }: { volume: number; muted: boolean; onEnd?: () => void }): string | null {
  const done = () => onEnd?.();
  if (!text) { done(); return null; }
  if (!supported) { done(); return 'This browser can’t read aloud.'; }
  if (muted) { done(); return null; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.95; u.volume = Math.min(1, volume + 0.3);
  const v = pickVoice(); if (v) u.voice = v;
  let fired = false;
  const once = () => { if (!fired) { fired = true; done(); } };
  u.onend = once; u.onerror = once;
  window.setTimeout(() => speechSynthesis.speak(u), 60);
  return null;
}

export function questionSpeech(quiz: Quiz, s: Slide): string {
  if (s.type === 'tb') return (quiz.tiebreakers ?? [])[s.t!]?.q ?? '';
  if (s.type === 'round') return `Round ${s.r! + 1}. ${quiz.rounds[s.r!].title}.`;
  const q = questionOf(quiz, s);
  if (!q) return '';
  const n = s.q! + 1;
  switch (q.kind) {
    case 'music': return q.tune != null ? `Track ${n}. Name the piece, with a bonus point for the composer.` : `Track ${n}. Name the song from these emoji, with a bonus point for the artist.`;
    case 'flag': return q.q || `Flag ${n}. Which country does this flag belong to?`;
    case 'emoji': return `Film ${n}. Name the film from these emoji.`;
    case 'vowels': return `Puzzle ${n}. The category is ${q.cat}.`;
    case 'versus': return `Which came first? A: ${q.A.text}. Or B: ${q.B.text}.`;
    default: return q.q;
  }
}

export function answerSpeech(quiz: Quiz, s: Slide): string {
  if (s.type === 'tb') { const t = (quiz.tiebreakers ?? [])[s.t!]; return t ? `The answer is ${t.say || t.a}.` : ''; }
  if (s.type !== 'answer') return '';
  const q = questionOf(quiz, s)!;
  if (q.kind === 'versus') { const w = q.first === 'a' ? q.A : q.B; return `It's ${q.first.toUpperCase()}. ${w.text}, in ${w.date.replace('c. ', 'around ')}.`; }
  if (q.kind === 'music') return `It's ${q.a}, by ${q.by}.`;
  return `The answer is ${q.say || q.a}.`;
}
