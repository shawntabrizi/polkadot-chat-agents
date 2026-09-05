import { describe, expect, it } from 'vitest';

import type { Attachment } from './api';
import { attachmentView } from './attachment-view';

const base: Attachment = { kind: 'image', mimeType: 'image/png', fileSize: 2048, width: 640, height: 480, identifier: '0xab', wssUrl: 'ws://127.0.0.1:1', status: 'pending', claimedBy: null, mediaId: null, error: null };

describe('attachmentView', () => {
  it('shows a held image inline from the local media route only', () => {
    const v = attachmentView({ ...base, status: 'claimed', claimedBy: 1, mediaId: 'ab' }, 'bob', 1);
    expect(v).toEqual({ kind: 'image', src: './api/personas/bob/media/ab', caption: 'image · image/png · 2 KB · 640×480' });
  });
  it('shows a sent image the same way for the sender', () => {
    expect(attachmentView({ ...base, status: 'sent', mediaId: 'ab' }, 'alice', 1).kind).toBe('image');
  });
  it('shows a held image inline by MIME even when the sender declared it a general file (bot-core returns vault files that way)', () => {
    const v = attachmentView({ ...base, kind: 'general', width: undefined, height: undefined, status: 'claimed', claimedBy: 1, mediaId: 'ab' }, 'bob', 1);
    expect(v.kind).toBe('image');
  });
  it('offers a non-image file as a download link', () => {
    const v = attachmentView({ ...base, kind: 'general', mimeType: 'text/plain', width: undefined, height: undefined, status: 'claimed', claimedBy: 2, mediaId: 'ab' }, 'bob', 2);
    expect(v).toEqual({ kind: 'file', href: './api/personas/bob/media/ab', caption: 'general · text/plain · 2 KB' });
  });
  it('is a placeholder when a sibling device claimed (the HOP claim is one-shot)', () => {
    // mediaId is on the shared row (the persona's disk has the bytes); the sibling device still renders the placeholder it would have on its own
    const v = attachmentView({ ...base, status: 'claimed', claimedBy: 1, mediaId: 'ab' }, 'bob', 2);
    expect(v).toEqual({ kind: 'placeholder', caption: 'image · image/png · 2 KB · 640×480', note: 'claimed by device 1' });
  });
  it('names the failure and never a URL from the message', () => {
    const v = attachmentView({ ...base, status: 'failed', claimedBy: 1, error: 'HOP entry hash mismatch' }, 'bob', 1);
    expect(v.kind).toBe('failed');
    expect(JSON.stringify(v)).not.toContain('ws://');
  });
  it('reports a claim in flight and an unclaimed reference', () => {
    expect(attachmentView({ ...base, status: 'claiming', claimedBy: 2 }, 'bob', 2)).toMatchObject({ kind: 'claiming', note: 'claiming on device 2 (this one)…' });
    expect(attachmentView(base, 'bob', 1).kind).toBe('pending');
  });
});
