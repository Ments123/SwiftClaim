import {
  AlertTriangle,
  Banknote,
  BookOpenCheck,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileCheck2,
  Landmark,
  Play,
  Plus,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Square,
  TrendingUp,
} from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';

import {
  request,
  type FinanceActivitySuggestion,
  type FinanceDisbursement,
  type FinanceDocumentSource,
  type FinanceJournal,
  type FinanceRateCard,
  type FinanceTimeEntry,
  type FinanceTimer,
  type FinanceWorkspace,
} from '../../api.js';

const FinanceDialogs = lazy(() => import('./FinanceDialogs.js').then((module) => ({
  default: module.FinanceDialogs,
})));

type View = 'snapshot' | 'time' | 'rates' | 'disbursements' | 'ledger';

export type FinanceCommand =
  | { kind: 'manual_time' }
  | { kind: 'start_timer' }
  | { kind: 'stop_timer'; timer: FinanceTimer }
  | { kind: 'submit_timer'; timer: FinanceTimer }
  | { kind: 'suggestion'; suggestion: FinanceActivitySuggestion; decision: 'accept' | 'reject' }
  | { kind: 'submit_suggestion'; suggestion: FinanceActivitySuggestion }
  | { kind: 'approve_time'; timeEntry: FinanceTimeEntry }
  | { kind: 'estimate' }
  | { kind: 'disbursement' }
  | { kind: 'disbursement_event'; disbursement: FinanceDisbursement; eventType: 'approved' | 'incurred' | 'paid_external' | 'cancelled' | 'corrected' }
  | { kind: 'journal_approve'; journal: FinanceJournal }
  | { kind: 'journal_post'; journal: FinanceJournal }
  | { kind: 'rate_card' }
  | { kind: 'rate_version'; rateCard: FinanceRateCard }
  | { kind: 'rate_activate'; rateCard: FinanceRateCard; rateVersion: FinanceRateCard['versions'][number] };

interface FinancePanelProps {
  matterId: string;
  initialWorkspace?: FinanceWorkspace;
  initialRateCards?: FinanceRateCard[];
  availableDocumentSources?: FinanceDocumentSource[];
}

const money = (amountMinor: number) => new Intl.NumberFormat('en-GB', {
  style: 'currency', currency: 'GBP', minimumFractionDigits: 2,
}).format(amountMinor / 100);

const date = (value: string | null) => value
  ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
  : 'Not recorded';

const label = (value: string) => value.replaceAll('_', ' ').replace(/^./, (first) => first.toUpperCase());
const activitySourceKey = (userId: string, sourceKind: string, sourceId: string) =>
  `${userId}\u0000${sourceKind}\u0000${sourceId}`;

function ExactSource({ matterId, versionId, sources }: {
  matterId: string; versionId: string | null; sources: FinanceDocumentSource[];
}) {
  if (!versionId) return <span className="finance-source is-missing">No exact document linked</span>;
  const source = sources.find(({ id }) => id === versionId);
  if (!source) return <span className="finance-source">Exact source · {versionId.slice(0, 8)}</span>;
  return (
    <a
      className="finance-source"
      href={`/api/matters/${matterId}/document-versions/${source.id}/download`}
      title={`${source.title} · version ${source.version} · ${source.originalName}`}
    >
      <FileCheck2 size={13} /> Open exact source <ExternalLink size={12} />
    </a>
  );
}

function NotConnected({ name }: { name: string }) {
  return <span className="finance-not-connected">{name} · Not yet connected</span>;
}

function EmptyFinance({ title, text }: { title: string; text: string }) {
  return <div className="finance-empty"><Banknote size={24} /><strong>{title}</strong><p>{text}</p></div>;
}

