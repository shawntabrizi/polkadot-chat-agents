import { type ReactNode, useState } from 'react';

import type { Session } from './App';
import { type PersonaDetail, api, errorText } from './api';
import { useEvents } from './events';
import { useLoader, useStored } from './hooks';
import { type Participant, participantsOf, pickLeft, pickRight, readOnly, relationOf } from './pairing';
import { Room } from './Room';

type Props = { session: Session };
type Side = 'left' | 'right';

/** The device a pane acts from: the chosen one while it is online, else the first online one. */
const usableDevice = (detail: PersonaDetail | null, wanted: number): number => {
  const online = (detail?.devices ?? []).filter(d => d.online && !d.removed);
  return online.some(d => d.index === wanted) ? wanted : (online[0]?.index ?? 1);
};

/**
 * Both sides of one chat on one screen. Each pane is one participant's own
 * view of the other, with its own composer and device. Only the pane the
 * user last touched marks incoming rows read, so the other side's unread
 * count still says what it would say on a phone left in a pocket.
 */
export const Conversation = ({ session }: Props) => {
  const participants = participantsOf(session.personas, session.accounts);
  const [storedLeft, setLeft] = useStored<string>('pcs.conversation.left', '');
  const [storedRight, setRight] = useStored<string>('pcs.conversation.right', '');
  const [leftDeviceChoice, setLeftDevice] = useState(1);
  const [rightDeviceChoice, setRightDevice] = useState(1);
  const [focus, setFocus] = useState<Side | null>(null);

  const left = pickLeft(participants, storedLeft, session.persona.name);
  const leftDetail = useLoader(() => (left ? api.persona(left) : Promise.resolve(null)), [left]);
  const right = pickRight(participants, storedRight, leftDetail.data);
  const rightParticipant = participants.find(p => p.name === right) ?? null;
  const rightIsPersona = rightParticipant?.kind === 'persona';
  const rightDetail = useLoader(() => (rightIsPersona ? api.persona(right) : Promise.resolve(null)), [right, rightIsPersona]);
  useEvents(
    event => {
      if (event.persona === left) leftDetail.reload();
      if (event.persona === right) rightDetail.reload();
    },
    ['persona', 'contact', 'request', 'room', 'message'],
  );

  const leftParticipant = participants.find(p => p.name === left) ?? null;
  const leftDevice = usableDevice(leftDetail.data, leftDeviceChoice);
  const rightDevice = usableDevice(rightDetail.data, rightDeviceChoice);
  const personaOptions = participants.filter(p => p.kind === 'persona');
  const botOptions = participants.filter(p => p.kind === 'bot');

  const deviceSelect = (side: Side, detail: PersonaDetail | null, value: number, onChange: (index: number) => void) => {
    const devices = (detail?.devices ?? []).filter(d => !d.removed);
    if (devices.length < 2) return null;
    return (
      <select className="select" value={value} aria-label={`${side === 'left' ? 'Left' : 'Right'} device`} onChange={e => onChange(Number(e.target.value))}>
        {devices.map(d => (
          <option key={d.index} value={d.index} disabled={!d.online}>
            device {d.index}
          </option>
        ))}
      </select>
    );
  };

  const pane = (side: Side, header: ReactNode, body: ReactNode) => (
    <section className="panel room-panel" data-testid={`pane-${side}`} onPointerDownCapture={() => setFocus(side)} onFocusCapture={() => setFocus(side)}>
      <div className="row">{header}</div>
      {body}
    </section>
  );

  const leftHeader = (
    <>
      <select className="select" value={left} aria-label="Left participant" onChange={e => setLeft(e.target.value)}>
        {personaOptions.map(p => (
          <option key={p.name} value={p.name}>
            {p.name}
          </option>
        ))}
      </select>
      {deviceSelect('left', leftDetail.data, leftDevice, setLeftDevice)}
    </>
  );
  const rightHeader = (
    <>
      <select className="select" value={right} aria-label="Right participant" onChange={e => setRight(e.target.value)}>
        {right === '' ? <option value="">Choose…</option> : null}
        <optgroup label="Personas">
          {personaOptions
            .filter(p => p.name !== left)
            .map(p => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
        </optgroup>
        {botOptions.length > 0 ? (
          <optgroup label="Bots (read-only)">
            {botOptions.map(p => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
      {rightIsPersona ? deviceSelect('right', rightDetail.data, rightDevice, setRightDevice) : null}
      <span className="spacer" style={{ flex: 1 }} />
      {readOnly(rightParticipant) ? <span className="caption">as seen by {left}</span> : null}
    </>
  );

  const error = leftDetail.error ?? rightDetail.error;
  const leftBody = !leftDetail.data ? null : !rightParticipant ? (
    <p className="empty">Pick who {left} talks to.</p>
  ) : (
    <Side key={`${left}:${right}`} owner={leftDetail.data} peer={rightParticipant} device={leftDevice} readOnly={false} active={focus === 'left'} />
  );
  // A bot has no inbox the sandbox can read: its pane is the left persona's
  // room with it, shown from the bot's chair with nothing to act on.
  const rightBody = !rightParticipant || !leftParticipant || !leftDetail.data ? null : readOnly(rightParticipant) ? (
    <Side key={`${right}:${left}`} owner={leftDetail.data} peer={rightParticipant} device={leftDevice} readOnly active={false} />
  ) : rightDetail.data ? (
    <Side key={`${right}:${left}`} owner={rightDetail.data} peer={leftParticipant} device={rightDevice} readOnly={false} active={focus === 'right'} />
  ) : null;

  return (
    <div className="conversation">
      {error ? <p className="error" role="alert" style={{ gridColumn: '1 / -1' }}>{error}</p> : null}
      {pane('left', leftHeader, leftBody)}
      {pane('right', rightHeader, rightBody)}
    </div>
  );
};

type SideProps = { owner: PersonaDetail; peer: Participant; device: number; readOnly: boolean; active: boolean };

/** What `owner` sees of `peer`: their room, or the request between them and what `owner` can do about it. */
const Side = ({ owner, peer, device, readOnly, active }: SideProps) => {
  const [welcome, setWelcome] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const relation = relationOf(owner, peer.account);

  if (relation.state === 'contact') return <Room persona={owner} device={device} peer={peer.account} peerName={peer.name} readOnly={readOnly} active={active} />;

  const run = async (fn: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (cause) {
      setError(errorText(cause, fallback));
    } finally {
      setBusy(false);
    }
  };
  const open = () => run(() => api.request(owner.name, peer.name, welcome.trim() || null, device), 'Could not send the request.');
  const answer = (id: string, action: 'accept' | 'decline') => run(() => api.answer(owner.name, id, action, device), `Could not ${action} the request.`);

  // Read-only panes describe the state from the outside; a persona's own pane speaks to it.
  const you = readOnly ? owner.name : 'You';
  const yours = readOnly ? `${owner.name}'s` : 'your';
  let text: string;
  let action: ReactNode = null;
  switch (relation.state) {
    case 'none':
      text = readOnly ? `${owner.name} has not opened a chat with ${peer.name}.` : `No chat with ${peer.name} yet.`;
      break;
    case 'sent':
      text = `${you} sent ${peer.name} a request. No answer yet.`;
      break;
    case 'received':
      text = `${peer.name} wants to chat with ${readOnly ? owner.name : 'you'}.`;
      break;
    case 'declined':
      text = relation.by === 'me' ? `${you} declined ${peer.name}'s request.` : `${peer.name} declined ${yours} request.`;
      break;
  }
  if (!readOnly && (relation.state === 'none' || (relation.state === 'declined' && relation.by === 'peer'))) {
    action = (
      <form
        className="row"
        onSubmit={event => {
          event.preventDefault();
          void open();
        }}
      >
        <input className="input" style={{ flex: 1, minWidth: 0 }} value={welcome} placeholder="Welcome message (optional)" aria-label="Welcome message" onChange={e => setWelcome(e.target.value)} />
        <button className="btn primary" type="submit" disabled={busy}>
          Open a chat
        </button>
      </form>
    );
  }
  if (!readOnly && relation.state === 'received') {
    action = (
      <div className="row">
        <button type="button" className="btn primary" disabled={busy} onClick={() => void answer(relation.request.requestId, 'accept')}>
          Accept
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => void answer(relation.request.requestId, 'decline')}>
          Decline
        </button>
      </div>
    );
  }
  const welcomeText = relation.state === 'none' ? null : relation.request.welcomeMessage;
  return (
    <div className="stack" data-testid="side-state" data-state={relation.state}>
      <p>{text}</p>
      {welcomeText ? <p className="caption">“{welcomeText}”</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      {action}
    </div>
  );
};
