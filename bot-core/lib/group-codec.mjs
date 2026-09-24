// Spec 0011 private groups v2: the SCALE codec of what goes on the group
// topic (polkadot-chat-desktop docs/spec/0011-groups-v2.md, bytes pinned in
// docs/spec/vectors-0011.md). The pairwise control kind (249) lives in
// vendor/app-chat-codec.mjs with the other content kinds; this module holds
// the statement payloads, which are not a content kind.
//
//   GroupData     = enum { messages(Sealed) = 0, state(Sealed) = 1, rekey(Rekey) = 2 }
//   Sealed        = { nonce: [u8; 12], ciphertext: Vec<u8> }
//   GroupMessages = { from: AccountId, topic: Option<u32>, messages: Vec<Vec<u8>> }
//   GroupState    = { groupId, epoch: u32, version: u32, name, avatar: Option<[u8; 32]>,
//                     defaultPermissions: u16, slowModeSecs: u32, joinPolicy: u8,
//                     historyShare: u8, members: Vec<Member>, invites: Vec<Invite>,
//                     pinned: Vec<String>, topics: Option<Vec<u8>>, createdAt: u64 }
//   Member        = { account, role: u8, permissions: u16, posting: Vec<AccountId>, joinedAt: u64 }
//   Invite        = { inviteId: [u8; 16], secret: [u8; 16], createdBy, expiresAt: u64, maxUses: u32, uses: u32 }
//   Rekey         = { newEpoch: u32, entries: Vec<RekeyEntry> }
//   RekeyEntry    = { hint: [u8; 8], nonce: [u8; 12], box: [u8; 48] }
//   InviteLink    = { groupId, name, admins: Vec<AccountId>, inviteId: [u8; 16], secret: [u8; 16] }
//
// Decoders enforce the vectors' bounds and reject trailing bytes. Accounts
// are carried as lowercase hex without 0x (the rest of bot-core's convention).

export const GROUP_DATA = Object.freeze({ messages: 0, state: 1, rekey: 2 });
export const GROUP_BOUNDS = Object.freeze({
  members: 1024,        // the format; v2 admits at most GROUP_MEMBER_CAP
  posting: 8,
  invites: 16,
  pinned: 10,
  nameBytes: 240,
  noteBytes: 560,
  plaintext: 4096,      // GroupMessages plaintext
  stateBytes: 64 * 1024,
  entries: 1024,
  historyShare: 100,
});
export const GROUP_MEMBER_CAP = 256; // reviewer default for v2 (0011 Limits)
export const PERMISSIONS = Object.freeze({
  post: 0x0001, add: 0x0002, pin: 0x0004, info: 0x0008,
  remove: 0x0010, approve: 0x0020, admins: 0x0040, delete: 0x0080,
});
export const ROLES = Object.freeze({ member: 0, admin: 1, owner: 2 });
export const ALL_PERMISSIONS = 0x00ff;

const te = new TextEncoder();
const td = new TextDecoder("utf-8", { fatal: true });
const norm = (h) => String(h ?? "").trim().replace(/^0x/i, "").toLowerCase();
export const toBytes = (v, len, name) => {
  const b = typeof v === "string" ? Uint8Array.from(Buffer.from(norm(v), "hex")) : v;
  if (!(b instanceof Uint8Array) || (len != null && b.length !== len)) throw new Error(`${name} must be ${len} bytes`);
  return b;
};
const hexOf = (b) => Buffer.from(b).toString("hex");
export const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

