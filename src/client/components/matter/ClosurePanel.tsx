import { AlertTriangle, ArchiveRestore, CalendarClock, FileCheck2, History, LockKeyhole, RefreshCw, Scale, ShieldCheck } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';

import { request, type ClosureWorkspace, type TeamMember } from '../../api.js';
import type { ClosureCommand } from './ClosureDialogs.js';

const ClosureDialogs = lazy(() => import('./ClosureDialogs.js').then((module) => ({ default: module.ClosureDialogs })));
interface DocumentSource { id: string; title: string; version: number }
interface Props { matterId: string; initialWorkspace?: ClosureWorkspace; team: TeamMember[]; documents: DocumentSource[] }
const label = (value: string) => value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
const date = (value: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));

export function ClosurePanel({ matterId, initialWorkspace, team, documents }: Props) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [command, setCommand] = useState<ClosureCommand | null>(null);
  const [loading, setLoading] = useState(!initialWorkspace);
  const [error, setError] = useState('');
  const load = useCallback(async (signal?: AbortSignal) => {
    setError('');
    try { setWorkspace(await request<ClosureWorkspace>(`/api/matters/${matterId}/closure`, { signal })); }
    catch (caught) { if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(caught instanceof Error ? caught.message : 'Closure and retention are unavailable.'); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [matterId]);
  useEffect(() => { if (initialWorkspace) return; const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [initialWorkspace, load]);
  if (loading && !workspace) return <section className="surface tab-surface" aria-busy="true"><div className="skeleton skeleton--heading" /></section>;
  if (!workspace) return <section className="surface tab-surface page-state"><ArchiveRestore size={30} /><h2>Closure unavailable</h2><p>{error}</p>
    <button className="button button--secondary" type="button" onClick={() => void load()}><RefreshCw size={15} /> Retry</button></section>;
  const blockers = workspace.currentReadiness.blockers;
  const critical = blockers.filter((item) => item.severity === 'critical');
  const activeHolds = workspace.holds.filter((item) => item.status === 'applied');
  return <section className="closure-workspace">
    <header className="finance-header"><div><span className="eyebrow">Governed file lifecycle</span><h2>Closure & retention</h2><p>Final reporting, obligations, authority, retention and reopening remain independently auditable.</p></div>
      <span className="governance-state"><ShieldCheck size={14} /> Human authority only</span></header>
    {workspace.readOnly ? <div className="closure-readonly" role="status"><LockKeyhole size={18} /><div><strong>This matter is read-only</strong><span>Ordinary work is blocked. Use governed reopening to create a new active period.</span></div></div> : null}
    {error ? <div className="inline-notice inline-notice--error" role="alert">{error}</div> : null}
    <div className="closure-actions">
      {workspace.status === 'active' && workspace.permissions.canPrepare && critical.length === 0 ? <button className="button button--primary" type="button" onClick={() => setCommand({ kind: 'prepare' })}>Prepare closure</button> : null}
      {workspace.status === 'prepared' && workspace.permissions.canApprove && workspace.review?.preparedBy !== workspace.actingUserId ? <button className="button button--primary" type="button" onClick={() => setCommand({ kind: 'approve' })}>Approve closure</button> : null}
      {workspace.status === 'approved' && workspace.permissions.canApprove ? <button className="button button--primary" type="button" onClick={() => setCommand({ kind: 'close' })}>Close matter</button> : null}
      {workspace.status === 'closed' && workspace.permissions.canReopen ? <button className="button button--primary" type="button" onClick={() => setCommand({ kind: 'reopen' })}><ArchiveRestore size={16} /> Reopen matter</button> : null}
      {workspace.permissions.canManageHold ? <button className="button button--secondary" type="button" onClick={() => setCommand({ kind: 'apply_hold' })}><LockKeyhole size={16} /> Apply legal hold</button> : null}
    </div>
    <div className="closure-summary-grid">
      <article className="surface closure-card"><header><Scale size={19} /><span>Readiness</span></header><strong>{blockers.length ? `${blockers.length} open control${blockers.length === 1 ? '' : 's'}` : 'Ready for review'}</strong><small>Calculated {new Date(workspace.currentReadiness.calculatedAt).toLocaleString('en-GB')}</small></article>
      <article className="surface closure-card"><header><FileCheck2 size={19} /><span>Final report</span></header><strong>{workspace.review ? label(workspace.review.finalClientReportStatus) : 'Not prepared'}</strong><small>{workspace.review ? label(workspace.review.documentsPosition) : 'Document return not reviewed'}</small></article>
      <article className="surface closure-card"><header><CalendarClock size={19} /><span>Retention</span></header><strong>{workspace.review ? date(workspace.review.retentionUntil) : 'Not scheduled'}</strong><small>{workspace.destructionSuspended ? 'Destruction eligibility suspended by legal hold' : 'No automatic deletion'}</small></article>
    </div>
    {blockers.length ? <section className="surface closure-section"><header><div><span className="eyebrow">Objective controls</span><h3>Readiness blockers</h3></div><AlertTriangle size={20} /></header>
      <div className="closure-list">{blockers.map((item) => <article key={item.key}><span className={`closure-severity closure-severity--${item.severity}`}>{item.severity === 'critical' ? 'Critical blocker' : 'Residual control'}</span><div><strong>{item.label}</strong><small>{label(item.category)} · {item.transferable ? 'May become a controlled post-closure obligation' : 'Must be resolved before closure'}</small></div></article>)}</div></section> : null}
    {workspace.review ? <section className="surface closure-section"><header><div><span className="eyebrow">Exact review #{workspace.review.sequence}</span><h3>Final reporting record</h3></div><FileCheck2 size={20} /></header>
      <dl className="closure-details"><div><dt>Outcome</dt><dd>{workspace.review.outcome}</dd></div><div><dt>Closure reason</dt><dd>{workspace.review.closureReason}</dd></div><div><dt>Lessons</dt><dd>{workspace.review.lessons}</dd></div>
        <div><dt>Documents</dt><dd>{label(workspace.review.documentsPosition)} · {workspace.review.documentsNote}</dd></div><div><dt>Retention basis</dt><dd>{workspace.review.retentionBasis}</dd></div></dl>
      <a className="finance-source" href={`/api/matters/${matterId}/document-versions/${workspace.review.finalClientReportDocumentVersionId}/download`}>Download exact final client report</a></section> : null}
    {workspace.obligations.length ? <section className="surface closure-section"><header><div><span className="eyebrow">Controlled after closure</span><h3>Post-closure obligations</h3></div></header><div className="closure-list">{workspace.obligations.map((item) => <article key={item.id}><span className="closure-severity closure-severity--residual">{label(item.status)}</span><div><strong>{item.title}</strong><small>Due {date(item.dueOn)} · owner {item.ownerUserId.slice(0, 8)} · {item.reason}</small></div></article>)}</div></section> : null}
    <section className="surface closure-section"><header><div><span className="eyebrow">Preservation control</span><h3>Legal holds</h3></div><LockKeyhole size={20} /></header>
      {workspace.holds.length ? <div className="closure-list">{workspace.holds.map((hold) => <article key={hold.id}><span className={`closure-severity closure-severity--${hold.status === 'applied' ? 'critical' : 'residual'}`}>{label(hold.status)}</span><div><strong>{hold.reason}</strong><small>Recorded {new Date(hold.createdAt).toLocaleString('en-GB')}</small></div>
        {hold.status === 'applied' && workspace.permissions.canManageHold ? <button className="button button--ghost button--small" type="button" onClick={() => setCommand({ kind: 'release_hold', holdId: hold.id })}>Release hold</button> : null}</article>)}</div>
        : <p>No legal hold is recorded. Retention still never triggers automatic deletion.</p>}
      {activeHolds.length ? <p className="closure-hold-note">Destruction eligibility is suspended until every active hold is formally released.</p> : null}</section>
    <section className="surface closure-section"><header><div><span className="eyebrow">Append-only lifecycle</span><h3>Closure & reopening history</h3></div><History size={20} /></header>
      <div className="closure-history">{workspace.events.map((event) => <article key={event.id}><span>{event.sequence}</span><div><strong>{label(event.eventType)}</strong><p>{event.reason}</p><small>{new Date(event.recordedAt).toLocaleString('en-GB')}</small></div></article>)}</div></section>
    {command ? <Suspense fallback={null}><ClosureDialogs matterId={matterId} workspace={workspace} command={command} team={team} documents={documents}
      onClose={() => setCommand(null)} onCompleted={() => load()} /></Suspense> : null}
  </section>;
}
