import { type FormEvent, useState } from 'react';

import type { Session } from './App';
import { type Decoded, type HopFaultKind, type SandboxEvent, type Statement, api, errorText } from './api';
import { useEvents } from './events';
import { formatIso, shortHex } from './format';
import { useLoader } from './hooks';

type Props = { session: Session | null; mock: boolean };
type FaultForm = { kind: 'drop' | 'delay' | 'holdDump'; from: string; channel: string; topic: string; count: string; ms: string };
const EMPTY_FAULT: FaultForm = { kind: 'drop', from: '', channel: '', topic: '', count: '1', ms: '1000' };
type HopFaultForm = { kind: HopFaultKind; hash: string; method: 'claim' | 'ack' | 'submit'; count: string; ms: string };
const EMPTY_HOP_FAULT: HopFaultForm = { kind: 'refuse', hash: '', method: 'claim', count: '1', ms: '1000' };
const LOG_MAX = 300;

// A decoded attachment on the wire: the reference the message carries (the
// ticket never reaches the inspector).
type WireAttachment = { kind: string; mimeType: string; fileSize: number; width?: number; height?: number; identifier: string; wssUrl: string | null };
const attachmentLine = (a: WireAttachment) => `📎 ${a.kind} ${a.mimeType} ${a.fileSize}B${a.width ? ` ${a.width}×${a.height}` : ''} id ${shortHex(a.identifier)} on ${a.wssUrl ?? '?'}`;

const summary = (d: Decoded | null): string => {
  if (!d) return '';
  switch (d.kind) {
    case 'chatRequest':
      return d.sealed ? 'chat request (sealed)' : d.undecodable ? 'chat request (undecodable)' : `chat request from ${d.sender?.label ?? shortHex(d.sender?.account)}${d.welcome != null ? ` “${d.welcome}”` : ''}`;
    case 'request':
      return d.sealed ? 'request (sealed)' : `request · ${d.messages?.length ?? 0} message(s)`;
    case 'response':
      return d.sealed ? 'response (sealed)' : `response ${d.responseCode ?? ''}`;
    default:
      return d.kind;
  }
};
const messageLine = (m: NonNullable<Extract<Decoded, { kind: 'request' }>['messages']>[number]): string => {
  if ('undecodable' in m) return `undecodable (${m.bytes} bytes)`;
  const c = m.content;
  const text = typeof c.text === 'string' ? ` “${c.text}”` : '';
  const extra = c.type === 'reaction' ? ` ${String(c.emoji)} on ${shortHex(String(c.messageId))}` : c.type === 'edit' || c.type === 'reply' ? ` → ${shortHex(String(c.messageId))}` : '';
  const attachments = Array.isArray(c.attachments) ? (c.attachments as WireAttachment[]).map(a => `\n    ${attachmentLine(a)}`).join('') : '';
  return `${c.type}${text}${extra}  ${shortHex(m.messageId, 4)}${attachments}`;
};
const eventLine = (e: SandboxEvent): string => {
  const { seq: _s, ts: _t, type: _y, ...rest } = e;
  const flat = JSON.stringify(rest);
  return flat.length > 220 ? `${flat.slice(0, 219)}…` : flat;
};