// ---------- SCALE primitives ----------
export const compact = (n) => {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`bad compact ${n}`);
  if (n < 1 << 6) return Uint8Array.of(n << 2);
  if (n < 1 << 14) return Uint8Array.of(((n << 2) | 1) & 0xff, (n << 2 | 1) >> 8);
  if (n < 2 ** 30) { const v = n * 4 + 2; return Uint8Array.of(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff); }
  throw new Error("compact too large");
};
export const u8 = (n) => { if (!Number.isInteger(n) || n < 0 || n > 0xff) throw new Error(`bad u8 ${n}`); return Uint8Array.of(n); };
export const u16 = (n) => { if (!Number.isInteger(n) || n < 0 || n > 0xffff) throw new Error(`bad u16 ${n}`); return Uint8Array.of(n & 0xff, n >> 8); };
export const u32 = (n) => {
  if (!Number.isInteger(n) || n < 0 || n > 0xffff_ffff) throw new Error(`bad u32 ${n}`);
  return Uint8Array.of(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
};
export const u64 = (n) => {
  let v = BigInt(n);
  if (v < 0n || v >= 1n << 64n) throw new Error(`bad u64 ${n}`);
  const out = new Uint8Array(8);
  for (let i = 0; i < 8; i += 1) { out[i] = Number(v & 0xffn); v >>= 8n; }
  return out;
};
export const bytes = (b) => concat(compact(b.length), b);
export const str = (s, maxBytes = Infinity, name = "string") => {
  const b = te.encode(String(s));
  if (b.length > maxBytes) throw new Error(`${name} exceeds ${maxBytes} bytes`);
  return bytes(b);
};
export const vec = (items) => concat(compact(items.length), ...items);
export const option = (inner) => (inner == null ? Uint8Array.of(0) : concat(Uint8Array.of(1), inner));

// A cursor over bytes; every read checks bounds.
export const reader = (b) => {
  let o = 0;
  const need = (n, what) => { if (o + n > b.length) throw new Error(`${what}: buffer ends at ${o}`); };
  const r = {
    get offset() { return o; },
    done: () => o === b.length,
    end(what) { if (o !== b.length) throw new Error(`${what}: ${b.length - o} trailing bytes`); },
    fixed(n, what) { need(n, what); const v = b.slice(o, o + n); o += n; return v; },
    u8(what) { need(1, what); return b[o++]; },
    u16(what) { need(2, what); const v = b[o] | (b[o + 1] << 8); o += 2; return v; },
    u32(what) { need(4, what); const v = (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000; o += 4; return v; },
    u64(what) {
      need(8, what);
      let v = 0n;
      for (let i = 7; i >= 0; i -= 1) v = (v << 8n) | BigInt(b[o + i]);
      o += 8;
      if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${what}: u64 beyond 2^53`);
      return Number(v);
    },
    compact(what) {
      need(1, what);
      const mode = b[o] & 3;
      if (mode === 0) { const v = b[o] >> 2; o += 1; return v; }
      if (mode === 1) { need(2, what); const v = (b[o] | (b[o + 1] << 8)) >> 2; o += 2; if (v < 64) throw new Error(`${what}: non-canonical compact`); return v; }
      if (mode === 2) { need(4, what); const v = ((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000) / 4; o += 4; if (v < 1 << 14) throw new Error(`${what}: non-canonical compact`); return Math.floor(v); }
      throw new Error(`${what}: compact too large`);
    },
    bytes(max, what) { const n = r.compact(what); if (n > max) throw new Error(`${what} exceeds ${max} bytes`); return r.fixed(n, what); },
    str(max, what) { return td.decode(r.bytes(max, what)); },
    vec(max, item, what) {
      const n = r.compact(what);
      if (n > max) throw new Error(`${what} exceeds ${max} items`);
      const out = [];
      for (let i = 0; i < n; i += 1) out.push(item(r));
      return out;
    },
    option(inner, what) {
      const tag = r.u8(what);
      if (tag === 0) return null;
      if (tag !== 1) throw new Error(`${what}: bad option tag ${tag}`);
      return inner(r);
    },
  };
  return r;
};

// ---------- Sealed / GroupData ----------
export const encodeSealed = ({ nonce, ciphertext }) => concat(toBytes(nonce, 12, "nonce"), bytes(ciphertext));
const readSealed = (r) => ({ nonce: r.fixed(12, "nonce"), ciphertext: r.bytes(128 * 1024, "ciphertext") });

const readRekeyEntry = (r) => ({ hint: r.fixed(8, "hint"), nonce: r.fixed(12, "entry nonce"), box: r.fixed(48, "entry box") });
export const encodeRekey = ({ newEpoch, entries }) => {
  if (entries.length > GROUP_BOUNDS.entries) throw new Error("too many rekey entries");
  // Sorted by hint (0011): a receiver may binary-search, and the order hides
  // nothing about the roster.
  const sorted = [...entries].sort((a, b) => Buffer.compare(Buffer.from(a.hint), Buffer.from(b.hint)));
  return concat(u32(newEpoch), vec(sorted.map((e) => concat(toBytes(e.hint, 8, "hint"), toBytes(e.nonce, 12, "entry nonce"), toBytes(e.box, 48, "entry box")))));
};
const readRekey = (r) => ({ newEpoch: r.u32("newEpoch"), entries: r.vec(GROUP_BOUNDS.entries, readRekeyEntry, "rekey entries") });

export const encodeGroupData = (d) => {
  if (d.messages) return concat(Uint8Array.of(GROUP_DATA.messages), encodeSealed(d.messages));
  if (d.state) return concat(Uint8Array.of(GROUP_DATA.state), encodeSealed(d.state));
  if (d.rekey) return concat(Uint8Array.of(GROUP_DATA.rekey), encodeRekey(d.rekey));
  throw new Error("GroupData needs messages, state or rekey");
};
export const decodeGroupData = (b) => {
  const r = reader(b);
  const tag = r.u8("GroupData");
  let out;
  if (tag === GROUP_DATA.messages) out = { kind: "messages", sealed: readSealed(r) };
  else if (tag === GROUP_DATA.state) out = { kind: "state", sealed: readSealed(r) };
  else if (tag === GROUP_DATA.rekey) out = { kind: "rekey", rekey: readRekey(r) };
  else throw new Error(`unknown GroupData variant ${tag}`);
  r.end("GroupData");
  return out;
};

// ---------- GroupMessages ----------
// `messages` are opaque messages exactly as in a DM request (compact length +
// remote message); the caller decodes them with decodeOpaqueMessageAt.
export const encodeGroupMessages = ({ from, messages }) => {
  const out = concat(toBytes(from, 32, "from"), option(null), vec(messages.map((m) => m)));
  return out;
};
export const decodeGroupMessages = (b) => {
  if (b.length > GROUP_BOUNDS.plaintext) throw new Error(`GroupMessages exceeds ${GROUP_BOUNDS.plaintext} bytes`);
  const r = reader(b);
  const from = hexOf(r.fixed(32, "from"));
  const topic = r.option((x) => x.u32("topic"), "topic");
  if (topic != null) throw new Error("GroupMessages.topic must be None in v2");
  // Each item is an opaque message: keep its compact length prefix so it can
  // be decoded with the DM decoder and re-shared byte for byte (history).
  const messages = r.vec(GROUP_BOUNDS.plaintext, (x) => {
    const start = x.offset;
    x.bytes(GROUP_BOUNDS.plaintext, "message");
    return b.slice(start, x.offset);
  }, "messages");
  r.end("GroupMessages");
  return { from, messages };
};

// ---------- GroupState ----------
const encodeMember = (m) => {
  if ((m.posting ?? []).length > GROUP_BOUNDS.posting) throw new Error("too many posting accounts");
  return concat(toBytes(m.account, 32, "member account"), u8(m.role), u16(m.permissions),
    vec((m.posting ?? []).map((p) => toBytes(p, 32, "posting account"))), u64(m.joinedAt));
};
const readMember = (r) => ({
  account: hexOf(r.fixed(32, "member account")),
  role: r.u8("role"),
  permissions: r.u16("permissions"),
  posting: r.vec(GROUP_BOUNDS.posting, (x) => hexOf(x.fixed(32, "posting account")), "posting"),
  joinedAt: r.u64("joinedAt"),
});
const encodeInvite = (i) => concat(toBytes(i.inviteId, 16, "inviteId"), toBytes(i.secret, 16, "invite secret"),
  toBytes(i.createdBy, 32, "createdBy"), u64(i.expiresAt ?? 0), u32(i.maxUses ?? 0), u32(i.uses ?? 0));
const readInvite = (r) => ({
  inviteId: hexOf(r.fixed(16, "inviteId")),
  secret: hexOf(r.fixed(16, "invite secret")),
  createdBy: hexOf(r.fixed(32, "createdBy")),
  expiresAt: r.u64("expiresAt"),
  maxUses: r.u32("maxUses"),
  uses: r.u32("uses"),
});

// Members sorted by account bytes (0011: "sorted by account"), so two admins
// that apply the same change produce the same bytes and the same stateHash.
export const sortMembers = (members) => [...members].sort((a, b) => (norm(a.account) < norm(b.account) ? -1 : norm(a.account) > norm(b.account) ? 1 : 0));

export const encodeGroupState = (s) => {
  const members = sortMembers(s.members);
  if (members.length < 1 || members.length > GROUP_BOUNDS.members) throw new Error("a state needs 1..=1024 members");
  if ((s.invites ?? []).length > GROUP_BOUNDS.invites) throw new Error("too many invites");
  if ((s.pinned ?? []).length > GROUP_BOUNDS.pinned) throw new Error("too many pins");
  if ((s.historyShare ?? 0) > GROUP_BOUNDS.historyShare) throw new Error("historyShare exceeds 100");
  if (s.name == null || [...s.name].length > 60) throw new Error("group name needs at most 60 characters");
  const out = concat(
    str(s.groupId, 256, "groupId"),
    u32(s.epoch), u32(s.version),
    str(s.name, GROUP_BOUNDS.nameBytes, "name"),
    option(s.avatar == null ? null : toBytes(s.avatar, 32, "avatar")),
    u16(s.defaultPermissions), u32(s.slowModeSecs ?? 0), u8(s.joinPolicy ?? 0), u8(s.historyShare ?? 0),
    vec(members.map(encodeMember)),
    vec((s.invites ?? []).map(encodeInvite)),
    vec((s.pinned ?? []).map((p) => str(p, 256, "pinned id"))),
    option(null), // topics: reserved, None in v2
    u64(s.createdAt),
  );
  if (out.length > GROUP_BOUNDS.stateBytes) throw new Error("state exceeds 64 KiB");
  return out;
};
export const decodeGroupState = (b) => {
  if (b.length > GROUP_BOUNDS.stateBytes) throw new Error("state exceeds 64 KiB");
  const r = reader(b);
  const s = {
    groupId: r.str(256, "groupId"),
    epoch: r.u32("epoch"),
    version: r.u32("version"),
    name: r.str(GROUP_BOUNDS.nameBytes, "name"),
    avatar: r.option((x) => hexOf(x.fixed(32, "avatar")), "avatar"),
    defaultPermissions: r.u16("defaultPermissions"),
    slowModeSecs: r.u32("slowModeSecs"),
    joinPolicy: r.u8("joinPolicy"),
    historyShare: r.u8("historyShare"),
    members: r.vec(GROUP_BOUNDS.members, readMember, "members"),
    invites: r.vec(GROUP_BOUNDS.invites, readInvite, "invites"),
    pinned: r.vec(GROUP_BOUNDS.pinned, (x) => x.str(256, "pinned id"), "pinned"),
    topics: r.option((x) => x.bytes(64 * 1024, "topics"), "topics"),
    createdAt: r.u64("createdAt"),
  };
  r.end("GroupState");
  if (s.members.length < 1) throw new Error("a state needs at least one member");
  if (s.topics != null) throw new Error("GroupState.topics must be None in v2");
  if (s.historyShare > GROUP_BOUNDS.historyShare) throw new Error("historyShare exceeds 100");
  if (s.joinPolicy > 2) throw new Error(`unknown joinPolicy ${s.joinPolicy}`);
  if (s.members.filter((m) => m.role === ROLES.owner).length !== 1) throw new Error("a state needs exactly one owner");
  if (s.members.some((m) => m.role > ROLES.owner)) throw new Error("unknown role");
  return s;
};

// ---------- InviteLink ----------
export const encodeInviteLink = ({ groupId, name, admins, inviteId, secret }) => {
  if (!admins?.length || admins.length > 3) throw new Error("an invite link names 1..=3 admins");
  return concat(str(groupId, 256, "groupId"), str(name, GROUP_BOUNDS.nameBytes, "name"),
    vec(admins.map((a) => toBytes(a, 32, "admin"))), toBytes(inviteId, 16, "inviteId"), toBytes(secret, 16, "secret"));
};
export const decodeInviteLink = (b) => {
  const r = reader(b);
  const link = {
    groupId: r.str(256, "groupId"),
    name: r.str(GROUP_BOUNDS.nameBytes, "name"),
    admins: r.vec(3, (x) => hexOf(x.fixed(32, "admin")), "admins"),
    inviteId: hexOf(r.fixed(16, "inviteId")),
    secret: hexOf(r.fixed(16, "secret")),
  };
  r.end("InviteLink");
  if (link.admins.length < 1) throw new Error("an invite link names at least one admin");
  return link;
};
export const inviteLinkToBase64Url = (b) => Buffer.from(b).toString("base64url");
export const inviteLinkFromBase64Url = (s) => new Uint8Array(Buffer.from(s, "base64url"));
