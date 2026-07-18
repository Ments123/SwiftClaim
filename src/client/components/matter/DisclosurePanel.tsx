import { Eye, FileCheck2, FileSearch, ListChecks, LockKeyhole, Sparkles } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';

import { request, type DisclosureCandidateRecord, type DisclosureWorkspace, type RestrictedDisclosureCandidate } from '../../api.js';

const DisclosureDialogs = lazy(() => import('./DisclosureDialogs.js').then((module) => ({ default: module.DisclosureDialogs })));
type View = 'queue' | 'privilege' | 'lists' | 'inspection';
const label = (value: string) => value.replaceAll('_', ' ').replace(/^./, (value) => value.toUpperCase());
const isRestricted = (candidate: DisclosureWorkspace['reviews'][number]['candidates'][number]): candidate is RestrictedDisclosureCandidate =>
  'restricted' in candidate && candidate.restricted === true && !('documentVersionId' in candidate);

export function DisclosurePanel({ matterId, proceedingId, initialWorkspace }: {
  matterId: string; proceedingId: string; initialWorkspace?: DisclosureWorkspace;
}) {
  const [workspace, setWorkspace] = useState(initialWorkspace); const [view, setView] = useState<View>('queue');
  const [loading, setLoading] = useState(!initialWorkspace); const [error, setError] = useState('');
  const [command, setCommand] = useState<string | null>(null);
  const refresh = async () => setWorkspace(await request<DisclosureWorkspace>(
    `/api/matters/${matterId}/proceedings/${proceedingId}/disclosure`));
  useEffect(() => {
    if (initialWorkspace) return; const controller = new AbortController();
    request<DisclosureWorkspace>(`/api/matters/${matterId}/proceedings/${proceedingId}/disclosure`, { signal: controller.signal })
      .then(setWorkspace).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Disclosure unavailable.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [initialWorkspace, matterId, proceedingId]);
  if (loading) return <section className="disclosure-state">Loading governed disclosure records…</section>;
  if (error) return <section className="disclosure-state is-error">{error}</section>;
  if (!workspace) return null;
  const review = workspace.reviews[0];
  if (!review) return <section className="disclosure-state"><FileSearch size={26} /><h2>No disclosure review</h2><p>Open a review from an exact proceeding and disclosing party.</p>{workspace.permissions.canPrepare ? <button className="button button--primary" onClick={() => setCommand('open')} type="button">Open review</button> : null}</section>;
  return <section className="disclosure-workspace">
    <header className="section-header section-header--page"><div><span className="eyebrow">Human-controlled document review</span><h2>Disclosure & inspection</h2><p>{review.scopeNote}</p></div>
      <div className="disclosure-actions">{workspace.permissions.canPrepare ? <button className="button button--secondary" type="button" onClick={() => setCommand('candidate')}>Add candidate</button> : null}{workspace.permissions.canGenerateList ? <button className="button button--primary" type="button" onClick={() => setCommand('list')}>Generate snapshot</button> : null}</div></header>
    <nav className="disclosure-tabs" aria-label="Disclosure views">
      {([['queue','Review queue'],['privilege','Privilege review'],['lists','Disclosure lists'],['inspection','Inspection']] as const).map(([id, text]) =>
        <button className={view === id ? 'is-active' : ''} type="button" key={id} onClick={() => setView(id)}>{text}</button>)}
    </nav>
    {view === 'queue' ? <div className="disclosure-candidate-grid">{review.candidates.map((candidate) => {
      if (isRestricted(candidate)) return <article className="disclosure-candidate is-restricted" key={candidate.id}><LockKeyhole size={20} /><h3>Restricted document</h3><p>Metadata is limited pending authorised privilege review.</p><span>{label(candidate.state)}</span></article>;
      const full = candidate as DisclosureCandidateRecord; const source = workspace.sources.documents.find(({ id }) => id === full.documentVersionId);
      const suggestion = full.suggestions.at(-1); const decision = full.decisions.at(-1);
      return <article className="disclosure-candidate" key={full.id}><header><FileCheck2 size={18} /><div><h3>{source?.title ?? 'Exact retained version'}</h3><small>Version {source?.version ?? 'retained'} · {full.custodian || 'Custodian unrecorded'}</small></div></header>
        {suggestion ? <div className="ai-suggestion"><Sparkles size={15} /><strong>AI suggestion — human review required</strong><span>{label(suggestion.relevance)} · {suggestion.model}</span></div> : null}
        <p>{decision ? `Human decision: ${label(decision.decision)}` : 'Human decision: Not recorded'}</p>
        <footer><span>{full.projection.canList ? 'Approved for list snapshot' : 'Not currently listable'}</span>{workspace.permissions.canReview ? <button type="button" onClick={() => setCommand(`decision:${full.id}`)}>Record decision</button> : null}</footer></article>;
    })}</div> : null}
    {view === 'privilege' ? <div className="disclosure-candidate-grid">{review.candidates.map((candidate) => <article className="disclosure-candidate" key={candidate.id}><LockKeyhole size={18} /><h3>{isRestricted(candidate) ? 'Restricted document' : workspace.sources.documents.find(({ id }) => id === (candidate as DisclosureCandidateRecord).documentVersionId)?.title ?? 'Document'}</h3><p>{isRestricted(candidate) ? 'Authorised review required.' : label((candidate as DisclosureCandidateRecord).privilegeReviews.at(-1)?.outcome ?? 'not reviewed')}</p>{workspace.permissions.canReviewPrivilege && !isRestricted(candidate) ? <button type="button" onClick={() => setCommand(`privilege:${candidate.id}`)}>Review privilege</button> : null}{workspace.permissions.canWaivePrivilege ? <button type="button">Record privilege waiver</button> : null}</article>)}</div> : null}
    {view === 'lists' ? <div className="disclosure-list-stack">{review.lists.map((list) => <article key={list.id}><ListChecks size={20} /><div><h3>{list.title} · snapshot {list.snapshotNumber}</h3><p>{list.entries.length} entries · {list.blockers.length} blockers</p></div></article>)}</div> : null}
    {view === 'inspection' ? <div className="disclosure-list-stack">{review.inspectionRequests.map((item) => <article key={item.id}><Eye size={20} /><div><h3>Inspection request</h3><p>{item.projection.completed ? 'Completed' : item.projection.provided ? 'Provided — completion not recorded' : 'Outstanding'}</p></div></article>)}</div> : null}
    {command ? <Suspense fallback={null}><DisclosureDialogs command={command} matterId={matterId} proceedingId={proceedingId} review={review} workspace={workspace} onClose={() => setCommand(null)} onSaved={refresh} /></Suspense> : null}
  </section>;
}
