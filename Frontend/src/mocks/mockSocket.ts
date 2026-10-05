/** MOCK ONLY — LiveSocket fed by the simulator, with a "drop connection" demo control. */
import type { LiveSocket } from '@/api/types';
import type { SocketState, WsMessage } from '@/types';
import { subscribeSimulator } from './simulator';

class MockSocket implements LiveSocket {
  state: SocketState = 'closed';
  private msgHandlers = new Set<(m: WsMessage) => void>();
  private stateHandlers = new Set<(s: SocketState) => void>();
  private unsub: (() => void) | null = null;

  private setState(s: SocketState) {
    this.state = s;
    for (const h of this.stateHandlers) h(s);
  }

  connect() {
    if (this.unsub) return;
    this.setState(this.state === 'closed' ? 'connecting' : 'reconnecting');
    setTimeout(() => {
      this.unsub = subscribeSimulator((m) => {
        for (const h of this.msgHandlers) h(m);
      });
      this.setState('open');
    }, 450);
  }

  close() {
    this.unsub?.();
    this.unsub = null;
    this.setState('closed');
  }

  /** Demo: drop the connection and auto-reconnect after `ms`. */
  simulateDrop(ms = 4000) {
    this.unsub?.();
    this.unsub = null;
    this.setState('reconnecting');
    setTimeout(() => this.connect(), ms);
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

export const mockSocket = new MockSocket();
