// How one attachment renders from the viewing device's side. The bytes are
// shown only when this device holds them (it sent them, or it is the device
// that claimed them) and only from the daemon's own media route — a message
// never makes the viewer fetch a URL it named. A sibling device's claim is a
// placeholder, as the desktop renders one instead of claiming a one-shot HOP
// entry twice; the persona's disk holding the bytes does not change what
// that device would have.
import type { Attachment } from './api';

export type AttachmentView =
  | { kind: 'image'; src: string; caption: string }
  | { kind: 'file'; href: string; caption: string }
  | { kind: 'placeholder' | 'pending' | 'claiming'; caption: string; note: string }
  | { kind: 'failed'; caption: string; note: string };

const human = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export const captionOf = (a: Attachment): string => `${a.kind} · ${a.mimeType} · ${human(a.fileSize)}${a.width ? ` · ${a.width}×${a.height}` : ''}`;

export function attachmentView(a: Attachment, persona: string, device: number): AttachmentView {
  const caption = captionOf(a);
  const held = a.mediaId && (a.status === 'sent' || (a.status === 'claimed' && a.claimedBy === device));
  if (held && a.kind === 'image') return { kind: 'image', src: `./api/personas/${encodeURIComponent(persona)}/media/${a.mediaId}`, caption };
  if (held) return { kind: 'file', href: `./api/personas/${encodeURIComponent(persona)}/media/${a.mediaId}`, caption };
  if (a.status === 'claimed') return { kind: 'placeholder', caption, note: `claimed by device ${a.claimedBy}` };
  if (a.status === 'claiming') return { kind: 'claiming', caption, note: `claiming on device ${a.claimedBy}${a.claimedBy === device ? ' (this one)' : ''}…` };
  if (a.status === 'failed') return { kind: 'failed', caption, note: `download failed on device ${a.claimedBy}: ${a.error ?? 'unknown error'}` };
  return { kind: 'pending', caption, note: 'not claimed' };
}
