// Who can sit on each side of the Conversation screen, which pair to show
// by default, and what one side sees of the other before they are contacts.
// Pure, so the choices are tested without a daemon.
import type { Account, HexString, Persona, PersonaDetail, RequestRow } from './api';

export type Participant = { name: string; account: HexString; kind: 'persona' | 'bot' };

/** Every persona, then every directory account that can be messaged and is not a persona: a bot. */
export function participantsOf(personas: Persona[], accounts: Account[]): Participant[] {
  const own = new Set<string>(personas.map(p => p.account));
  const bots: Participant[] = [];
  for (const a of accounts) if (a.username && a.identifierKey && !own.has(a.account)) bots.push({ name: a.username, account: a.account, kind: 'bot' });
  return [...personas.map((p): Participant => ({ name: p.name, account: p.account, kind: 'persona' })), ...bots];
}

/** A bot keeps its own inbox in its own process; the sandbox cannot show it, so its side is read-only. */
export const readOnly = (p: Participant | null | undefined): boolean => p?.kind === 'bot';

/** The left side: the stored choice while it is still a persona, else the active persona. */
export function pickLeft(participants: Participant[], stored: string, active: string): string {
  const persona = (name: string) => participants.some(p => p.name === name && p.kind === 'persona');
  return persona(stored) ? stored : persona(active) ? active : '';
}

/** The right side: the stored choice while it exists and is not the left; else the left's first contact; else anyone else. */
export function pickRight(participants: Participant[], stored: string, left: Pick<PersonaDetail, 'name' | 'contacts'> | null): string {
  if (!left) return '';
  const known = (name: string) => name !== left.name && participants.some(p => p.name === name);
  if (known(stored)) return stored;
  return left.contacts.map(c => c.username).find(known) ?? participants.find(p => p.name !== left.name)?.name ?? '';
}

export type Relation =
  | { state: 'contact' }
  | { state: 'none' }
  | { state: 'sent' | 'received'; request: RequestRow }
  | { state: 'declined'; by: 'me' | 'peer'; request: RequestRow };

/** What `me` has with `peer`: a room, a request in flight one way or the other, a refusal, or nothing. */
export function relationOf(me: Pick<PersonaDetail, 'contacts' | 'requests'>, peer: HexString): Relation {
  if (me.contacts.some(c => c.account === peer)) return { state: 'contact' };
  // The newest request decides: a refusal can be followed by a fresh request.
  const request = me.requests.filter(r => r.peer === peer).sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!request) return { state: 'none' };
  if (request.status === 'pending') return { state: request.direction === 'outgoing' ? 'sent' : 'received', request };
  if (request.status === 'declined') return { state: 'declined', by: request.direction === 'incoming' ? 'me' : 'peer', request };
  // Accepted but not in the contact list yet: the room exists as far as the engine is concerned.
  return { state: 'contact' };
}
