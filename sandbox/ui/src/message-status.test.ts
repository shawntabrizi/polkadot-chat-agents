// The status line is how a person reads the per-device facts the sandbox
// exists to show: which device sent, which received, which ACKed.
import { describe, expect, it } from 'vitest';

import { statusOf } from './message-status';

const row = (over: Partial<Parameters<typeof statusOf>[0]>) => ({ direction: 'incoming' as const, status: 'received' as const, device: null, receivedBy: [], ackedBy: [], read: true, ...over });

describe('statusOf', () => {
  it('names the sending device of an outgoing row and its delivery state', () => {
    expect(statusOf(row({ direction: 'outgoing', status: 'sending', device: 2 }))).toEqual({ text: 'sending from #2', tone: 'muted' });
    expect(statusOf(row({ direction: 'outgoing', status: 'sent', device: 1 }))).toEqual({ text: 'sent from #1', tone: 'muted' });
    expect(statusOf(row({ direction: 'outgoing', status: 'delivered', device: 1 }))).toEqual({ text: 'delivered from #1', tone: 'ok' });
    expect(statusOf(row({ direction: 'outgoing', status: 'failed', device: 1 }))).toEqual({ text: 'failed from #1', tone: 'error' });
  });
  it('lists the devices that received and ACKed an incoming row, and whether it was read', () => {
    expect(statusOf(row({ receivedBy: [1, 2], ackedBy: [1], read: false }))).toEqual({ text: 'on #1,#2 · acked #1 · unread', tone: 'muted' });
    expect(statusOf(row({ receivedBy: [1, 2], ackedBy: [1, 2] }))).toEqual({ text: 'on #1,#2 · acked #1,#2', tone: 'ok' });
    expect(statusOf(row({ receivedBy: [] }))).toEqual({ text: 'not received', tone: 'muted' });
  });
  it('has nothing to say about a system row', () => {
    expect(statusOf(row({ direction: 'system' }))).toBeNull();
  });
});
