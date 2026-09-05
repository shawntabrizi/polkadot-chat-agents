// One EventSource on /api/events for the whole app. Screens subscribe to
// event types and refetch what changed; nothing polls. The daemon names its
// events (`event: message`), so each type is a listener, not `onmessage`.
import { useEffect, useRef } from 'react';

import type { SandboxEvent } from './api';

// Every type the daemon emits: store events, faults, node restarts, the HOP
// pool, the personas' engines, and the persona state changes
// (contact/request/room/message).
export const EVENT_TYPES = ['wire', 'fault', 'node', 'hop', 'engine', 'persona', 'contact', 'request', 'room', 'message', 'clock'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

type Listener = (event: SandboxEvent) => void;
const listeners = new Set<Listener>();
let source: EventSource | null = null;
let status: 'connecting' | 'open' | 'closed' = 'connecting';
const statusListeners = new Set<(s: typeof status) => void>();

function ensureSource() {
  if (source) return;
  source = new EventSource('./api/events');
  const setStatus = (s: typeof status) => {
    status = s;
    for (const fn of statusListeners) fn(s);
  };
  source.onopen = () => setStatus('open');
  source.onerror = () => setStatus(source?.readyState === EventSource.CLOSED ? 'closed' : 'connecting');
  for (const type of EVENT_TYPES) {
    source.addEventListener(type, raw => {
      const event = JSON.parse((raw as MessageEvent<string>).data) as SandboxEvent;
      for (const fn of listeners) fn(event);
    });
  }
}

/** Run `handler` for every event whose type is in `types` (all when omitted). The latest handler is used; no resubscription on re-render. */
export function useEvents(handler: Listener, types?: readonly EventType[]) {
  const latest = useRef(handler);
  latest.current = handler;
  const key = types?.join(',') ?? '*';
  useEffect(() => {
    ensureSource();
    const wanted = key === '*' ? null : new Set(key.split(','));
    const fn: Listener = event => {
      if (!wanted || wanted.has(event.type)) latest.current(event);
    };
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, [key]);
}

export function useConnection(onChange: (s: typeof status) => void) {
  useEffect(() => {
    ensureSource();
    onChange(status);
    statusListeners.add(onChange);
    return () => {
      statusListeners.delete(onChange);
    };
  }, [onChange]);
}
