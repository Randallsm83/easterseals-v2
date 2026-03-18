export interface LiveEvent {
  type: 'click' | 'start' | 'end' | 'heartbeat';
  sessionId: string;
  timestamp: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: Record<string, any>;
}

type Callback = (event: LiveEvent) => void;

const listeners = new Map<string, Set<Callback>>();

export function subscribe(sessionId: string, cb: Callback): () => void {
  if (!listeners.has(sessionId)) {
    listeners.set(sessionId, new Set());
  }
  listeners.get(sessionId)!.add(cb);

  return () => {
    const set = listeners.get(sessionId);
    if (set) {
      set.delete(cb);
      if (set.size === 0) listeners.delete(sessionId);
    }
  };
}

export function emit(sessionId: string, event: LiveEvent) {
  const set = listeners.get(sessionId);
  if (!set) return;
  for (const cb of set) {
    try {
      cb(event);
    } catch {
      // ignore
    }
  }
}

export function listenerCount(sessionId: string): number {
  return listeners.get(sessionId)?.size ?? 0;
}
