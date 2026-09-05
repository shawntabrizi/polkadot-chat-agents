// A message row's delivery state as one short line. Outgoing rows carry the
// SDK's status and the device that sent them; incoming rows carry which of
// our devices received the statement and which ACKed it — the per-device
// facts the sandbox exists to show.
import type { Message } from './api';

export type StatusLine = { text: string; tone: 'muted' | 'ok' | 'error' };

const OUTGOING: Record<string, StatusLine> = {
  sending: { text: 'sending', tone: 'muted' },
  sent: { text: 'sent', tone: 'muted' },
  delivered: { text: 'delivered', tone: 'ok' },
  failed: { text: 'failed', tone: 'error' },
  pending: { text: 'pending', tone: 'muted' },
};

const devices = (list: number[]) => list.map(d => `#${d}`).join(',');

export function statusOf(m: Pick<Message, 'direction' | 'status' | 'device' | 'receivedBy' | 'ackedBy' | 'read'>): StatusLine | null {
  if (m.direction === 'outgoing') {
    const base = OUTGOING[m.status] ?? { text: m.status, tone: 'muted' as const };
    return { ...base, text: m.device ? `${base.text} from ${devices([m.device])}` : base.text };
  }
  if (m.direction === 'incoming') {
    const parts = [m.receivedBy.length ? `on ${devices(m.receivedBy)}` : 'not received'];
    if (m.ackedBy.length) parts.push(`acked ${devices(m.ackedBy)}`);
    if (!m.read) parts.push('unread');
    // Every receiving device ACKed: the peer will see delivery. Otherwise there is a device the peer is still waiting on.
    const complete = m.receivedBy.length > 0 && m.receivedBy.every(d => m.ackedBy.includes(d));
    return { text: parts.join(' · '), tone: complete ? 'ok' : 'muted' };
  }
  return null;
}
