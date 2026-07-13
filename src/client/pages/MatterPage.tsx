import {
  Activity,
  ArrowLeft,
  CalendarClock,
  Check,
  ChevronRight,
  ClipboardCheck,
  Download,
  FileCheck2,
  FileText,
  Fingerprint,
  Mail,
  MapPin,
  Paperclip,
  Phone,
  Plus,
  RefreshCw,
  ShieldCheck,
  Upload,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import {
  ApiError,
  jsonBody,
  request,
  type MatterAggregate,
} from '../api.js';
import { Dialog } from '../components/Dialog.js';

type Tab = 'overview' | 'people' | 'documents' | 'tasks' | 'activity' | 'audit';

interface MatterPageProps {
  matterId: string;
  onBack: () => void;
}

const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'people', label: 'People' },
  { id: 'documents', label: 'Documents' },
  { id: 'tasks', label: 'Tasks & deadlines' },
  { id: 'activity', label: 'Activity' },
  { id: 'audit', label: 'Audit' },
];

function formatDate(value: string, includeTime = false) {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(new Date(value));
}

function formatBytes(bytes: number) {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export function MatterPage({ matterId, onBack }: MatterPageProps) {
  const [aggregate, setAggregate] = useState<MatterAggregate>();
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('overview');
  const [partyOpen, setPartyOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [documentOpen, setDocumentOpen] = useState(false);
  const [updatingTask, setUpdatingTask] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      setAggregate(await request<MatterAggregate>(`/api/matters/${matterId}`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Matter unavailable.');
    }
  }, [matterId]);

  useEffect(() => {
    setAggregate(undefined);
    setTab('overview');
    void load();
  }, [load]);

  const completeTask = async (taskId: string) => {
    setUpdatingTask(taskId);
    try {
      await request(`/api/matters/${matterId}/tasks/${taskId}`, {
        method: 'PATCH',
        body: jsonBody({ status: 'completed' }),
      });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Task update failed.');
    } finally {
      setUpdatingTask('');
    }
  };

  if (!aggregate && !error) {
    return <main className="page matter-loading"><div className="skeleton skeleton--heading" /><div className="surface skeleton skeleton--matter" /></main>;
  }

  if (!aggregate) {
    return (
      <main className="page page-state">
        <FileText size={34} /><h1>Matter unavailable</h1><p>{error}</p>
        <div className="button-row"><button className="button button--secondary" type="button" onClick={onBack}><ArrowLeft size={16} /> Back</button><button className="button button--primary" type="button" onClick={() => void load()}><RefreshCw size={16} /> Retry</button></div>
      </main>
    );
  }

  const { matter } = aggregate;
  const openTasks = aggregate.tasks.filter((task) => !['completed', 'cancelled'].includes(task.status));

  return (
    <main className="page page--matter">
      <button className="back-link" type="button" onClick={onBack}><ArrowLeft size={16} /> Back to matters</button>

      <header className="matter-header">
        <div className="matter-header__main">
          <div className="matter-header__topline">
            <span className="reference-chip">{matter.reference}</span>
            <span className={`risk-pill risk-pill--${matter.riskLevel}`}>{matter.riskLevel} risk</span>
            <span className="status-pill"><span /> {matter.status}</span>
          </div>
          <h1>{matter.title}</h1>
          <p><strong>{matter.clientName}</strong> <span>·</span> {matter.matterType}</p>
        </div>
        <dl className="matter-header__facts">
          <div><dt>Stage</dt><dd>{matter.stage}</dd></div>
          <div><dt>Owner</dt><dd>{matter.owner.name}</dd></div>
          <div><dt>Next deadline</dt><dd>{matter.nextDeadline ? formatDate(matter.nextDeadline) : 'None set'}</dd></div>
        </dl>
      </header>

      <nav className="matter-tabs" aria-label="Matter sections">
        {tabs.map((item) => (
          <button type="button" key={item.id} className={tab === item.id ? 'is-active' : ''} onClick={() => setTab(item.id)}>
            {item.label}
            {item.id === 'tasks' && openTasks.length ? <span>{openTasks.length}</span> : null}
          </button>
        ))}
      </nav>

      {error ? <div className="inline-notice inline-notice--error" role="alert">{error}</div> : null}

      {tab === 'overview' ? (
        <div className="matter-overview-grid">
          <section className="surface matter-description">
            <header className="section-header"><div><span className="eyebrow">Matter position</span><h2>Overview</h2></div></header>
            <p>{matter.description || 'No matter description has been recorded.'}</p>
            <dl className="detail-list">
              <div><dt>Opened</dt><dd>{formatDate(matter.openedAt)}</dd></div>
              <div><dt>Legacy source</dt><dd>{matter.externalSource ?? 'SwiftClaim native'}</dd></div>
              <div><dt>Legacy ID</dt><dd>{matter.externalId ?? 'Not supplied'}</dd></div>
            </dl>
          </section>
          <section className="surface next-actions">
            <header className="section-header"><div><span className="eyebrow">Next actions</span><h2>Deadlines</h2></div><button type="button" onClick={() => setTab('tasks')}>View all <ChevronRight size={14} /></button></header>
            {openTasks.slice(0, 3).map((task) => (
              <div className="mini-task" key={task.id}>
                <span className={`priority-marker priority-marker--${task.priority}`} />
                <div><strong>{task.title}</strong><small>{task.assignee.name} · {formatDate(task.dueAt)}</small></div>
              </div>
            ))}
            {!openTasks.length ? <div className="empty-state empty-state--compact"><Check size={24} /><strong>No open deadlines</strong></div> : null}
          </section>
          <section className="surface matter-metrics">
            <div><span className="metric-icon"><UsersRound size={18} /></span><strong>{aggregate.parties.length}</strong><small>People & organisations</small></div>
            <div><span className="metric-icon"><Paperclip size={18} /></span><strong>{aggregate.documents.length}</strong><small>Preserved documents</small></div>
            <div><span className="metric-icon"><Activity size={18} /></span><strong>{aggregate.timeline.length}</strong><small>Timeline events</small></div>
          </section>
          <section className="surface recent-activity">
            <header className="section-header"><div><span className="eyebrow">Chronology</span><h2>Recent activity</h2></div><button type="button" onClick={() => setTab('activity')}>Full timeline <ChevronRight size={14} /></button></header>
            <Timeline events={aggregate.timeline.slice(0, 4)} />
          </section>
        </div>
      ) : null}

      {tab === 'people' ? (
        <section className="surface tab-surface">
          <header className="section-header section-header--page"><div><span className="eyebrow">Matter contacts</span><h2>People & organisations</h2></div>{aggregate.permissions.canWrite ? <button className="button button--primary button--small" type="button" onClick={() => setPartyOpen(true)}><Plus size={16} /> Add party</button> : null}</header>
          {aggregate.parties.length ? <div className="people-grid">{aggregate.parties.map((party) => (
            <article className="person-card" key={party.id}>
              <div className="person-card__header"><span className="person-icon"><UserRound size={18} /></span><span><small>{party.kind}</small><strong>{party.name}</strong></span></div>
              {party.organisation ? <p>{party.organisation}</p> : null}
              <ul>{party.email ? <li><Mail size={14} /> {party.email}</li> : null}{party.phone ? <li><Phone size={14} /> {party.phone}</li> : null}{party.address ? <li><MapPin size={14} /> {party.address}</li> : null}</ul>
              {party.externalId ? <footer>Legacy ID · {party.externalId}</footer> : null}
            </article>
          ))}</div> : <Empty icon={<UsersRound />} title="No parties recorded" text="Add the client, opponent, experts and other matter participants." />}
        </section>
      ) : null}

      {tab === 'documents' ? (
        <section className="surface tab-surface">
          <header className="section-header section-header--page"><div><span className="eyebrow">Evidence register</span><h2>Documents</h2></div>{aggregate.permissions.canWrite ? <button className="button button--primary button--small" type="button" onClick={() => setDocumentOpen(true)}><Upload size={16} /> Upload document</button> : null}</header>
          <div className="document-security"><ShieldCheck size={17} /><span>Every stored version is immutable and SHA-256 verified.</span></div>
          {aggregate.documents.length ? <div className="document-list">{aggregate.documents.map((document) => (
            <article className="document-row" key={document.id}>
              <span className="document-icon"><FileCheck2 size={20} /></span>
              <div className="document-row__main"><strong>{document.title}</strong><small>{document.category} · {document.latestVersion?.originalName}</small></div>
              <div className="document-row__meta"><span>v{document.latestVersion?.version}</span><span>{formatBytes(document.latestVersion?.sizeBytes ?? 0)}</span><code title={document.latestVersion?.sha256}>{document.latestVersion?.sha256.slice(0, 10)}…</code></div>
              <a className="icon-button" href={`/api/matters/${matterId}/documents/${document.id}/download`} aria-label={`Download ${document.title}`}><Download size={17} /></a>
            </article>
          ))}</div> : <Empty icon={<FileText />} title="No documents yet" text="Upload a document to create the first immutable version." />}
        </section>
      ) : null}

      {tab === 'tasks' ? (
        <section className="surface tab-surface">
          <header className="section-header section-header--page"><div><span className="eyebrow">Controlled work</span><h2>Tasks & deadlines</h2></div>{aggregate.permissions.canWrite ? <button className="button button--primary button--small" type="button" onClick={() => setTaskOpen(true)}><Plus size={16} /> Add deadline</button> : null}</header>
          {aggregate.tasks.length ? <div className="task-list">{aggregate.tasks.map((task) => (
            <article className={`task-row ${task.status === 'completed' ? 'task-row--complete' : ''}`} key={task.id}>
              <span className={`task-check ${task.status === 'completed' ? 'is-complete' : ''}`}>{task.status === 'completed' ? <Check size={15} /> : null}</span>
              <div className="task-row__main"><strong>{task.title}</strong><p>{task.notes || 'No notes'}</p><small><UserRound size={13} /> {task.assignee.name}</small></div>
              <div className="task-row__due"><span className={`priority-pill priority-pill--${task.priority}`}>{task.priority}</span><strong>{formatDate(task.dueAt)}</strong><small>{task.status.replace('_', ' ')}</small></div>
              {aggregate.permissions.canWrite && !['completed', 'cancelled'].includes(task.status) ? <button className="button button--ghost button--small" type="button" disabled={updatingTask === task.id} onClick={() => void completeTask(task.id)}><Check size={15} /> {updatingTask === task.id ? 'Saving…' : 'Complete'}</button> : null}
            </article>
          ))}</div> : <Empty icon={<ClipboardCheck />} title="No tasks or deadlines" text="Create a controlled action and assign it to a member of the firm." />}
        </section>
      ) : null}

      {tab === 'activity' ? <section className="surface tab-surface"><header className="section-header section-header--page"><div><span className="eyebrow">Matter chronology</span><h2>Activity timeline</h2></div><span className="count-badge">{aggregate.timeline.length}</span></header><Timeline events={aggregate.timeline} /></section> : null}

      {tab === 'audit' ? (
        <section className="surface tab-surface">
          <header className="section-header section-header--page"><div><span className="eyebrow">Append-only evidence</span><h2>Audit trail</h2></div><span className="audit-seal"><Fingerprint size={16} /> Protected</span></header>
          {aggregate.audit.length ? <div className="audit-list">{aggregate.audit.map((event) => <article key={event.id}><span className="audit-action">{event.action}</span><div><strong>{event.actorName}</strong><small>{event.entityType} · {event.entityId.slice(0, 8)}</small></div><time>{formatDate(event.createdAt, true)}</time><code>{event.requestId.slice(0, 12)}</code></article>)}</div> : <Empty icon={<Fingerprint />} title="No audited mutations yet" text="Changes made in SwiftClaim appear here and cannot be edited or deleted." />}
        </section>
      ) : null}

      <AddPartyDialog open={partyOpen} matterId={matterId} onClose={() => setPartyOpen(false)} onSaved={load} />
      <AddTaskDialog open={taskOpen} matterId={matterId} team={aggregate.team} onClose={() => setTaskOpen(false)} onSaved={load} />
      <UploadDocumentDialog open={documentOpen} matterId={matterId} onClose={() => setDocumentOpen(false)} onSaved={load} />
    </main>
  );
}

function Timeline({ events }: { events: MatterAggregate['timeline'] }) {
  return events.length ? <div className="timeline">{events.map((event) => <article key={event.id}><span className="timeline-dot" /><div><strong>{event.title}</strong><p>{event.detail}</p><small>{event.actorName} · {formatDate(event.occurredAt, true)}</small></div></article>)}</div> : <Empty icon={<Activity />} title="No timeline events" text="Matter activity will appear here." />;
}

function Empty({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <div className="empty-state">{icon}<strong>{title}</strong><p>{text}</p></div>;
}

function MutationForm({ children, error, submitting, onClose, submitLabel }: { children: React.ReactNode; error: string; submitting: boolean; onClose: () => void; submitLabel: string }) {
  return <>{children}{error ? <div className="form-alert form-field--wide" role="alert">{error}</div> : null}<div className="form-actions form-field--wide"><button className="button button--secondary" type="button" onClick={onClose}>Cancel</button><button className="button button--primary" type="submit" disabled={submitting}>{submitting ? 'Saving…' : submitLabel}</button></div></>;
}

function AddPartyDialog({ open, matterId, onClose, onSaved }: { open: boolean; matterId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [error, setError] = useState(''); const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSubmitting(true); setError(''); const form = new FormData(event.currentTarget); try { await request(`/api/matters/${matterId}/parties`, { method: 'POST', body: jsonBody(Object.fromEntries(form)) }); onClose(); await onSaved(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Party creation failed.'); } finally { setSubmitting(false); } };
  return <Dialog open={open} title="Add a matter party" description="Record a client, opponent, expert or other participant." onClose={onClose}><form className="form-grid" onSubmit={submit}><label className="form-field"><span>Role</span><select name="kind" defaultValue="expert"><option value="client">Client</option><option value="opponent">Opponent</option><option value="solicitor">Solicitor</option><option value="barrister">Barrister</option><option value="expert">Expert</option><option value="witness">Witness</option><option value="court">Court</option><option value="insurer">Insurer</option><option value="other">Other</option></select></label><label className="form-field"><span>Name</span><input name="name" required /></label><label className="form-field form-field--wide"><span>Organisation</span><input name="organisation" /></label><label className="form-field"><span>Email</span><input name="email" type="email" /></label><label className="form-field"><span>Phone</span><input name="phone" /></label><label className="form-field form-field--wide"><span>Address</span><textarea name="address" rows={2} /></label><MutationForm error={error} submitting={submitting} onClose={onClose} submitLabel="Add party">{null}</MutationForm></form></Dialog>;
}

function AddTaskDialog({ open, matterId, team, onClose, onSaved }: { open: boolean; matterId: string; team: MatterAggregate['team']; onClose: () => void; onSaved: () => Promise<void> }) {
  const [error, setError] = useState(''); const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSubmitting(true); setError(''); const form = new FormData(event.currentTarget); const dueLocal = String(form.get('dueAt')); try { await request(`/api/matters/${matterId}/tasks`, { method: 'POST', body: jsonBody({ title: form.get('title'), notes: form.get('notes'), dueAt: new Date(dueLocal).toISOString(), priority: form.get('priority'), assigneeUserId: form.get('assigneeUserId') }) }); onClose(); await onSaved(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Deadline creation failed.'); } finally { setSubmitting(false); } };
  return <Dialog open={open} title="Add a task or deadline" description="Assign controlled work to a member of the firm." onClose={onClose}><form className="form-grid" onSubmit={submit}><label className="form-field form-field--wide"><span>Title</span><input name="title" required /></label><label className="form-field"><span>Due</span><input name="dueAt" type="datetime-local" defaultValue="2026-07-20T16:00" required /></label><label className="form-field"><span>Priority</span><select name="priority" defaultValue="normal"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label><label className="form-field form-field--wide"><span>Assignee</span><select name="assigneeUserId" defaultValue={team[0]?.id}>{team.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.role}</option>)}</select></label><label className="form-field form-field--wide"><span>Notes</span><textarea name="notes" rows={3} /></label><MutationForm error={error} submitting={submitting} onClose={onClose} submitLabel="Add deadline">{null}</MutationForm></form></Dialog>;
}

function UploadDocumentDialog({ open, matterId, onClose, onSaved }: { open: boolean; matterId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [error, setError] = useState(''); const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSubmitting(true); setError(''); const form = new FormData(event.currentTarget); try { await request(`/api/matters/${matterId}/documents`, { method: 'POST', body: form }); onClose(); await onSaved(); } catch (reason) { setError(reason instanceof ApiError ? reason.message : 'Document upload failed.'); } finally { setSubmitting(false); } };
  return <Dialog open={open} title="Preserve a document" description="Upload one file up to 25 MiB. SwiftClaim stores an immutable version and SHA-256 digest." onClose={onClose}><form className="form-grid" onSubmit={submit}><label className="form-field form-field--wide"><span>Document title</span><input name="title" required /></label><label className="form-field form-field--wide"><span>Category</span><input name="category" placeholder="Correspondence, evidence, pleading…" required /></label><label className="file-drop form-field--wide"><Upload size={22} /><span><strong>Choose a file</strong><small>Maximum 25 MiB</small></span><input name="file" type="file" required /></label><MutationForm error={error} submitting={submitting} onClose={onClose} submitLabel="Upload & preserve">{null}</MutationForm></form></Dialog>;
}
