import { useCallback, useEffect, useMemo, useState } from 'react';

import { type Account, type Persona, type PersonaDetail, api } from './api';
import { Chats } from './Chats';
import { Conversation } from './Conversation';
import { useConnection, useEvents } from './events';
import { useLoader, useStored } from './hooks';
import { Personas } from './Personas';
import { Requests } from './Requests';
import { Wire } from './Wire';

type Tab = 'personas' | 'requests' | 'chats' | 'conversation' | 'wire';
const TABS: { id: Tab; label: string }[] = [
  { id: 'personas', label: 'Personas' },
  { id: 'requests', label: 'Requests' },
  { id: 'chats', label: 'Chats' },
  { id: 'conversation', label: 'Conversation' },
  { id: 'wire', label: 'Wire' },
];

/** What the screens share: the active persona, its device, and the directory. */
export type Session = {
  persona: PersonaDetail;
  device: number;
  personas: Persona[];
  accounts: Account[];
  isPersona: (account: string) => boolean;
  reload: () => void;
};

export const App = () => {
  const [tab, setTab] = useStored<Tab>('pcs.tab', 'personas');
  const [active, setActive] = useStored<string>('pcs.persona', '');
  const [device, setDevice] = useStored<number>('pcs.device', 1);
  const [connection, setConnection] = useState<'connecting' | 'open' | 'closed'>('connecting');
  useConnection(useCallback((s: typeof connection) => setConnection(s), []));

  const personas = useLoader(() => api.personas(), []);
  const accounts = useLoader(() => api.accounts(), []);
  const detail = useLoader(() => (active ? api.persona(active) : Promise.resolve(null)), [active]);

  // The persona list changes on `persona`; the active persona's contacts,
  // requests and rooms on their own events. Bots register without an event,
  // so the directory is re-read whenever a contact appears.
  useEvents(() => {
    personas.reload();
    accounts.reload();
  }, ['persona']);
  useEvents(
    event => {
      if (event.persona === active) detail.reload();
      if (event.type === 'contact') accounts.reload();
    },
    ['contact', 'request', 'room', 'message'],
  );

  // No persona chosen yet, or the chosen one is gone: take the first.
  useEffect(() => {
    const list = personas.data;
    if (!list) return;
    if (!list.some(p => p.name === active)) setActive(list[0]?.name ?? '');
  }, [personas.data, active, setActive]);
  useEffect(() => {
    const d = detail.data;
    if (d && !d.devices.some(x => x.index === device && x.online)) setDevice(d.devices.find(x => x.online)?.index ?? 1);
  }, [detail.data, device, setDevice]);

  const personaAccounts = useMemo(() => new Set((personas.data ?? []).map(p => p.account)), [personas.data]);
  const session: Session | null = detail.data
    ? {
        persona: detail.data,
        device,
        personas: personas.data ?? [],
        accounts: accounts.data ?? [],
        isPersona: account => personaAccounts.has(account as Persona['account']),
        reload: () => {
          detail.reload();
          accounts.reload();
        },
      }
    : null;
  const pending = detail.data?.requests.filter(r => r.direction === 'incoming' && r.status === 'pending').length ?? 0;
  const unread = detail.data?.rooms.reduce((n, r) => n + r.unreadCount, 0) ?? 0;

  return (
    <div className="shell">
      <nav className="rail" aria-label="Sections">
        <div className="brand">
          <img className="dark" src="./logo-symbol_dark.svg" alt="" />
          <img className="light" src="./logo-symbol_light.svg" alt="" />
          Sandbox
        </div>
        {TABS.map(entry => (
          <button key={entry.id} type="button" className="nav-item" aria-current={tab === entry.id ? 'page' : undefined} onClick={() => setTab(entry.id)}>
            {entry.label}
            {entry.id === 'requests' && pending > 0 ? <span className="count">{pending}</span> : null}
            {entry.id === 'chats' && unread > 0 ? <span className="count">{unread}</span> : null}
          </button>
        ))}
        <div className="foot caption" data-testid="connection">
          {connection === 'open' ? 'Live' : connection === 'connecting' ? 'Connecting…' : 'Disconnected'}
        </div>
      </nav>
      <main className="main">
        <div className="topbar">
          <h1 className="heading">{TABS.find(t => t.id === tab)?.label}</h1>
          <span className="spacer" />
          {personas.data && personas.data.length > 0 ? (
            <label className="row caption">
              Acting as
              <select className="select" value={active} onChange={e => setActive(e.target.value)} aria-label="Active persona" data-testid="persona-select">
                {personas.data.map(p => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select className="select" value={device} onChange={e => setDevice(Number(e.target.value))} aria-label="Active device" data-testid="device-select">
                {(detail.data?.devices ?? []).filter(d => !d.removed).map(d => (
                  <option key={d.index} value={d.index} disabled={!d.online}>
                    device {d.index}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        {personas.error ? <p className="error" role="alert">{personas.error}</p> : null}
        <div className="content">
          {tab === 'personas' ? <Personas session={session} personas={personas.data ?? []} onSelect={setActive} onAdded={personas.reload} /> : null}
          {tab === 'requests' ? session ? <Requests session={session} /> : <p className="empty">Add a persona first.</p> : null}
          {tab === 'chats' ? session ? <Chats session={session} /> : <p className="empty">Add a persona first.</p> : null}
          {tab === 'conversation' ? session ? <Conversation session={session} /> : <p className="empty">Add a persona first.</p> : null}
          {tab === 'wire' ? <Wire session={session} /> : null}
        </div>
      </main>
    </div>
  );
};