/** The decoded wire with filters, a statement's detail and slot history, fault and clock controls (mock only), and the live event log. */
export const Wire = ({ session, mock }: Props) => {
  const [peer, setPeer] = useState('');
  const [signer, setSigner] = useState('');
  const [channel, setChannel] = useState('');
  const [selected, setSelected] = useState<Statement | null>(null);
  const [fault, setFault] = useState<FaultForm>(EMPTY_FAULT);
  const [hopFault, setHopFault] = useState<HopFaultForm>(EMPTY_HOP_FAULT);
  const [clockMs, setClockMs] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<SandboxEvent[]>([]);

  const wire = useLoader(() => api.wire({ peer, signer, channel }), [peer, signer, channel]);
  const node = useLoader(() => api.node(), []);
  // The pool view is the mock node's; a real network has no pool to list.
  const hop = useLoader(() => (mock ? api.hop() : Promise.resolve(null)), [mock]);
  const history = useLoader(() => (selected?.channel ? api.history(selected.channel, selected.signer ?? undefined) : Promise.resolve([])), [selected?.channel, selected?.signer]);
  useEvents(() => {
    wire.reload();
    if (selected) history.reload();
  }, ['wire', 'node', 'clock']);
  useEvents(() => node.reload(), ['fault', 'node', 'clock']);
  useEvents(() => hop.reload(), ['hop', 'message']);
  useEvents(event => setLog(prev => [event, ...prev].slice(0, LOG_MAX)));

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      node.reload();
      wire.reload();
    } catch (cause) {
      setError(`${label}: ${errorText(cause, 'failed')}`);
    }
  };
  const addFault = (event: FormEvent) => {
    event.preventDefault();
    const count = fault.count.trim() === '' || fault.count === 'forever' ? null : Number(fault.count);
    void run('fault', () => api.addFault({ kind: fault.kind, from: fault.from.trim() || null, channel: fault.channel.trim() || null, topic: fault.topic.trim() || null, count, ...(fault.kind === 'delay' ? { ms: Number(fault.ms) } : {}) }));
  };
  const addHopFault = (event: FormEvent) => {
    event.preventDefault();
    const count = hopFault.count.trim() === '' || hopFault.count === 'forever' ? null : Number(hopFault.count);
    void run('HOP fault', async () => {
      await api.addHopFault({ kind: hopFault.kind, hash: hopFault.hash.trim() || null, method: hopFault.method, count, ...(hopFault.kind === 'delay' ? { ms: Number(hopFault.ms) } : {}) });
      hop.reload();
    });
  };
  const clearHopFault = (id: number | 'all') =>
    void run('HOP fault', async () => {
      await api.clearHopFault(id);
      hop.reload();
    });
  const peers = [...(session?.personas.map(p => p.name) ?? []), ...(session?.accounts.filter(a => a.username && !session.isPersona(a.account)).map(a => a.username as string) ?? [])];
  const statements = wire.data ?? [];
  const current = selected ? statements.find(s => s.channel === selected.channel && s.signer === selected.signer) ?? selected : null;

  return (
    <div className="wire">
      <div className="stack scroll">
        <section className="panel stack">
          <div className="filters">
            <select className="select" value={peer} aria-label="Peer" onChange={e => setPeer(e.target.value)}>
              <option value="">Any peer</option>
              {peers.map(p => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <input className="input" value={signer} placeholder="Signer (name or account)" aria-label="Signer" onChange={e => setSigner(e.target.value)} />
            <input className="input" style={{ flex: 1, minWidth: 200 }} value={channel} placeholder="Channel (label or hex)" aria-label="Channel" onChange={e => setChannel(e.target.value)} />
            <span className="caption">{statements.length} statement(s)</span>
          </div>
          {wire.error ? <p className="error" role="alert">{wire.error}</p> : null}
          <div className="scroll">
            <table className="grid" data-testid="wire-table">
              <thead>
                <tr>
                  <th>Signer</th>
                  <th>Channel</th>
                  <th>Seq</th>
                  <th>Bytes</th>
                  <th>Decoded</th>
                  <th>ACKs</th>
                </tr>
              </thead>
              <tbody>
                {statements.map(s => (
                  <tr key={`${s.signer}:${s.channel}:${s.sequence}`} className="clickable" aria-selected={current === s} onClick={() => setSelected(s)}>
                    <td>{s.signerLabel ?? <span className="mono">{shortHex(s.signer)}</span>}</td>
                    <td>
                      {s.channelLabel ?? (s.channel ? <span className="mono">{shortHex(s.channel)}</span> : <span className="tertiary">no channel</span>)}
                      {s.replacedCount ? <span className="caption"> ×{s.replacedCount + 1}</span> : null}
                    </td>
                    <td className="mono">{s.sequence}</td>
                    <td className="mono">{s.bytes}</td>
                    <td>{summary(s.decoded)}</td>
                    <td className="caption">{s.acks ? (s.acks.length ? s.acks.map(a => `${a.by} (${a.code})`).join(', ') : 'none') : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {statements.length === 0 ? <p className="empty">Nothing on the wire.</p> : null}
          </div>
        </section>
        {current ? (
          <section className="panel stack" data-testid="statement-detail">
            <div className="row">
              <h2 className="label">
                {current.signerLabel ?? shortHex(current.signer)} · {current.channelLabel ?? shortHex(current.channel) ?? 'no channel'}
              </h2>
              <span className="spacer" style={{ flex: 1 }} />
              <button type="button" className="btn ghost small" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
            <dl className="kv caption">
              <dt>Signer</dt>
              <dd className="mono">{current.signer}</dd>
              <dt>Channel</dt>
              <dd className="mono">{current.channel ?? '—'}</dd>
              <dt>Topics</dt>
              <dd>{current.topics.map(t => t.label ?? t.hex).join(' · ')}</dd>
              <dt>Expiry</dt>
              <dd>
                {current.expiresAt ?? 'never'} · seq {current.sequence}
              </dd>
              <dt>Received</dt>
              <dd>{formatIso(current.receivedAt)}</dd>
              <dt>Parties</dt>
              <dd>{current.parties.join(', ')}</dd>
            </dl>
            {current.decoded ? (
              <div className="nested stack" style={{ gap: 2 }}>
                <div className="label">{summary(current.decoded)}</div>
                {'requestId' in current.decoded && current.decoded.requestId ? <div className="caption mono">request {current.decoded.requestId}</div> : null}
                {'recipients' in current.decoded && current.decoded.recipients ? <div className="caption">for {current.decoded.recipients.map(r => r.label ?? shortHex(r.statementAccountId)).join(', ')}</div> : null}
                {current.decoded.kind === 'request' && current.decoded.messages
                  ? current.decoded.messages.map((m, i) => (
                      <div key={i} className="mono caption">
                        {messageLine(m)}
                      </div>
                    ))
                  : null}
                {current.acks ? <div className="caption">{current.acks.length ? current.acks.map(a => `${a.by} ${a.code}${a.live ? '' : ' (replaced)'} ${formatIso(a.at)}`).join(' · ') : 'no ACK'}</div> : null}
              </div>
            ) : null}
            <h3 className="label">Slot history</h3>
            <table className="grid">
              <tbody>
                {(history.data ?? []).map((h, i) => (
                  <tr key={i}>
                    <td className="mono">{h.sequence}</td>
                    <td className="mono">{h.bytes}B</td>
                    <td>{summary(h.decoded)}</td>
                    <td className="caption">{h.replacedAt ? `${h.reason} ${formatIso(h.replacedAt)}` : 'live'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}
      </div>
      <div className="detail">
        <section className="panel stack">
          <h2 className="label">Node</h2>
          {error ? <p className="error" role="alert">{error}</p> : null}
          <div className="caption">
            {node.data
              ? mock
                ? `${node.data.statements} statement(s) · ${node.data.allowances} allowance(s) · clock ${node.data.clock && node.data.clock.offsetMs >= 0 ? '+' : ''}${node.data.clock?.offsetMs ?? 0} ms`
                : `${node.data.name} · ${node.data.statements} statement(s) seen by the personas · genesis ${shortHex(node.data.genesis)}`
              : '…'}
          </div>
          {!mock ? <p className="empty" data-testid="controls-unavailable">Faults, the clock and node restarts exist on the mock network only; the wire shows what the personas' subscriptions saw.</p> : null}
          {mock ? (
          <>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn small" onClick={() => void run('clock', () => api.clock(10_000 + (node.data?.clock?.offsetMs ?? 0)))}>
              +10 s
            </button>
            <button type="button" className="btn small" onClick={() => void run('clock', () => api.clock(2 * 3_600_000 + (node.data?.clock?.offsetMs ?? 0)))}>
              +2 h
            </button>
            <input className="input" style={{ width: 96 }} value={clockMs} placeholder="ms" aria-label="Clock offset in ms" onChange={e => setClockMs(e.target.value)} />
            <button type="button" className="btn small" disabled={clockMs.trim() === ''} onClick={() => void run('clock', () => api.clock(Number(clockMs)))}>
              Set
            </button>
            <button type="button" className="btn small ghost" onClick={() => void run('clock', () => api.clock(0))}>
              Reset clock
            </button>
          </div>
          <div className="row">
            <button type="button" className="btn small" onClick={() => void run('restart', () => api.restartNode())}>
              Restart node
            </button>
            <button type="button" className="btn small danger" onClick={() => void run('reset', () => api.resetNode())}>
              Reset store
            </button>
          </div>
          </>
          ) : null}
        </section>
        {mock ? (
        <>
        <section className="panel stack">
          <h2 className="label">Faults</h2>
          <form className="stack" style={{ gap: 6 }} onSubmit={addFault}>
            <div className="row">
              <select className="select" value={fault.kind} aria-label="Fault kind" onChange={e => setFault({ ...fault, kind: e.target.value as FaultForm['kind'] })}>
                <option value="drop">drop</option>
                <option value="delay">delay</option>
                <option value="holdDump">hold dump</option>
              </select>
              {fault.kind === 'holdDump' ? null : (
                <input className="input" style={{ width: 90 }} value={fault.count} placeholder="count" aria-label="Count (or forever)" onChange={e => setFault({ ...fault, count: e.target.value })} />
              )}
              {fault.kind === 'delay' ? <input className="input" style={{ width: 80 }} value={fault.ms} placeholder="ms" aria-label="Delay ms" onChange={e => setFault({ ...fault, ms: e.target.value })} /> : null}
            </div>
            {fault.kind === 'holdDump' ? null : (
              <>
                <input className="input" value={fault.from} placeholder="From (persona, bot or account)" aria-label="From" onChange={e => setFault({ ...fault, from: e.target.value })} />
                <input className="input" value={fault.channel} placeholder="Channel (label or hex)" aria-label="Fault channel" onChange={e => setFault({ ...fault, channel: e.target.value })} />
              </>
            )}
            <input className="input" value={fault.topic} placeholder={fault.kind === 'holdDump' ? 'Topic (e.g. request→bob)' : 'Topic (label or hex)'} aria-label="Fault topic" onChange={e => setFault({ ...fault, topic: e.target.value })} />
            <div className="row">
              <button type="submit" className="btn small primary">
                Add fault
              </button>
              <button type="button" className="btn small ghost" disabled={!node.data?.faults.length} onClick={() => void run('clear', () => api.clearFault('all'))}>
                Clear all
              </button>
            </div>
          </form>
          {node.data?.faults.length === 0 ? <p className="empty">No faults.</p> : null}
          <ul className="stack" style={{ gap: 4 }}>
            {node.data?.faults.map(f => (
              <li key={f.id} className="nested row caption" data-testid="fault-row">
                <span className="label">
                  #{f.id} {f.kind}
                </span>
                <span>
                  {f.signer ? `from ${f.signer.map(s => shortHex(s)).join(',')} ` : ''}
                  {f.channel ? `channel ${shortHex(f.channel)} ` : ''}
                  {f.topic ? `topic ${shortHex(f.topic)} ` : ''}
                  {f.ms != null ? `${f.ms} ms ` : ''}
                  hits {f.hits}
                  {f.count != null ? `/${f.count}` : ''}
                  {f.held ? ` holding ${f.held}` : ''}
                </span>
                <span className="spacer" style={{ flex: 1 }} />
                <button type="button" className="btn ghost small" onClick={() => void run('clear', () => api.clearFault(f.id))}>
                  Clear
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel stack" data-testid="hop-panel">
          <h2 className="label">HOP pool</h2>
          <div className="caption">
            {hop.data ? `${hop.data.url} · ${hop.data.status.entryCount} live entr${hop.data.status.entryCount === 1 ? 'y' : 'ies'} · ${hop.data.status.totalBytes} of ${hop.data.status.maxBytes} bytes` : '…'}
          </div>
          {hop.data && hop.data.entries.length === 0 ? <p className="empty">No entries yet.</p> : null}
          <table className="grid">
            <tbody>
              {hop.data?.entries.map(e => (
                <tr key={e.hash} data-testid="hop-entry" data-available={e.available}>
                  <td className="mono">{shortHex(e.hash)}</td>
                  <td>
                    {e.role ?? 'entry'}
                    {e.owner ? <span className="caption"> {e.owner}</span> : null}
                  </td>
                  <td className="mono">{e.bytes}B</td>
                  <td className="caption">
                    by {e.signerLabel ?? (e.signer ? shortHex(e.signer) : 'fixture')} · claimed ×{e.claims}
                    {e.acked ? ' · acked' : ''}
                    {e.available ? '' : ` · gone (${e.reason ?? 'removed'})`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <form className="stack" style={{ gap: 6 }} onSubmit={addHopFault}>
            <div className="row">
              <select className="select" value={hopFault.kind} aria-label="HOP fault kind" onChange={e => setHopFault({ ...hopFault, kind: e.target.value as HopFaultKind })}>
                {(['refuse', 'cut', 'delay', 'drop', 'corrupt'] as const).map(k => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <select className="select" value={hopFault.method} aria-label="HOP fault method" onChange={e => setHopFault({ ...hopFault, method: e.target.value as HopFaultForm['method'] })}>
                <option value="claim">claim</option>
                <option value="ack">ack</option>
                <option value="submit">submit</option>
              </select>
              <input className="input" style={{ width: 90 }} value={hopFault.count} placeholder="count" aria-label="HOP fault count (or forever)" onChange={e => setHopFault({ ...hopFault, count: e.target.value })} />
              {hopFault.kind === 'delay' ? <input className="input" style={{ width: 80 }} value={hopFault.ms} placeholder="ms" aria-label="HOP delay ms" onChange={e => setHopFault({ ...hopFault, ms: e.target.value })} /> : null}
            </div>
            <input className="input" value={hopFault.hash} placeholder="Entry hash (blank: any)" aria-label="HOP fault entry" onChange={e => setHopFault({ ...hopFault, hash: e.target.value })} />
            <div className="row">
              <button type="submit" className="btn small primary">
                Add HOP fault
              </button>
              <button type="button" className="btn small ghost" disabled={!hop.data?.faults.length} onClick={() => clearHopFault('all')}>
                Clear all
              </button>
            </div>
          </form>
          <ul className="stack" style={{ gap: 4 }}>
            {hop.data?.faults.map(f => (
              <li key={f.id} className="nested row caption" data-testid="hop-fault-row">
                <span className="label">
                  #{f.id} {f.kind}
                </span>
                <span>
                  on {f.method}
                  {f.hash ? ` of ${shortHex(f.hash)}` : ''}
                  {f.ms != null ? ` ${f.ms} ms` : ''} hits {f.hits}
                  {f.count != null ? `/${f.count}` : ''}
                </span>
                <span className="spacer" style={{ flex: 1 }} />
                <button type="button" className="btn ghost small" onClick={() => clearHopFault(f.id)}>
                  Clear
                </button>
              </li>
            ))}
          </ul>
        </section>
        </>
        ) : null}
        <section className="panel stack" style={{ flex: 1, minHeight: 160 }}>
          <div className="row">
            <h2 className="label">Events</h2>
            <span className="spacer" style={{ flex: 1 }} />
            <button type="button" className="btn ghost small" onClick={() => setLog([])}>
              Clear
            </button>
          </div>
          <div className="log scroll" data-testid="event-log">
            {log.length === 0 ? <p className="empty">Events show here as they happen.</p> : null}
            {log.map(e => (
              <div key={e.seq}>
                <span className="t">{e.ts.slice(11, 23)}</span> <span className="type">{e.type}</span> {eventLine(e)}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};
