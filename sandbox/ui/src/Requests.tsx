import { type FormEvent, useState } from 'react';

import type { Session } from './App';
import { type Account, type RequestRow, api, errorText } from './api';
import { formatTime } from './format';

type Props = { session: Session };

/** Incoming requests with Accept and Decline, outgoing with their state, and a directory search that opens a request. */
export const Requests = ({ session }: Props) => {
  const { persona, device } = session;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [welcome, setWelcome] = useState('');
  const [results, setResults] = useState<Account[] | null>(null);

  const act = async (row: RequestRow, action: 'accept' | 'decline') => {
    setBusy(row.requestId);
    setError(null);
    try {
      await api.answer(persona.name, row.requestId, action, device);
      session.reload();
    } catch (cause) {
      setError(errorText(cause, `Could not ${action} the request.`));
    } finally {
      setBusy(null);
    }
  };

  // The directory is small: fetch it fresh and filter by username prefix here.
  const search = async (event: FormEvent) => {
    event.preventDefault();
    const prefix = query.trim().toLowerCase();
    setError(null);
    try {
      const all = await api.accounts();
      setResults(all.filter(a => a.username && a.account !== persona.account && a.identifierKey && (prefix === '' || a.username.startsWith(prefix))));
    } catch (cause) {
      setError(errorText(cause, 'Search failed.'));
    }
  };

  const open = async (target: Account) => {
    if (!target.username) return;
    setBusy(target.account);
    setError(null);
    try {
      await api.request(persona.name, target.username, welcome.trim() || null, device);
      setWelcome('');
      session.reload();
    } catch (cause) {
      setError(errorText(cause, 'Could not send the request.'));
    } finally {
      setBusy(null);
    }
  };

  const stateOf = (account: Account): string | null => {
    if (persona.contacts.some(c => c.account === account.account)) return 'contact';
    const pending = persona.requests.find(r => r.peer === account.account && r.status === 'pending');
    if (pending) return pending.direction === 'outgoing' ? 'request sent' : 'request received';
    return null;
  };

  const incoming = persona.requests.filter(r => r.direction === 'incoming');
  const outgoing = persona.requests.filter(r => r.direction === 'outgoing');

  return (
    <div className="split">
      <section className="panel stack">
        <h2 className="label">Find someone</h2>
        <form className="stack" onSubmit={event => void search(event)}>
          <div className="row">
            <input className="input" style={{ flex: 1, minWidth: 0 }} type="search" value={query} placeholder="Username" aria-label="Username" onChange={e => setQuery(e.target.value)} />
            <button className="btn" type="submit">
              Search
            </button>
          </div>
          <input className="input" value={welcome} placeholder="Welcome message (optional)" aria-label="Welcome message" onChange={e => setWelcome(e.target.value)} />
        </form>
        {results?.length === 0 ? <p className="empty">No usernames start with “{query.trim()}”.</p> : null}
        <ul className="stack" style={{ gap: 4 }}>
          {results?.map(account => {
            const state = stateOf(account);
            return (
              <li key={account.account} className="nested row" data-testid="search-result">
                <span className="label">{account.username}</span>
                {session.isPersona(account.account) ? null : <span className="pill">bot</span>}
                <span className="spacer" style={{ flex: 1 }} />
                {state ? (
                  <span className="caption">{state}</span>
                ) : (
                  <button type="button" className="btn small primary" disabled={busy !== null} onClick={() => void open(account)}>
                    Send request
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      <section className="panel stack scroll">
        {error ? <p className="error" role="alert">{error}</p> : null}
        <h2 className="label">Incoming</h2>
        {incoming.length === 0 ? <p className="empty">No incoming requests.</p> : null}
        <ul className="stack" style={{ gap: 4 }}>
          {incoming.map(row => (
            <li key={row.requestId} className="nested stack" style={{ gap: 4 }} data-testid="incoming-request" data-status={row.status}>
              <div className="row">
                <span className="label">{row.peerUsername}</span>
                <span className="caption">{formatTime(row.timestamp)}</span>
                <span className="spacer" style={{ flex: 1 }} />
                {row.status === 'pending' ? (
                  <>
                    <button type="button" className="btn small primary" disabled={busy !== null} onClick={() => void act(row, 'accept')}>
                      Accept
                    </button>
                    <button type="button" className="btn small" disabled={busy !== null} onClick={() => void act(row, 'decline')}>
                      Decline
                    </button>
                  </>
                ) : (
                  <span className="caption">
                    {row.status}
                    {row.device ? ` on device ${row.device}` : ''}
                  </span>
                )}
              </div>
              {row.welcomeMessage ? <p className="caption">“{row.welcomeMessage}”</p> : null}
            </li>
          ))}
        </ul>
        <h2 className="label">Outgoing</h2>
        {outgoing.length === 0 ? <p className="empty">No outgoing requests.</p> : null}
        <ul className="stack" style={{ gap: 4 }}>
          {outgoing.map(row => (
            <li key={row.requestId} className="nested row" data-testid="outgoing-request" data-status={row.status}>
              <span className="label">{row.peerUsername}</span>
              <span className="caption">{formatTime(row.timestamp)}</span>
              <span className="spacer" style={{ flex: 1 }} />
              <span className="pill">{row.status}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};
