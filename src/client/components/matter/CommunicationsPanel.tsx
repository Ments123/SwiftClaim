import {
  CheckCircle2,
  FileCheck2,
  LockKeyhole,
  MailPlus,
  MessageSquareText,
  Phone,
  PhoneCall,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  jsonBody,
  request,
  type CommunicationDraft,
  type CommunicationEntry,
  type CommunicationWorkspace,
  type MatterDocument,
} from '../../api.js';
import { Dialog } from '../Dialog.js';
import { CommunicationCallDialog } from './CommunicationCallDialog.js';
import { CommunicationComposeDialog } from './CommunicationComposeDialog.js';

interface Props {
  matterId: string;
  workspace: CommunicationWorkspace;
  onRefresh: () => Promise<void>;
  documents?: MatterDocument[];
}

const channelLabels: Record<string, string> = {
  email: 'Email',
  whatsapp: 'WhatsApp',
  telephone: 'Telephone',
  letter: 'Letter / post',
  portal: 'Portal',
  sms: 'SMS',
  in_person: 'In person',
  internal: 'Internal',
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function transportLabel(state: string): string {
  const labels: Record<string, string> = {
    recorded: 'Recorded',
    queued: 'Queued',
    attempting: 'Dispatching',
    provider_accepted: 'Accepted by provider',
    delivered: 'Delivered',
    failed: 'Failed',
    read: 'Read receipt',
    cancelled: 'Cancelled',
  };
  return labels[state] ?? state.replaceAll('_', ' ');
}

export function CommunicationsPanel({ matterId, workspace, onRefresh, documents = [] }: Props) {
  const [channel, setChannel] = useState('all');
  const [direction, setDirection] = useState('all');
  const [confidentiality, setConfidentiality] = useState('all');
  const [selectedId, setSelectedId] = useState(workspace.entries[0]?.id ?? '');
  const [composeOpen, setComposeOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const [dispatchDraft, setDispatchDraft] = useState<CommunicationDraft | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState('');

  const filtered = useMemo(
    () => workspace.entries.filter((entry) =>
      (channel === 'all' || entry.channel === channel) &&
      (direction === 'all' || entry.direction === direction) &&
      (confidentiality === 'all' || entry.confidentiality === confidentiality),
    ),
    [channel, confidentiality, direction, workspace.entries],
  );

  const selected = filtered.find(({ id }) => id === selectedId) ?? filtered[0];
  const provider = workspace.providerCapabilities.find(({ key }) => key === 'evaluation');
  const callingReason = provider?.reasons.start_whatsapp_call ?? 'WhatsApp Calling is not configured.';

  const dispatch = async () => {
    if (!dispatchDraft) return;
    setDispatching(true);
    setDispatchError('');
    try {
      await request(
        `/api/matters/${matterId}/communication-drafts/${dispatchDraft.id}/dispatch`,
        {
          method: 'POST',
          body: jsonBody({
            expectedVersion: dispatchDraft.recordVersion,
            idempotencyKey: crypto.randomUUID(),
            providerKey: 'evaluation',
            confirmed: true,
          }),
        },
      );
      setDispatchDraft(null);
      await onRefresh();
    } catch (reason) {
      setDispatchError(reason instanceof Error ? reason.message : 'Dispatch failed.');
    } finally {
      setDispatching(false);
    }
  };

  return (
    <section className="communications-workspace" aria-labelledby="communications-title">
      <header className="communications-header">
        <div>
          <span className="eyebrow">One ledger, explicit provenance</span>
          <h2 id="communications-title">Communications</h2>
          <p>Messages, calls and letters remain distinct from delivery evidence and formal service.</p>
        </div>
        <div className="communications-actions">
          {workspace.permissions.canWrite ? <button className="button button--secondary button--small" type="button" onClick={() => setCallOpen(true)}><Phone size={15} /> Record call</button> : null}
          {workspace.permissions.canWrite ? <button className="button button--primary button--small" type="button" onClick={() => setComposeOpen(true)}><MailPlus size={15} /> Compose</button> : null}
        </div>
      </header>

      <div className="communications-position-strip">
        <div><MessageSquareText size={17} /><span>Recorded</span><strong>{workspace.counts.total}</strong></div>
        <div><Send size={17} /><span>Outbound</span><strong>{workspace.counts.outbound}</strong></div>
        <div><LockKeyhole size={17} /><span>Drafts</span><strong>{workspace.counts.drafts}</strong></div>
      </div>

      <div className="communications-capability-note">
        <button type="button" className="button button--ghost button--small" disabled={!provider?.operations.start_whatsapp_call} aria-label="Start WhatsApp call"><PhoneCall size={15} /> Start WhatsApp call</button>
        {!provider?.operations.start_whatsapp_call ? <span>{callingReason}</span> : null}
      </div>

      <div className="communications-filters" aria-label="Communication filters">
        <label><span>Channel</span><select aria-label="Channel" value={channel} onChange={(event) => setChannel(event.target.value)}><option value="all">All channels</option><option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="telephone">Telephone</option><option value="letter">Letter / post</option><option value="internal">Internal</option></select></label>
        <label><span>Direction</span><select aria-label="Direction" value={direction} onChange={(event) => setDirection(event.target.value)}><option value="all">All directions</option><option value="inbound">Inbound</option><option value="outbound">Outbound</option><option value="internal">Internal</option></select></label>
        <label><span>Confidentiality</span><select aria-label="Confidentiality" value={confidentiality} onChange={(event) => setConfidentiality(event.target.value)}><option value="all">All visible</option><option value="ordinary">Ordinary</option><option value="internal">Internal</option><option value="privileged">Privileged</option><option value="protected_negotiation">Protected negotiation</option></select></label>
      </div>

      <div className="communications-layout">
        <div className="communications-ledger" aria-label="Communication ledger">
          {filtered.length ? filtered.map((entry) => (
            <button key={entry.id} type="button" className={selected?.id === entry.id ? 'is-active' : ''} onClick={() => setSelectedId(entry.id)}>
              <span className="communication-channel">{channelLabels[entry.channel]}</span>
              <strong>{entry.subject || 'Untitled communication'}</strong>
              <small>{entry.participants.map(({ displayName }) => displayName).join(', ')}</small>
              <time>{formatDate(entry.occurredAt)}</time>
            </button>
          )) : <div className="communications-empty"><MessageSquareText size={24} /><strong>No matching communications</strong><span>Change the filters or record the first communication.</span></div>}
        </div>
        <CommunicationDetail entry={selected} />
      </div>

      {workspace.drafts.length ? (
        <section className="communication-drafts" aria-labelledby="communication-drafts-title">
          <header><div><span className="eyebrow">Controlled outbound work</span><h3 id="communication-drafts-title">Drafts & dispatch</h3></div></header>
          {workspace.drafts.map((draft) => (
            <article key={draft.id}>
              <div><span className="communication-channel">{channelLabels[draft.channel]}</span><strong>{draft.currentVersion.subject || 'Untitled draft'}</strong><small>v{draft.currentVersion.version} · {draft.confidentiality.replaceAll('_', ' ')}</small></div>
              <div className="communication-draft-state"><span>{draft.dispatch ? transportLabel(draft.dispatch.transport.state) : draft.status.replaceAll('_', ' ')}</span>{draft.currentApproval ? <small><CheckCircle2 size={13} /> Exact version approved</small> : null}</div>
              {workspace.permissions.canSend && !draft.dispatch && (draft.confidentiality === 'ordinary' || draft.currentApproval) ? <button className="button button--secondary button--small" type="button" onClick={() => setDispatchDraft(draft)}><Send size={14} /> {draft.currentApproval ? 'Dispatch approved draft' : 'Dispatch draft'}</button> : null}
            </article>
          ))}
        </section>
      ) : null}

      <CommunicationComposeDialog open={composeOpen} matterId={matterId} documents={documents} onClose={() => setComposeOpen(false)} onSaved={onRefresh} />
      <CommunicationCallDialog open={callOpen} matterId={matterId} documents={documents} onClose={() => setCallOpen(false)} onSaved={onRefresh} />
      <Dialog open={Boolean(dispatchDraft)} title="Confirm external dispatch" description="This sends the exact current draft version to the evaluation provider. Provider acceptance is not delivery or service." onClose={() => setDispatchDraft(null)}>
        <div className="dispatch-confirmation"><ShieldCheck size={24} /><p><strong>{dispatchDraft?.currentVersion.subject || 'Untitled draft'}</strong><br />Recipients: {dispatchDraft?.currentVersion.participants.map(({ displayName, endpoint }) => `${displayName} (${endpoint})`).join(', ')}</p>{dispatchError ? <div className="form-alert" role="alert">{dispatchError}</div> : null}<div className="form-actions"><button className="button button--secondary" type="button" onClick={() => setDispatchDraft(null)}>Cancel</button><button className="button button--primary" type="button" disabled={dispatching} onClick={() => void dispatch()}>{dispatching ? 'Dispatching…' : 'Confirm dispatch'}</button></div></div>
      </Dialog>
    </section>
  );
}

function CommunicationDetail({ entry }: { entry: CommunicationEntry | undefined }) {
  if (!entry) return <div className="communication-detail communications-empty"><MessageSquareText size={28} /><strong>Select a communication</strong><span>Its immutable record and provenance will appear here.</span></div>;
  return (
    <article className="communication-detail">
      <header><div><span className="eyebrow">{entry.direction} · {entry.source}</span><h3>{entry.subject || 'Untitled communication'}</h3></div><span className={`transport-badge transport-badge--${entry.transport.state}`}>{transportLabel(entry.transport.state)}</span></header>
      <div className="communication-badges"><span>{channelLabels[entry.channel]}</span><span>{entry.confidentiality.replaceAll('_', ' ')}</span>{entry.call?.identityCheckStatus === 'confirmed' ? <span><ShieldCheck size={12} /> Identity confirmed</span> : null}{entry.serviceAssertion ? <span><FileCheck2 size={12} /> Service {entry.serviceAssertion.reviewStatus}</span> : null}</div>
      <dl><div><dt>Participants</dt><dd>{entry.participants.map(({ displayName, endpoint }) => `${displayName} · ${endpoint}`).join('; ')}</dd></div><div><dt>Occurred</dt><dd>{formatDate(entry.occurredAt)}</dd></div></dl>
      <p className="communication-body">{entry.body}</p>
      {entry.call ? <div className="call-provenance"><Phone size={16} /><div><strong>{Math.round(entry.call.durationSeconds / 60)} minute call</strong><small>{entry.call.recordingStatus.replaceAll('_', ' ')} · {entry.call.outcome}</small></div></div> : null}
      {entry.serviceAssertion ? <div className="call-provenance"><FileCheck2 size={16} /><div><strong>Service asserted — {entry.serviceAssertion.reviewStatus}</strong><small>{entry.serviceAssertion.assertedMethod.replaceAll('_', ' ')} · {entry.serviceAssertion.recipient} · {formatDate(entry.serviceAssertion.serviceAt)}</small></div></div> : null}
      {entry.attachments.length ? <div className="communication-attachments">{entry.attachments.map((attachment) => <div key={`${attachment.documentVersionId}-${attachment.purpose}`}><FileCheck2 size={17} /><div><strong>{attachment.fileName}</strong><small>Immutable version · {attachment.purpose}</small></div><code title={attachment.sha256}>{attachment.sha256.slice(0, 10)}…</code></div>)}</div> : null}
    </article>
  );
}
