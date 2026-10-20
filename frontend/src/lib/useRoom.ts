// React hook: connect a screen to its room and keep the latest view, quiz and room info.
import { useCallback, useEffect, useRef, useState } from 'react';
import { RoomSocket, type SocketStatus } from './socket';
import { syncClock } from './clock';
import type { Quiz, RoomInfo, ServerMessage } from './types';

export interface RoomConnection<V> {
  status: SocketStatus;
  view: V | null;
  quiz: Quiz | null;
  room: RoomInfo | null;
  send: (cmd: string, args?: Record<string, unknown>) => Promise<void>;
}

export function useRoom<V extends { serverTime: number }>(
  code: string,
  role: 'host' | 'player',
  screen: 'tv' | 'remote' | 'phone',
  onEvent?: (msg: ServerMessage) => void,
  enabled = true
): RoomConnection<V> {
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const [view, setView] = useState<V | null>(null);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const socket = useRef<RoomSocket | null>(null);
  const eventRef = useRef(onEvent);
  eventRef.current = onEvent;

  useEffect(() => {
    if (!enabled) return;
    const s = new RoomSocket(code, role, screen, {
      onStatus: setStatus,
      onMessage: msg => {
        if (msg.type === 'state') {
          const v = msg.view as unknown as V;
          syncClock(v.serverTime);
          setView(v);
        } else if (msg.type === 'quiz') {
          setQuiz(msg.quiz);
          setRoom(msg.room);
        }
        eventRef.current?.(msg);
      }
    });
    socket.current = s;
    s.connect();
    return () => s.close();
  }, [code, role, screen, enabled]);

  const send = useCallback((cmd: string, args: Record<string, unknown> = {}) => {
    return socket.current ? socket.current.send(cmd, args) : Promise.reject(new Error('Not connected.'));
  }, []);

  return { status, view, quiz, room, send };
}
