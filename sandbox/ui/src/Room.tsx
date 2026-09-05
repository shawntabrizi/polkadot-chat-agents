import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';

import { labelOf, textOf } from '../../lib/markdown.mjs';

import type { Session } from './App';
import { type Attachment, type HexString, type Message, api, errorText } from './api';
import { attachmentView } from './attachment-view';
import { useEvents } from './events';
import { formatTime } from './format';
import { useLoader } from './hooks';
import { MarkdownCell } from './MarkdownCell';
import { statusOf } from './message-status';
import { quoteOf } from './quote';

type Props = { session: Session; peer: HexString; peerName: string };
type Composer = { mode: 'new' } | { mode: 'reply'; target: Message } | { mode: 'edit'; target: Message };

const QUICK_REACTIONS = ['👍', '❤️', '😂'];
const editable = (m: Message) => m.direction === 'outgoing' && (m.content.type === 'text' || m.content.type === 'reply');

export const Room = ({ session, peer, peerName }: Props) => {
  const { persona, device } = session;
  const view = useLoader(() => api.room(persona.name, peer), [persona.name, peer]);
  useEvents(
    event => {
      if (event.persona === persona.name) view.reload();
    },
    ['message', 'room', 'contact'],
  );
  const [draft, setDraft] = useState('');
  const [composer, setComposer] = useState<Composer>({ mode: 'new' });
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // Everything that arrives while the room is open is read; the daemon then
  // emits the rows' change, which this view picks up like any other.
  const messages = view.data?.messages ?? [];
  const unread = messages.filter(m => m.direction === 'incoming' && !m.read).length;
  useEffect(() => {
    if (unread > 0) void api.markRead(persona.name, peer).catch(() => undefined);
  }, [persona.name, peer, unread]);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [messages.length]);

  const byId = new Map(messages.map(m => [m.messageId, m]));

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    const current = composer;
    setError(null);
    setDraft('');
    setComposer({ mode: 'new' });
    try {
      if (current.mode === 'edit') await api.edit(persona.name, peer, current.target.messageId, text, device);
      else await api.send(persona.name, peer, { text, replyTo: current.mode === 'reply' ? current.target.messageId : null, device });
      view.reload();
    } catch (cause) {
      setError(errorText(cause, 'Could not send.'));
      setDraft(text);
      setComposer(current);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
    if (event.key === 'Escape') cancel();
  };
  const cancel = () => {
    setComposer({ mode: 'new' });
    setDraft('');
  };
  const react = async (m: Message, emoji: string) => {
    const mine = m.reactions.some(r => r.emoji === emoji && r.by === 'me');
    setError(null);
    try {
      await api.react(persona.name, peer, m.messageId, emoji, !mine, device);
      view.reload();
    } catch (cause) {
      setError(errorText(cause, 'Could not react.'));
    }
  };
  const startReply = (m: Message) => {
    setComposer({ mode: 'reply', target: m });
    input.current?.focus();
  };
  const startEdit = (m: Message) => {
    setComposer({ mode: 'edit', target: m });
    setDraft(textOf(m.content) ?? '');
    input.current?.focus();
  };

  // An attachment as this device sees it: an image inline from the daemon's
  // own media route, a file as a download link, or a placeholder (a sibling
  // claimed the one-shot HOP entry, a claim in flight, a failure).
  const attachment = (a: Attachment, i: number) => {
    const v = attachmentView(a, persona.name, device);
    if (v.kind === 'image') {
      return (
        <figure key={i} className="attachment" data-testid="attachment" data-status={a.status}>
          <img src={v.src} alt={v.caption} width={a.width} height={a.height} />
          <figcaption className="caption">{v.caption}</figcaption>
        </figure>
      );
    }
    if (v.kind === 'file') {
      return (
        <p key={i} className="attachment" data-testid="attachment" data-status={a.status}>
          <a href={v.href} download>
            {v.caption}
          </a>
        </p>
      );
    }
    return (
      <p key={i} className={`attachment placeholder caption${v.kind === 'failed' ? ' error' : ''}`} data-testid="attachment" data-status={a.status}>
        {v.caption} — {v.note}
      </p>
    );
  };
  const body = (m: Message) => {
    const text = textOf(m.content);
    const attachments = m.content.type === 'richText' ? m.content.attachments : [];
    const isText = m.content.type === 'text' || m.content.type === 'reply' || (m.content.type === 'richText' && text != null);
    return (
      <>
        {m.content.type === 'reply' ? <blockquote className="quote">{quoteOf(byId.get(m.content.messageId))}</blockquote> : null}
        {isText ? <MarkdownCell text={text} /> : attachments.length > 0 ? null : <span className="tertiary">{labelOf(m.content) ?? 'Unknown message'}</span>}
        {attachments.map(attachment)}
      </>
    );
  };

  return (
    <section className="panel room" data-testid="room">
      <div className="row" style={{ marginBottom: 8 }}>
        <h2 className="heading">{peerName}</h2>
        {view.data?.contact && view.data.contact.devices.length === 0 ? <span className="caption error">No known device yet; messages cannot be sent.</span> : null}
        <span className="spacer" style={{ flex: 1 }} />
        <a className="caption" href={`./api/personas/${encodeURIComponent(persona.name)}/rooms/${peer}?format=html`} target="_blank" rel="noopener noreferrer">
          as HTML
        </a>
      </div>
      {view.error ? <p className="error" role="alert">{view.error}</p> : null}
      <ol className="messages" ref={list} data-testid="messages">
        {messages.map(m => {
          const status = statusOf(m);
          return (
            <li key={m.messageId} className="msg" data-direction={m.direction} data-status={m.status} data-id={m.messageId} data-testid={`message-${m.direction}`}>
              {body(m)}
              {m.direction === 'system' ? null : (
                <div className="meta">
                  <span className="caption">
                    {formatTime(m.timestamp)}
                    {m.editedAt ? ' · edited' : ''}
                  </span>
                  {status ? (
                    <span className={`caption ${status.tone === 'error' ? 'error' : ''}`} data-testid="status">
                      {status.text}
                    </span>
                  ) : null}
                  {m.reactions.length > 0 ? (
                    <span className="reactions">
                      {m.reactions.map(r => (
                        <span key={`${r.emoji}:${r.by}`} className="pill" title={r.by === 'me' ? 'you' : peerName} onClick={() => void react(m, r.emoji)}>
                          {r.emoji}
                        </span>
                      ))}
                    </span>
                  ) : null}
                  <span className="spacer" style={{ flex: 1 }} />
                  <span className="actions">
                    {QUICK_REACTIONS.map(emoji => (
                      <button key={emoji} type="button" className="btn ghost small" title="React" onClick={() => void react(m, emoji)}>
                        {emoji}
                      </button>
                    ))}
                    <button type="button" className="btn ghost small" onClick={() => startReply(m)}>
                      Reply
                    </button>
                    {editable(m) ? (
                      <button type="button" className="btn ghost small" onClick={() => startEdit(m)}>
                        Edit
                      </button>
                    ) : null}
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {composer.mode !== 'new' ? (
        <div className="composer-mode caption">
          <span>{composer.mode === 'reply' ? 'Replying to' : 'Editing'}:</span>
          <span className="quote" style={{ flex: 1 }}>{quoteOf(composer.target)}</span>
          <button type="button" className="btn ghost small" onClick={cancel}>
            Cancel
          </button>
        </div>
      ) : null}
      <form className="composer" onSubmit={event => void submit(event)}>
        <textarea
          ref={input}
          className="textarea"
          value={draft}
          rows={2}
          placeholder={`Message as ${persona.name} from device ${device} — Enter sends, Shift+Enter for a new line`}
          aria-label="Message"
          onChange={e => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button className="btn primary" type="submit" disabled={!draft.trim()}>
          {composer.mode === 'edit' ? 'Save' : 'Send'}
        </button>
      </form>
    </section>
  );
};