export function FinancePanel({
  matterId,
  initialWorkspace,
  initialRateCards = [],
  availableDocumentSources = [],
}: FinancePanelProps) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [rateCards, setRateCards] = useState(initialRateCards);
  const [view, setView] = useState<View>('snapshot');
  const [loading, setLoading] = useState(!initialWorkspace);
  const [error, setError] = useState('');
  const [command, setCommand] = useState<FinanceCommand | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setError('');
    try {
      const next = await request<FinanceWorkspace>(`/api/matters/${matterId}/finance`, { signal });
      setWorkspace(next);
      if (next.permissions.canManageRates) {
        const response = await request<{ rateCards: FinanceRateCard[] }>('/api/finance/rate-cards', { signal });
        setRateCards(response.rateCards);
      } else {
        setRateCards([]);
      }
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setError(reason instanceof Error ? reason.message : 'The finance workspace is unavailable.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [matterId]);

  useEffect(() => {
    if (initialWorkspace) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [initialWorkspace, load]);

  if (loading && !workspace) {
    return <section className="surface tab-surface finance-state" aria-busy="true"><div className="skeleton skeleton--heading" /><div className="skeleton skeleton--matter" /></section>;
  }
  if (!workspace) {
    return <section className="surface tab-surface page-state"><Banknote size={30} /><h2>Time & finance unavailable</h2><p>{error}</p><button className="button button--secondary" type="button" onClick={() => void load()}><RefreshCw size={15} /> Retry</button></section>;
  }

  const runningTimer = workspace.timers.find(({ status, userId }) =>
    status === 'running' && userId === workspace.actingUserId);
  const pendingSuggestions = workspace.suggestions.filter(({ status }) => status === 'pending');
  const submittedSources = new Set(workspace.timeEntries.flatMap((entry) => entry.sourceId ? [
    activitySourceKey(entry.userId, entry.sourceKind, entry.sourceId),
  ] : []));
  const recoverableSuggestions = workspace.suggestions.filter((suggestion) =>
    suggestion.status === 'accept'
    && !submittedSources.has(activitySourceKey(suggestion.userId, suggestion.sourceKind, suggestion.sourceId)));
  const suggestionInbox = [...pendingSuggestions, ...recoverableSuggestions];
  const submittedTimerIds = new Set(workspace.timeEntries.flatMap((entry) =>
    entry.sourceKind === 'timer' && entry.sourceId ? [entry.sourceId] : []));
  const stoppedTimers = workspace.timers.filter((timer) => timer.status === 'stopped'
    && timer.elapsedMinutes !== null
    && !submittedTimerIds.has(timer.id));
  const submittedTime = workspace.timeEntries.filter(({ status }) => status === 'submitted');
  const openWarnings = workspace.warnings.filter(({ state }) => state === 'open');
  const documentSources = [...new Map([
    ...workspace.sources.documents,
    ...availableDocumentSources,
  ].map((source) => [source.id, source])).values()].sort((left, right) =>
    left.title.localeCompare(right.title) || right.version - left.version);

  return (
    <section className="finance-workspace">
      <header className="finance-header">
        <div><span className="eyebrow">Governed matter finance</span><h2>Time & finance</h2>
          <p>Provisional activity, approved WIP, estimates and non-cash controls remain visibly separate.</p></div>
        <span className="governance-state"><ShieldCheck size={14} /> Human approval required</span>
      </header>

      {error ? <div className="inline-notice inline-notice--error" role="alert">{error}</div> : null}

      <nav className="workspace-tabs finance-tabs" aria-label="Finance views">
        {([
          ['snapshot', 'Snapshot'],
          ['time', 'Time'],
          ['rates', 'Rates & estimates'],
          ['disbursements', 'Disbursements'],
          ['ledger', 'Ledger'],
        ] as const).map(([id, text]) => (
          <button key={id} type="button" className={view === id ? 'is-active' : ''}
            aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}>{text}</button>
        ))}
      </nav>

      {view === 'snapshot' ? (
        <div className="finance-view finance-snapshot">
          <div className="finance-kpis">
            <article><span><TrendingUp size={18} /> Approved WIP</span><strong>{money(workspace.snapshot.approvedWip.amountMinor)}</strong><small>{workspace.snapshot.approvedWip.minutes} approved min</small></article>
            <article><span><Sparkles size={18} /> Provisional time</span><strong>{workspace.snapshot.provisionalTime.minutes} min</strong><small>{money(workspace.snapshot.provisionalTime.estimatedChargeMinor)} estimated · {workspace.snapshot.provisionalTime.unpricedCount} unpriced</small></article>
            <article><span><ReceiptText size={18} /> Approved disbursements</span><strong>{money(workspace.snapshot.disbursements.approvedExposureMinor)}</strong><small>{money(workspace.snapshot.disbursements.proposedMinor)} still proposed</small></article>
            <article><span><Landmark size={18} /> Current exposure</span><strong>{workspace.snapshot.estimate ? money(workspace.snapshot.estimate.currentExposureMinor) : 'No estimate'}</strong><small>{workspace.snapshot.estimate ? `${money(workspace.snapshot.estimate.varianceMinor)} remaining` : 'Add a reviewed estimate'}</small></article>
          </div>
          <div className="finance-snapshot-grid">
            <section className="finance-card">
              <header><div><span className="eyebrow">Client cost control</span><h3>Estimate position</h3></div>{openWarnings.length ? <AlertTriangle size={20} /> : <CheckCircle2 size={20} />}</header>
              {workspace.snapshot.estimate ? <>
                <div className="finance-meter"><span style={{ width: `${Math.min(100, Math.max(0, Math.round(workspace.snapshot.estimate.currentExposureMinor * 100 / workspace.snapshot.estimate.overallLimitMinor)))}%` }} /></div>
                <p><strong>{money(workspace.snapshot.estimate.currentExposureMinor)}</strong> of {money(workspace.snapshot.estimate.overallLimitMinor)}</p>
                <small>{openWarnings.length ? `${openWarnings.length} open cost warning${openWarnings.length === 1 ? '' : 's'}` : 'No threshold warning is open'}</small>
              </> : <EmptyFinance title="No current estimate" text="Record a reviewed cost limit before relying on variance." />}
            </section>
            <section className="finance-card">
              <header><div><span className="eyebrow">Later cashroom facts</span><h3>Balances</h3></div><BookOpenCheck size={20} /></header>
              <div className="finance-unavailable-list">
                <NotConnected name="Client balance" />
                <NotConnected name="Office balance" />
                <NotConnected name="Billed" />
                <NotConnected name="Paid" />
                <NotConnected name="Recovered" />
              </div>
              <p className="finance-footnote">No bank or client-money balance is inferred from WIP, a bill, or an external payment note.</p>
            </section>
          </div>
        </div>
      ) : null}

      {view === 'time' ? (
        <div className="finance-view">
          <header className="finance-view-header"><div><span className="eyebrow">Fast daily review</span><h3>Time capture</h3></div>
            {workspace.permissions.canRecordTime ? <div className="button-row">
              <button className="button button--secondary button--small" type="button" onClick={() => setCommand({ kind: 'manual_time' })}><Plus size={15} /> Manual time</button>
              {runningTimer ? <button className="button button--primary button--small" type="button" onClick={() => setCommand({ kind: 'stop_timer', timer: runningTimer })}><Square size={14} /> Stop timer</button>
                : <button className="button button--primary button--small" type="button" onClick={() => setCommand({ kind: 'start_timer' })}><Play size={14} /> Start timer</button>}
            </div> : null}</header>
          {runningTimer ? <div className="finance-running"><span className="finance-pulse" /><div><strong>Timer running</strong><p>{runningTimer.narrative ?? 'Narrative restricted'} · started {date(runningTimer.startedAt)}</p></div></div> : null}
          {stoppedTimers.length ? <section className="finance-section">
            <header><div><h4>Stopped timers awaiting submission</h4><p>Elapsed minutes are server-recorded and remain provisional until the fee earner submits them.</p></div><span className="count-badge">{stoppedTimers.length}</span></header>
            <div className="finance-list">{stoppedTimers.map((timer) => <article className="finance-record" key={timer.id}>
              <div className="finance-record__icon"><Clock3 size={18} /></div>
              <div className="finance-record__body"><strong>{timer.narrative ?? 'Narrative required before submission'}</strong><p>{timer.elapsedMinutes} min · {label(timer.activityCode)} · {label(timer.costsPhase)}</p><small>Stopped {date(timer.stoppedAt)} · retained outside WIP</small></div>
              {workspace.permissions.canRecordTime && timer.userId === workspace.actingUserId ? <button className="button button--primary button--small" type="button" aria-label={`Submit ${timer.elapsedMinutes} min timer`} onClick={() => setCommand({ kind: 'submit_timer', timer })}>Submit timer</button> : null}
            </article>)}</div>
          </section> : null}
          <section className="finance-section">
            <header><div><h4>Suggestion inbox</h4><p>Every item stays outside WIP until a human reviews and submits it.</p></div><span className="count-badge">{suggestionInbox.length}</span></header>
            {suggestionInbox.length ? <div className="finance-list">{suggestionInbox.map((suggestion) => {
              const reviewed = suggestion.status === 'accept';
              return (
              <article className={`finance-record finance-suggestion is-${reviewed ? 'reviewed' : suggestion.confidence}`} key={suggestion.id}>
                <div className="finance-record__icon">{reviewed ? <CheckCircle2 size={18} /> : <Sparkles size={18} />}</div>
                <div className="finance-record__body"><strong>{reviewed ? 'Human reviewed — submission still required' : suggestion.label}</strong><p>{suggestion.proposedNarrative}</p>
                  <small>{suggestion.minutes} min · {label(suggestion.proposedActivityCode)} · {label(suggestion.proposedCostsPhase)} · {suggestion.confidence} confidence</small>
                  <span className="finance-provenance">{reviewed ? 'Decision saved · retained outside WIP' : `Source ${label(suggestion.sourceKind)} · ${suggestion.sourceId.slice(0, 8)} · ${suggestion.model}`}</span></div>
                {workspace.permissions.canRecordTime && suggestion.userId === workspace.actingUserId ? <div className="finance-record__actions">
                  {reviewed ? <button type="button" className="button button--primary button--small" onClick={() => setCommand({ kind: 'submit_suggestion', suggestion })}>Submit reviewed time</button> : <>
                    <button type="button" className="button button--secondary button--small" aria-label="Reject suggestion" onClick={() => setCommand({ kind: 'suggestion', suggestion, decision: 'reject' })}>Reject</button>
                    <button type="button" className="button button--primary button--small" aria-label="Accept suggestion" onClick={() => setCommand({ kind: 'suggestion', suggestion, decision: 'accept' })}>Accept</button>
                  </>}
                </div> : null}
              </article>
            );})}</div> : <EmptyFinance title="Suggestion inbox clear" text="Supported work will appear here as provisional source-backed activity." />}
          </section>
          <section className="finance-section">
            <header><div><h4>Submitted & approved time</h4><p>Approved entries retain their exact rate and calculation snapshot.</p></div><span className="count-badge">{workspace.timeEntries.length}</span></header>
            {workspace.timeEntries.length ? <div className="finance-list">{workspace.timeEntries.map((entry) => (
              <article className="finance-record" key={entry.id}><div className="finance-record__icon"><Clock3 size={18} /></div>
                <div className="finance-record__body"><strong>{entry.narrative ?? 'Narrative restricted'}</strong><p>{entry.minutes} min · {label(entry.activityCode)} · {date(entry.workDate)}</p><small>{label(entry.status)}{entry.chargeMinor !== null ? ` · ${money(entry.chargeMinor)}` : ''}{entry.hourlyRateMinor !== null ? ` at ${money(entry.hourlyRateMinor)}/hour` : ''}</small></div>
                {workspace.permissions.canApproveTime && entry.status === 'submitted' && entry.userId !== workspace.actingUserId ? <button className="button button--primary button--small" type="button" onClick={() => setCommand({ kind: 'approve_time', timeEntry: entry })}>Approve time</button> : null}
              </article>
            ))}</div> : <EmptyFinance title="No submitted time" text="Manual or reviewed activity time will appear here." />}
          </section>
          {submittedTime.length && !workspace.permissions.canApproveTime ? <p className="finance-footnote">{submittedTime.length} submitted entr{submittedTime.length === 1 ? 'y is' : 'ies are'} awaiting an authorised supervisor.</p> : null}
        </div>
      ) : null}

      {view === 'rates' ? (
        <div className="finance-view">
          <header className="finance-view-header"><div><span className="eyebrow">Effective-dated controls</span><h3>Rates & estimates</h3></div><div className="button-row">
            {workspace.permissions.canManageRates ? <button className="button button--secondary button--small" type="button" onClick={() => setCommand({ kind: 'rate_card' })}><Plus size={15} /> Rate card</button> : null}
            {workspace.permissions.canManageEstimates ? <button className="button button--primary button--small" type="button" onClick={() => setCommand({ kind: 'estimate' })}><Plus size={15} /> New estimate</button> : null}
          </div></header>
          <div className="finance-two-column">
            <section className="finance-section"><header><div><h4>Rate cards</h4><p>Activation freezes each version; approved time keeps its historical snapshot.</p></div></header>
              {rateCards.length ? <div className="finance-card-stack">{rateCards.map((card) => {
                const active = [...card.versions].reverse().find(({ status }) => status === 'active');
                const drafts = card.versions.filter(({ status }) => status === 'draft');
                return <article className="finance-card" key={card.id}><header><div><h4>{card.name}</h4><small>Card version {card.version}</small></div><div className="finance-card-actions"><span className={`finance-status is-${active ? 'active' : 'draft'}`}>{active ? 'Active' : 'Draft'}</span>{workspace.permissions.canManageRates ? <button className="button button--secondary button--small" type="button" aria-label="Add rate version" onClick={() => setCommand({ kind: 'rate_version', rateCard: card })}><Plus size={14} /> Version</button> : null}</div></header>
                  {active ? <><p>Effective {date(active.effectiveFrom)}{active.effectiveTo ? ` to ${date(active.effectiveTo)}` : ' onward'}</p><div className="finance-rate-grid">{active.entries.map((entry) => <div key={entry.id}><span>{label(entry.grade)}</span><strong>{money(entry.hourlyRateMinor)}/hour</strong><small>{entry.activityCode ? label(entry.activityCode) : 'All activities'}</small></div>)}</div></> : <p>No active version. An independent approver must activate a prepared rate.</p>}
                  {drafts.length ? <div className="finance-rate-drafts">{drafts.map((draft) => <article key={draft.id}><div><strong>Draft v{draft.versionNumber} · effective {date(draft.effectiveFrom)}</strong><small>{draft.entries.length} rate entr{draft.entries.length === 1 ? 'y' : 'ies'} · prepared by {draft.preparedBy.slice(0, 8)}</small></div>{workspace.permissions.canManageRates && draft.preparedBy !== workspace.actingUserId ? <button className="button button--primary button--small" type="button" aria-label={`Activate rate version ${draft.versionNumber}`} onClick={() => setCommand({ kind: 'rate_activate', rateCard: card, rateVersion: draft })}>Activate</button> : <span className="finance-independence">Independent activation required</span>}</article>)}</div> : null}
                </article>;
              })}</div> : <EmptyFinance title="No rate cards available" text="Authorised firm-finance users can create the first effective-dated card." />}
            </section>
            <section className="finance-section"><header><div><h4>Estimate history</h4><p>New versions supersede; they never rewrite the prior client cost limit.</p></div></header>
              {workspace.estimates.length ? <div className="finance-card-stack">{[...workspace.estimates].reverse().map((estimate, index) => <article className="finance-card" key={estimate.id}><header><div><h4>Estimate v{estimate.versionNumber}</h4><small>Effective {date(estimate.effectiveOn)}</small></div>{index === 0 ? <span className="finance-status is-active">Current</span> : null}</header><strong className="finance-card__amount">{money(estimate.overallLimitMinor)}</strong><p>{estimate.scope ?? 'Scope restricted to authorised matter users.'}</p><ExactSource matterId={matterId} versionId={estimate.sourceDocumentVersionId} sources={workspace.sources.documents} /></article>)}</div> : <EmptyFinance title="No estimate history" text="Record a source-backed, human-approved estimate." />}
            </section>
          </div>
          {openWarnings.length ? <section className="finance-warning-list" aria-label="Open cost warnings">{openWarnings.map((warning) => <article key={warning.id}><AlertTriangle size={19} /><div><strong>{warning.thresholdPercent}% cost warning</strong><p>{money(warning.exposureMinor)} approved exposure at {date(warning.crossedAt)}. Human review and client notification evidence remain separate.</p></div></article>)}</section> : null}
        </div>
      ) : null}

      {view === 'disbursements' ? (
        <div className="finance-view">
          <header className="finance-view-header"><div><span className="eyebrow">Liability is not payment</span><h3>Disbursements</h3></div>{workspace.permissions.canManageDisbursements ? <button className="button button--primary button--small" type="button" onClick={() => setCommand({ kind: 'disbursement' })}><Plus size={15} /> Add disbursement</button> : null}</header>
          {workspace.disbursements.length ? <div className="finance-card-stack">{workspace.disbursements.map((item) => (
            <article className="finance-card finance-disbursement" key={item.id}><header><div><span className="eyebrow">{label(item.category)}</span><h4>{item.supplier}</h4><small>{item.invoiceReference || 'No supplier reference'}</small></div><div><strong className="finance-card__amount">{money(item.grossMinor)}</strong><span className={`finance-status is-${item.status}`}>{label(item.status)}</span></div></header><p>{item.description}</p>
              <div className="finance-fact-row"><span>Approved · {item.approved ? 'Yes' : 'No'}</span><span>Incurred · {item.incurred ? 'Yes' : 'No'}</span><span>Paid externally · {item.paidExternally ? 'Yes' : 'No'}</span><span>Billed · Not connected</span><span>Recovered · Not connected</span></div>
              <footer><ExactSource matterId={matterId} versionId={item.sourceDocumentVersionId} sources={workspace.sources.documents} />{workspace.permissions.canManageDisbursements ? <div className="button-row">{item.status === 'proposed' ? <button className="button button--secondary button--small" type="button" onClick={() => setCommand({ kind: 'disbursement_event', disbursement: item, eventType: 'approved' })}>Approve</button> : null}{item.status === 'approved' ? <button className="button button--secondary button--small" type="button" onClick={() => setCommand({ kind: 'disbursement_event', disbursement: item, eventType: 'incurred' })}>Record incurred</button> : null}{item.status === 'incurred' ? <button className="button button--secondary button--small" type="button" onClick={() => setCommand({ kind: 'disbursement_event', disbursement: item, eventType: 'paid_external' })}>Record external payment</button> : null}</div> : null}</footer>
              {item.duplicateFindings.length ? <div className="finance-duplicate"><AlertTriangle size={15} /> Potential duplicate — human decision required</div> : null}
            </article>
          ))}</div> : <EmptyFinance title="No disbursements" text="Proposals, incurred liabilities and external payment evidence remain distinct here." />}
        </div>
      ) : null}

      {view === 'ledger' ? (
        <div className="finance-view">
          <header className="finance-view-header"><div><span className="eyebrow">Double-entry foundation</span><h3>Non-cash journal</h3><p>Only posted, exactly balanced neutral-account journals affect this foundation view.</p></div></header>
          {workspace.ledger.journals.length ? <div className="finance-card-stack">{workspace.ledger.journals.map((journal) => (
            <article className="finance-card finance-journal" key={journal.id}><header><div><span className="eyebrow">{label(journal.sourceKind)} · {date(journal.accountingDate)}</span><h4>{journal.description}</h4></div><span className={`finance-status is-${journal.status}`}>{label(journal.status)}</span></header>
              <div className="finance-journal-total"><span>Debits <strong>{money(journal.totalDebitMinor)}</strong></span><span>Credits <strong>{money(journal.totalCreditMinor)}</strong></span><span>Balanced <strong>{journal.totalDebitMinor === journal.totalCreditMinor ? 'Yes' : 'No'}</strong></span></div>
              <div className="finance-journal-lines">{journal.lines.map((line) => <div key={line.id}><span>{line.accountCode} · {line.accountName}</span><small>{label(line.designation)} · {line.memo}</small><strong>{line.debitMinor ? `Dr ${money(line.debitMinor)}` : `Cr ${money(line.creditMinor)}`}</strong></div>)}</div>
              {(workspace.permissions.canApproveJournal || workspace.permissions.canPostJournal) ? <footer><span>Prepared {date(journal.preparedAt)} · version {journal.version}</span><div className="button-row">{workspace.permissions.canApproveJournal && journal.status === 'draft' && journal.preparedBy !== workspace.actingUserId ? <button className="button button--secondary button--small" type="button" onClick={() => setCommand({ kind: 'journal_approve', journal })}>Approve journal</button> : null}{workspace.permissions.canPostJournal && journal.status === 'approved' && journal.preparedBy !== workspace.actingUserId ? <button className="button button--primary button--small" type="button" onClick={() => setCommand({ kind: 'journal_post', journal })}>Post journal</button> : null}</div></footer> : null}
            </article>
          ))}</div> : <EmptyFinance title="No journal facts" text="A balanced source-backed control journal will appear after independent approval and posting." />}
        </div>
      ) : null}

      {command ? <Suspense fallback={null}><FinanceDialogs command={command} matterId={matterId}
        documentSources={documentSources} onClose={() => setCommand(null)} onSaved={async () => { setCommand(null); await load(); }} /></Suspense> : null}
    </section>
  );
}
