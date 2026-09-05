// The control API, as the UI sees it. Every call goes under /api: the Vite
// dev server proxies that prefix to the daemon, and the daemon strips it.
// Nothing here is a secret: the API returns public halves only.

export type HexString = `0x${string}`;

export type Device = { index: number; account: HexString; encryptionPublicKey: HexString; online: boolean; removed: boolean };
export type Persona = { name: string; account: HexString; chatPublicKey: HexString; bulletinAccount: HexString; devices: Device[] };
export type ContactDevice = { statementAccountId: HexString; encryptionPublicKey: HexString };
export type Contact = { account: HexString; username: string; devices: ContactDevice[]; createdAt: number; updatedAt: number };
export type Room = { peer: HexString; unreadCount: number; lastMessageAt: number; lastPreview: string; createdAt: number; updatedAt: number; peerName?: string | null };
export type RequestRow = {
  requestId: string;
  peer: HexString;
  peerUsername: string;
  direction: 'incoming' | 'outgoing';
  status: 'pending' | 'accepted' | 'declined';
  welcomeMessage: string | null;
  timestamp: number;
  device: number | null;
  createdAt: number;
};
export type PersonaDetail = Persona & { contacts: Contact[]; rooms: Room[]; requests: RequestRow[] };
export type Account = { account: HexString; username: string | null; identifierKey: HexString | null; allowance: boolean };

// A HOP attachment as a row carries it: the public reference (never the
// claim ticket) and where its bytes are from this persona's side.
export type Attachment = {
  kind: 'general' | 'image' | 'video';
  mimeType: string;
  fileSize: number;
  width?: number;
  height?: number;
  duration?: number;
  identifier: HexString;
  wssUrl: string | null;
  chunks?: HexString[];
  status: 'sent' | 'pending' | 'claiming' | 'claimed' | 'failed';
  claimedBy: number | null;
  mediaId: string | null;
  error: string | null;
};
export type Content =
  | { type: 'text'; text: string }
  | { type: 'reply'; messageId: string; text: string }
  | { type: 'richText'; text: string | null; attachments: Attachment[] }
  | { type: 'contactAdded' }
  | { type: 'leftChat' }
  | { type: 'callOffer' }
  | { type: 'callDeclined'; offerMessageId?: string }
  | { type: 'unsupported'; tag: string };
export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'failed' | 'received' | 'pending';
export type Message = {
  messageId: string;
  peer: HexString;
  timestamp: number;
  direction: 'incoming' | 'outgoing' | 'system';
  status: MessageStatus;
  content: Content;
  reactions: { emoji: string; by: 'me' | 'peer' }[];
  editedAt: number | null;
  device: number | null;
  receivedBy: number[];
  ackedBy: number[];
  read: boolean;
};
export type RoomView = { persona: string; device: number | null; peer: HexString; peerName: string | null; room: Room | null; contact: Contact | null; messages: Message[] };

export type Fault = { id: number; kind: 'drop' | 'delay' | 'holdDump'; signer: HexString[] | null; channel: HexString | null; topic: HexString | null; ms?: number; count: number | null; hits: number; held: number };
export type NodeInfo = { url: string; hopUrl: string; statements: number; allowances: number; limits: Record<string, number>; clock: { offsetMs: number }; faults: Fault[] };

// The HOP pool: entries never carry bytes; a persona that uploaded or claimed one names its role and conversation.
export type HopEntry = {
  hash: HexString;
  bytes: number;
  signer: HexString | null;
  signerLabel: string | null;
  recipients: number;
  submittedAt: string;
  claims: number;
  claimedAt: string | null;
  acked: boolean;
  available: boolean;
  removedAt?: string;
  reason?: string;
  role?: string;
  owner?: string;
  messageId?: string | null;
};
export type HopFaultKind = 'refuse' | 'cut' | 'delay' | 'drop' | 'corrupt' | 'bloat';
export type HopFault = { id: number; kind: HopFaultKind; method: 'submit' | 'claim' | 'ack'; hash: HexString | null; count: number | null; hits: number; ms?: number; bytes?: number };
export type HopView = { url: string; limits: Record<string, number>; status: { entryCount: number; totalBytes: number; maxBytes: number }; entries: HopEntry[]; faults: HopFault[] };

// The wire shows every kind the codec knows (reactions, edits, roster changes...), not only inbox rows.
export type DecodedMessage = { messageId: string; timestamp: number; content: { type: string; [key: string]: unknown } } | { undecodable: true; bytes: number; error: string };
export type Decoded =
  | { kind: 'request'; requestId?: string; messages?: DecodedMessage[]; multiDevice?: boolean; recipients?: { statementAccountId: HexString; label: string | null }[]; sealed?: boolean }
  | { kind: 'response'; requestId?: string; responseCode?: string; multiDevice?: boolean; recipients?: { statementAccountId: HexString; label: string | null }[]; sealed?: boolean }
  | { kind: 'chatRequest'; requestId?: string; timestamp?: number; welcome?: string | null; sender?: { account: HexString; label: string | null; device: HexString | null }; sealed?: boolean; undecodable?: boolean }
  | { kind: 'undecryptable' | 'undecodable'; error?: string };
