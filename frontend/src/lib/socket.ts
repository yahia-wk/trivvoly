// One WebSocket per screen. Reconnects on its own after network blips; stops for good when the
// game ends, the team is removed, or the server says this screen isn't allowed.
import type { ServerMessage } from './types';

export type SocketStatus = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'needjoin' | 'kicked' | 'denied';

interface Handlers {
  onMessage: (msg: ServerMessage) => void;
  onStatus: (status: SocketStatus) => void;
}

const FINAL: SocketStatus[] = ['closed', 'needjoin', 'kicked', 'denied'];

export class RoomSocket {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: () => void; reject: (e: Error) => void; timer: number }>();
  private retry = 0;
  private stopped = false;
  private status: SocketStatus = 'connecting';

  constructor(
    private readonly code: string,
    private readonly role: 'host' | 'player',
    private readonly screen: 'tv' | 'remote' | 'phone',
    private readonly handlers: Handlers
  ) {}

  connect(): void {
    if (this.stopped) return;
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${scheme}://${location.host}/api/rooms/${this.code}/ws?role=${this.role}&screen=${this.screen}`);
    this.ws = ws;
    ws.onopen = () => { this.retry = 0; this.setStatus('open'); };
    ws.onmessage = e => {
      let msg: ServerMessage;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'result') return this.settle(msg.id, msg.ok, msg.error);
      if (msg.type === 'needjoin' || msg.type === 'kicked' || msg.type === 'closed') this.finish(msg.type);
      this.handlers.onMessage(msg);
    };
    ws.onclose = e => {
      this.failPending('Connection lost. Try again.');
      if (e.code === 4401 || e.code === 4403) this.finish('denied');
      if (this.stopped) return;
      this.setStatus('reconnecting');
      const delay = Math.min(5000, 500 * 2 ** this.retry++);
      window.setTimeout(() => this.connect(), delay);
    };
  }

  /** Send a command; resolves when the server accepts it, rejects with the server's explanation. */
  send(cmd: string, args: Record<string, unknown> = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return reject(new Error('Not connected right now. Reconnecting…'));
      const id = this.nextId++;
      const timer = window.setTimeout(() => this.settle(id, false, 'No answer from the server. Try again.'), 8000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ type: 'cmd', id, cmd, args }));
    });
  }

  close(): void {
    this.stopped = true;
    this.ws?.close();
  }

  private settle(id: number, ok: boolean, error?: string): void {
    const p = this.pending.get(id);
    if (!p) return;
    window.clearTimeout(p.timer);
    this.pending.delete(id);
    if (ok) p.resolve(); else p.reject(new Error(error || 'That didn’t work.'));
  }

  private failPending(message: string): void {
    for (const id of [...this.pending.keys()]) this.settle(id, false, message);
  }

  private finish(status: SocketStatus): void {
    this.stopped = true;
    this.setStatus(status);
  }

  private setStatus(s: SocketStatus): void {
    if (FINAL.includes(this.status) && !FINAL.includes(s)) return;
    this.status = s;
    this.handlers.onStatus(s);
  }
}
