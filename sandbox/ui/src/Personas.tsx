import { type FormEvent, useState } from 'react';

import type { Session } from './App';
import { type Persona, api, errorText } from './api';
import { plural, shortHex } from './format';

type Props = { session: Session | null; personas: Persona[]; onSelect: (name: string) => void; onAdded: () => void };

/** Every persona on the left; the active one's identity, devices and contacts on the right. */
export const Personas = ({ session, personas, onSelect, onAdded }: Props) => {
  const [name, setName] = useState('');
  const [devices, setDevices] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.addPersona(trimmed, session?.mock === false ? 1 : devices);
      setName('');
      onAdded();
      onSelect(created.name);
    } catch (cause) {
      setError(errorText(cause, 'Could not add the persona.'));
    } finally {
      setBusy(false);
    }
  };

  const addDevice = async () => {
    if (!session) return;
    setError(null);
    try {
      await api.addDevice(session.persona.name);
      session.reload();
    } catch (cause) {
      setError(errorText(cause, 'Could not add a device.'));
    }
  };

  const active = session?.persona ?? null;
  return (
    <div className="split">
      <section className="panel stack">
        <form className="row" onSubmit={event => void add(event)}>
          <input className="input" style={{ flex: 1, minWidth: 0 }} value={name} placeholder="Name" aria-label="Persona name" onChange={e => setName(e.target.value)} />
          {session?.mock !== false ? (
            <input className="input" style={{ width: 56 }} type="number" min={1} max={9} value={devices} aria-label="Devices" onChange={e => setDevices(Number(e.target.value))} />
          ) : null}
          <button className="btn primary" type="submit" disabled={busy || !name.trim()}>
            Add
          </button>
        </form>
        {error ? <p className="error" role="alert">{error}</p> : null}
        {personas.length === 0 ? <p className="empty">No personas yet. Add one to mint and register a user.</p> : null}
        <ul className="stack" style={{ gap: 2 }}>
          {personas.map(p => (
            <li key={p.name}>
              <button type="button" className="list-item" aria-current={p.name === active?.name ? 'true' : undefined} onClick={() => onSelect(p.name)} data-testid="persona-row">
                <span className="grow">
                  <span className="label">{p.name}</span>
                  <span className="preview caption" style={{ display: 'block' }}>
                    {plural(p.devices.filter(d => !d.removed).length, 'device')}
                  </span>
                </span>
                <span className={`dot ${p.devices.some(d => d.online) ? 'on' : ''}`} title={p.devices.some(d => d.online) ? 'online' : 'offline'} />
              </button>
            </li>
          ))}
        </ul>
      </section>
      {active ? (
        <section className="panel stack scroll" data-testid="persona-detail">
          <h2 className="heading">{active.name}</h2>
          <dl className="kv">
            <dt>Username</dt>
            <dd>
              {active.registration ? (
                <span data-testid="registration">
                  {active.registration.username ?? '(no username yet)'} ·{' '}
                  {active.registration.status === 'attested' ? 'attested' : active.registration.status === 'claimed' ? 'attestation pending' : active.registration.status === 'needs-reregistration' ? 'needs re-registration (the chain was reset)' : active.registration.status}
                  {active.registration.bulletin !== 'none' ? ` · Bulletin allowance ${active.registration.bulletin}` : ''}
                </span>
              ) : (
                active.username
              )}
            </dd>
            <dt>Account</dt>
            <dd className="mono">{active.account}</dd>
            <dt>Chat key</dt>
            <dd className="mono">{active.chatPublicKey}</dd>
          </dl>
          <div className="row">
            <h3 className="label">Devices</h3>
            <span className="spacer" style={{ flex: 1 }} />
            {session?.mock ? (
              <button type="button" className="btn small" onClick={() => void addDevice()}>
                Add device
              </button>
            ) : (
              <span className="caption">single-device on {session ? 'this network' : ''}</span>
            )}
          </div>
          <ul className="stack" style={{ gap: 4 }}>
            {active.devices.map(d => (
              <li key={d.index} className="nested row" data-testid="device-row">
                <span className={`dot ${d.online ? 'on' : ''}`} />
                <span className="label">device {d.index}</span>
                <span className="mono tertiary">{shortHex(d.account)}</span>
                <span className="caption">{d.removed ? 'removed' : d.online ? 'online' : 'offline'}</span>
              </li>
            ))}
          </ul>
          <h3 className="label">Contacts</h3>
          {active.contacts.length === 0 ? <p className="empty">No contacts. Accept or send a request.</p> : null}
          <ul className="stack" style={{ gap: 4 }}>
            {active.contacts.map(c => (
              <li key={c.account} className="nested row" data-testid="contact-row">
                <span className="label">{c.username}</span>
                {session?.isPersona(c.account) ? null : <span className="pill">bot</span>}
                <span className="caption">{plural(c.devices.length, 'device')}</span>
                <span className="mono tertiary">{shortHex(c.account)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="panel">
          <p className="empty">Select a persona to see its account, devices and contacts.</p>
        </section>
      )}
    </div>
  );
};