export type Statement = {
  signer: HexString | null;
  signerLabel: string | null;
  channel: HexString | null;
  channelLabel: string | null;
  topics: { hex: HexString; label: string | null }[];
  expiry: string;
  expiresAt: string | null;
  sequence: number;
  bytes: number;
  receivedAt: string | null;
  replacedCount: number;
  replacedAt?: string | null;
  reason?: string | null;
  parties: string[];
  decoded: Decoded | null;
  acks?: { by: string; code: string; at: string | null; live: boolean }[];
  hex?: string;
};

export type SandboxEvent = { seq: number; ts: string; type: string; [key: string]: unknown };

const BASE = './api';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(method: string, route: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + route, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `${method} ${route} failed (${res.status})`);
  return data;
}

const q = (params: Record<string, string | number | null | undefined>) => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') search.set(k, String(v));
  const s = search.toString();
  return s ? `?${s}` : '';
};
const enc = encodeURIComponent;

export const api = {
  node: () => call<NodeInfo>('GET', '/node'),
  wire: (filter: { peer?: string; signer?: string; channel?: string; topic?: string }) => call<{ statements: Statement[] }>('GET', `/wire${q(filter)}`).then(r => r.statements),
  history: (channel: string, signer?: string) => call<{ history: Statement[] }>('GET', `/wire/history${q({ channel, signer })}`).then(r => r.history),
  faults: () => call<Fault[]>('GET', '/faults'),
  addFault: (body: { kind: string; from?: string | null; channel?: string | null; topic?: string | null; count?: number | null; ms?: number }) => call<Fault>('POST', '/faults', body),
  clearFault: (id: number | 'all') => call<{ cleared: number }>('DELETE', `/faults/${id}`),
  clock: (offsetMs: number) => call<{ offsetMs: number }>('POST', '/clock', offsetMs === 0 ? { reset: true } : { offsetMs }),
  restartNode: () => call<{ ok: true }>('POST', '/node/restart'),
  resetNode: () => call<{ ok: true }>('POST', '/node/reset'),
  hop: () => call<HopView>('GET', '/hop'),
  addHopFault: (body: { kind: HopFaultKind; hash?: string | null; method?: string | null; count?: number | null; ms?: number }) => call<HopFault>('POST', '/hop/faults', body),
  clearHopFault: (id: number | 'all') => call<{ cleared: number }>('DELETE', `/hop/faults/${id}`),
  accounts: () => call<Account[]>('GET', '/accounts'),
  personas: () => call<Persona[]>('GET', '/personas'),
  persona: (name: string) => call<PersonaDetail>('GET', `/personas/${enc(name)}`),
  addPersona: (name: string, devices: number) => call<Persona>('POST', '/personas', { name, devices }),
  addDevice: (name: string) => call<Device>('POST', `/personas/${enc(name)}/devices`),
  request: (name: string, to: string, welcome: string | null, device: number) => call<{ requestId: string }>('POST', `/personas/${enc(name)}/requests`, { to, welcome, device }),
  requests: (name: string) => call<RequestRow[]>('GET', `/personas/${enc(name)}/requests`),
  answer: (name: string, requestId: string, action: 'accept' | 'decline', device: number) => call<RequestRow>('POST', `/personas/${enc(name)}/requests/${enc(requestId)}/${action}`, { device }),
  rooms: (name: string) => call<Room[]>('GET', `/personas/${enc(name)}/rooms`),
  room: (name: string, peer: string) => call<RoomView>('GET', `/personas/${enc(name)}/rooms/${enc(peer)}`),
  markRead: (name: string, peer: string) => call<{ ok: true }>('POST', `/personas/${enc(name)}/rooms/${enc(peer)}/read`),
  send: (name: string, peer: string, body: { text: string; replyTo?: string | null; device: number }) => call<Message>('POST', `/personas/${enc(name)}/rooms/${enc(peer)}/messages`, body),
  react: (name: string, peer: string, messageId: string, emoji: string, add: boolean, device: number) => call<Message>('POST', `/personas/${enc(name)}/rooms/${enc(peer)}/messages`, { react: { messageId, emoji, add }, device }),
  edit: (name: string, peer: string, messageId: string, text: string, device: number) => call<Message>('POST', `/personas/${enc(name)}/rooms/${enc(peer)}/messages`, { edit: { messageId, text }, device }),
};

export const errorText = (cause: unknown, fallback: string) => (cause instanceof Error ? cause.message : fallback);
