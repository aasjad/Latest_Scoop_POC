/** WebSocket client for /ws/events with exponential-backoff reconnect. */
import { LIVE } from '@/config/constants';
import type { SocketState, WsMessage } from '@/types';
import type { LiveSocket } from './types';

const KNOWN_TYPES = new Set(['PERSON_COUNT_EVENT', 'TRACKS_UPDATE', 'CAMERA_STATUS', 'CAMERA_CONFIG']);

export class ReconnectingSocket implements LiveSocket {
  state: SocketState = 'closed';
  private ws: WebSocket | null = null;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private wanted = false;
  private msgHandlers = new Set<(m: WsMessage) => void>();
  private stateHandlers = new Set<(s: SocketState) => void>();

  constructor(private readonly url: string) {}

  private setState(s: SocketState) {
    if (this.state === s) return;
    this.state = s;
    for (const h of this.stateHandlers) h(s);
  }

  connect() {
    this.wanted = true;
    if (this.ws) return;
    this.setState(this.attempts === 0 ? 'connecting' : 'reconnecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;
    // Events from a socket this client has already replaced (close() then connect(),
    // e.g. React StrictMode re-running effects) must not touch the current one.
    const stale = () => this.ws !== ws;
    ws.onopen = () => {
      if (stale()) return;
      this.attempts = 0;
      this.setState('open');
    };
    ws.onmessage = (ev) => {
      if (stale()) return;
      let msg: unknown;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return; // ignore non-JSON frames (e.g. pings)
      }
      if (!msg || typeof msg !== 'object' || !KNOWN_TYPES.has((msg as { type?: string }).type ?? '')) return;
      for (const h of this.msgHandlers) h(msg as WsMessage);
    };
    ws.onclose = () => {
      if (stale()) return;
      this.ws = null;
      if (!this.wanted) return this.setState('closed');
      this.setState('reconnecting');
      const delay = Math.min(LIVE.reconnectMaxMs, LIVE.reconnectBaseMs * 2 ** this.attempts) * (0.8 + Math.random() * 0.4);
      this.attempts++;
      this.retryTimer = setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => ws.close();
  }

  close() {
    this.wanted = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.ws?.close();
    this.ws = null;
    this.setState('closed');
  }

  onMessage(h: (m: WsMessage) => void) {
    this.msgHandlers.add(h);
    return () => void this.msgHandlers.delete(h);
  }

  onStateChange(h: (s: SocketState) => void) {
    this.stateHandlers.add(h);
    return () => void this.stateHandlers.delete(h);
  }
}
