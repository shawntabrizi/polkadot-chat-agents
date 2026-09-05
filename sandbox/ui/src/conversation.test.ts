// The Conversation screen must open on a pair that makes sense without a
// click, must never let a bot act (there is no bot-side inbox to act from),
// and must show each side the same request state the Requests screen shows.
import { describe, expect, it } from 'vitest';

import type { Account, HexString, Persona, RequestRow } from './api';
import { participantsOf, pickLeft, pickRight, readOnly, relationOf } from './conversation';

const hex = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as HexString;
const persona = (name: string, n: number): Persona => ({ name, account: hex(n), chatPublicKey: hex(n + 100), devices: [] });
const account = (username: string | null, n: number, messageable = true): Account => ({ account: hex(n), username, identifierKey: messageable ? hex(n + 200) : null, allowance: true });
const request = (over: Partial<RequestRow>): RequestRow => ({
  requestId: 'r',
  peer: hex(2),
  peerUsername: 'bob',
  direction: 'outgoing',
  status: 'pending',
  welcomeMessage: null,
  timestamp: 1,
  device: null,
  createdAt: 1,
  ...over,
});

const alice = persona('alice', 1);
const bob = persona('bob', 2);
const personas = [alice, bob];
const accounts = [account('alice', 1), account('bob', 2), account('echobot', 3), account(null, 4), account('ghost', 5, false)];
const participants = participantsOf(personas, accounts);

describe('participantsOf', () => {
  it('lists personas first, then every messageable directory account that is not a persona', () => {
    expect(participants.map(p => `${p.name}:${p.kind}`)).toEqual(['alice:persona', 'bob:persona', 'echobot:bot']);
  });
  it('leaves out accounts without a username or an identifier key: a request to them cannot be sent', () => {
    expect(participants.some(p => p.account === hex(4) || p.account === hex(5))).toBe(false);
  });
});

describe('readOnly', () => {
  it('is true for a bot only', () => {
    expect(readOnly(participants[2])).toBe(true);
    expect(readOnly(participants[0])).toBe(false);
    expect(readOnly(null)).toBe(false);
  });
});

describe('pickLeft', () => {
  it('keeps the stored persona', () => {
    expect(pickLeft(participants, 'bob', 'alice')).toBe('bob');
  });
  it('falls back to the active persona when the stored name is gone or is a bot', () => {
    expect(pickLeft(participants, 'carol', 'alice')).toBe('alice');
    expect(pickLeft(participants, 'echobot', 'alice')).toBe('alice');
  });
  it('is empty when there is no persona at all', () => {
    expect(pickLeft([], '', '')).toBe('');
  });
});

describe('pickRight', () => {
  const contacts = (...names: string[]) => names.map((username, i) => ({ account: hex(50 + i), username, devices: [], createdAt: 0, updatedAt: 0 }));
  it('keeps the stored choice while it exists and is not the left side', () => {
    expect(pickRight(participants, 'echobot', { name: 'alice', contacts: contacts('bob') })).toBe('echobot');
  });
  it('defaults to the left side’s first contact', () => {
    expect(pickRight(participants, '', { name: 'alice', contacts: contacts('echobot', 'bob') })).toBe('echobot');
    expect(pickRight(participants, 'alice', { name: 'alice', contacts: contacts('bob') })).toBe('bob');
  });
  it('skips a contact that is not listed any more, then takes anyone else', () => {
    expect(pickRight(participants, '', { name: 'alice', contacts: contacts('carol', 'bob') })).toBe('bob');
    expect(pickRight(participants, '', { name: 'alice', contacts: [] })).toBe('bob');
    expect(pickRight(participants, '', { name: 'bob', contacts: [] })).toBe('alice');
  });
  it('is empty until the left side is known, or when nobody else exists', () => {
    expect(pickRight(participants, 'bob', null)).toBe('');
    expect(pickRight([participants[0]!], '', { name: 'alice', contacts: [] })).toBe('');
  });
});

describe('relationOf', () => {
  const me = (requests: RequestRow[], contact = false) => ({ contacts: contact ? [{ account: hex(2), username: 'bob', devices: [], createdAt: 0, updatedAt: 0 }] : [], requests });
  it('is a contact once the peer is in the contact list, whatever the request history says', () => {
    expect(relationOf(me([request({ status: 'declined' })], true), hex(2))).toEqual({ state: 'contact' });
  });
  it('shows a pending request from the side that sent it and from the side that got it', () => {
    const out = request({ direction: 'outgoing' });
    const inc = request({ direction: 'incoming' });
    expect(relationOf(me([out]), hex(2))).toEqual({ state: 'sent', request: out });
    expect(relationOf(me([inc]), hex(2))).toEqual({ state: 'received', request: inc });
  });
  it('says who declined', () => {
    const mine = request({ direction: 'incoming', status: 'declined' });
    const theirs = request({ direction: 'outgoing', status: 'declined' });
    expect(relationOf(me([mine]), hex(2))).toEqual({ state: 'declined', by: 'me', request: mine });
    expect(relationOf(me([theirs]), hex(2))).toEqual({ state: 'declined', by: 'peer', request: theirs });
  });
  it('lets a fresh request after a refusal win, and ignores requests with other peers', () => {
    const old = request({ requestId: 'old', status: 'declined', createdAt: 1 });
    const fresh = request({ requestId: 'fresh', direction: 'incoming', createdAt: 2 });
    const other = request({ requestId: 'other', peer: hex(3), createdAt: 3 });
    expect(relationOf(me([old, other, fresh]), hex(2))).toEqual({ state: 'received', request: fresh });
    expect(relationOf(me([other]), hex(2))).toEqual({ state: 'none' });
  });
});
