import { useState } from 'react';

import type { Session } from './App';
import { type HexString, api } from './api';
import { useEvents } from './events';
import { formatTime } from './format';
import { useLoader } from './hooks';
import { Room } from './Room';

type Props = { session: Session };

/** The room list (unread counts, last preview) and the open room. A contact without a room yet still shows. */
export const Chats = ({ session }: Props) => {
  const { persona } = session;
  const [open, setOpen] = useState<HexString | null>(null);
  const rooms = useLoader(() => api.rooms(persona.name), [persona.name]);
  useEvents(
    event => {
      if (event.persona === persona.name) rooms.reload();
    },
    ['room', 'message', 'contact'],
  );

  const rows = persona.contacts
    .map(contact => ({ contact, room: rooms.data?.find(r => r.peer === contact.account) ?? null }))
    .sort((a, b) => (b.room?.lastMessageAt ?? 0) - (a.room?.lastMessageAt ?? 0));
  const current = rows.find(r => r.contact.account === open) ?? null;

  return (
    <div className="split">
      <section className="panel stack scroll" style={{ gap: 2 }}>
        {rows.length === 0 ? <p className="empty">No chats yet. Accept or send a request.</p> : null}
        {rows.map(({ contact, room }) => (
          <button key={contact.account} type="button" className="list-item" aria-current={contact.account === open ? 'true' : undefined} onClick={() => setOpen(contact.account)} data-testid="chat-row">
            <span className="grow">
              <span className="row">
                <span className="label">{contact.username}</span>
                {session.isPersona(contact.account) ? null : <span className="pill">bot</span>}
                <span className="spacer" style={{ flex: 1 }} />
                {room ? <span className="caption">{formatTime(room.lastMessageAt)}</span> : null}
              </span>
              <span className="preview caption" style={{ display: 'block' }}>
                {room?.lastPreview || 'No messages yet'}
              </span>
            </span>
            {room && room.unreadCount > 0 ? <span className="unread">{room.unreadCount}</span> : null}
          </button>
        ))}
      </section>
      {current ? (
        <section className="panel room-panel">
          <div className="row">
            <h2 className="heading">{current.contact.username}</h2>
            <span className="spacer" style={{ flex: 1 }} />
            <a className="caption" href={`./api/personas/${encodeURIComponent(persona.name)}/rooms/${current.contact.account}?format=html`} target="_blank" rel="noopener noreferrer">
              as HTML
            </a>
          </div>
          <Room key={`${persona.name}:${current.contact.account}`} persona={persona} device={session.device} peer={current.contact.account} peerName={current.contact.username} />
        </section>
      ) : (
        <section className="panel">
          <p className="empty">Open a chat to read and send messages.</p>
        </section>
      )}
    </div>
  );
};
