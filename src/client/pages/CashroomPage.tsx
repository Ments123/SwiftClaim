import { AlertTriangle, Banknote, Download, Landmark, ReceiptText, RefreshCw, Scale, ShieldCheck } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';

import { jsonBody, request, type CashroomWorkspace } from '../api.js';

const CashroomReconciliationDialog = lazy(() => import('../components/cashroom/CashroomDialogs.js')
  .then((module) => ({ default: module.CashroomReconciliationDialog })));

type View = 'Bills' | 'Receipts' | 'Payments' | 'Bank' | 'Reconciliation' | 'Exceptions';
const views: View[] = ['Bills', 'Receipts', 'Payments', 'Bank', 'Reconciliation', 'Exceptions'];
const money = (minor: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(minor / 100);
const label = (value: string) => {
  const words = value.replaceAll('_', ' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
};

export function CashroomPage({ initialWorkspace }: { initialWorkspace?: CashroomWorkspace }) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [view, setView] = useState<View>('Bills');
  const [billFilter, setBillFilter] = useState('all');
  const [expandedBill, setExpandedBill] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<{ id: string; action: 'complete' | 'signoff' } | null>(null);
  const load = useCallback(async () => {
    try { setError(''); setWorkspace((await request<{ workspace: CashroomWorkspace }>('/api/finance/cashroom/workspace')).workspace); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Cashroom unavailable.'); }
  }, []);
  useEffect(() => { if (!initialWorkspace) void load(); }, [initialWorkspace, load]);
  const bills = workspace?.bills.filter((bill) => billFilter === 'all' || bill.ageBucket === billFilter) ?? [];
  const decideMatch = async (statement: CashroomWorkspace['statements'][number], line: CashroomWorkspace['statements'][number]['lines'][number], decision: 'confirm' | 'reject') => {
    if (!statement.reconciliationId || statement.reconciliationVersion === null) return;
    try {
      setError('');
      await request(`/api/finance/cashroom/reconciliations/${statement.reconciliationId}/matches`, {
        method: 'POST', body: jsonBody({ expectedVersion: statement.reconciliationVersion,
          idempotencyKey: `cashroom-match-${statement.reconciliationId}-${line.id}-${decision}`,
          statementLineId: line.id, decision,
          matches: decision === 'confirm' && line.suggestion ? [{ journalId: line.suggestion.journalId, amountMinor: line.amountMinor }] : [],
          explanation: decision === 'confirm' ? 'Human confirmed the provisional exact-amount candidate.' : 'Human rejected the provisional candidate.',
          explicitHumanConfirmation: true }),
      });
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The match decision could not be retained.'); }
  };
  if (!workspace) return <main className="page page-state"><Landmark size={34} /><h1>Cashroom</h1>{error ? <><p>{error}</p><button type="button" className="button button--primary" onClick={() => void load()}>Try again</button></> : <p>Loading governed financial records…</p>}</main>;
  const selectedReconciliation = workspace.reconciliations.find((item) => item.id === dialog?.id) ?? null;
  return (
    <main className="page cashroom-page">
      <header className="cashroom-header">
        <div><span className="eyebrow">Firm finance</span><h1>Billing & Cashroom</h1><p>Bills, client money, office money and reconciliation in one governed workspace.</p></div>
        <div className="cashroom-export-menu" aria-label="Audited exports">
          {workspace.permissions.canExport ? workspace.exports.map((item) => <a className="button button--secondary" href={item.href} key={item.kind} download><Download size={15} /> Export {item.kind} CSV</a>) : null}
        </div>
      </header>
      {error ? <div className="inline-notice inline-notice--error" role="alert">{error}</div> : null}
      <section className="cashroom-summary" aria-label="Cashroom summary">
        <article><ReceiptText /><span>Issued bills</span><strong>{money(workspace.summary.issuedGrossMinor)}</strong></article>
        <article><Banknote /><span>Outstanding</span><strong>{money(workspace.summary.outstandingMinor)}</strong><small>{workspace.summary.overdueBills} overdue</small></article>
        <article><RefreshCw /><span>Unallocated</span><strong>{money(workspace.summary.unallocatedReceiptsMinor)}</strong></article>
        <article className={workspace.summary.blockerExceptions ? 'is-attention' : ''}><AlertTriangle /><span>Blockers</span><strong>{workspace.summary.blockerExceptions}</strong></article>
      </section>
      <nav className="cashroom-tabs" aria-label="Cashroom views">{views.map((item) => <button key={item} type="button" className={view === item ? 'is-active' : ''} onClick={() => setView(item)}>{item}</button>)}</nav>

      <section className="surface cashroom-surface">
        {view === 'Bills' ? <>
          <header className="section-header"><div><span className="eyebrow">Central register</span><h2>Aged debt</h2></div><label className="cashroom-filter">Filter bills<select aria-label="Filter bills" value={billFilter} onChange={(event) => setBillFilter(event.target.value)}><option value="all">All bills</option><option value="not_due">Not due</option><option value="1_30">1–30 days</option><option value="31_60">31–60 days</option><option value="61_90">61–90 days</option><option value="90_plus">90+ days</option><option value="paid">Paid</option></select></label></header>
          <div className="cashroom-table" role="table" aria-label="Bills register">{bills.map((bill) => <div className="cashroom-record" key={bill.id} role="row"><button type="button" className="cashroom-record__main" onClick={() => setExpandedBill(expandedBill === bill.id ? null : bill.id)}><span><strong>{bill.billReference}</strong><small>{label(bill.ageBucket)} · due {bill.dueOn}</small></span><span><strong>{money(bill.outstandingMinor)}</strong><small>outstanding</small></span></button>{expandedBill === bill.id ? <div className="cashroom-drilldown"><span><strong>{bill.matterReference}</strong><small>Source matter</small></span><span><strong>{money(bill.grossMinor)} gross</strong><small>{money(bill.paidMinor)} paid · {money(bill.creditedMinor)} credited</small></span><a href={`/matters/${bill.matterId}`}>Open source matter</a></div> : null}</div>)}</div>
        </> : null}
        {view === 'Receipts' ? <><header className="section-header"><div><span className="eyebrow">Incoming money</span><h2>Receipts queue</h2></div></header><div className="cashroom-list">{workspace.receipts.map((receipt) => <article key={receipt.id}><ReceiptText /><span><strong>{receipt.reference}</strong><small>{label(receipt.status)} · {money(receipt.unallocatedMinor)} unallocated</small></span><strong>{money(receipt.amountMinor)}</strong></article>)}</div></> : null}
        {view === 'Payments' ? <><header className="section-header"><div><span className="eyebrow">External evidence</span><h2>Client payments</h2></div></header><div className="cashroom-list">{workspace.payments.map((payment) => <article key={payment.id}><Banknote /><span><strong>{payment.purpose}</strong><small>{payment.matterReference} · {label(payment.status)}</small></span><strong>{money(payment.amountMinor)}</strong></article>)}</div><p className="cashroom-boundary"><ShieldCheck size={17} /> SwiftClaim records approvals and external completion evidence. It does not initiate bank payments.</p></> : null}
        {view === 'Bank' ? <><header className="section-header"><div><span className="eyebrow">Masked register</span><h2>Bank accounts</h2></div></header><div className="cashroom-bank-grid">{workspace.bankAccounts.map((account) => <article key={account.id}><Landmark /><span className="status-label">{label(account.designation)} account</span><h3>{account.name}</h3><strong>{account.accountIdentifierMasked}</strong><small>Latest statement {account.latestStatementTo ?? 'not imported'}</small></article>)}</div><div className="cashroom-statement-lines">{workspace.statements.flatMap((statement) => statement.lines.map((line) => <article key={line.id}><span><strong>{line.reference}</strong><small>{line.transactionDate} · {money(line.amountMinor)}</small></span><span>{line.decision ? <strong>{line.decision === 'human_confirmed' ? 'Human-confirmed match' : 'Human-rejected candidate'}</strong> : line.suggestion ? <><strong>Provisional {line.suggestion.confidence}-confidence match</strong><small>{line.suggestion.explanation}</small></> : <strong>No candidate</strong>}</span>{line.suggestion && statement.reconciliationStatus === 'prepared' && workspace.permissions.canPrepareReconciliation ? <div className="cashroom-actions"><button type="button" className="button button--secondary" onClick={() => void decideMatch(statement, line, 'reject')}>Reject match</button><button type="button" className="button button--primary" onClick={() => void decideMatch(statement, line, 'confirm')}>Confirm match</button></div> : null}</article>))}</div></> : null}
        {view === 'Reconciliation' ? <><header className="section-header"><div><span className="eyebrow">Independent control</span><h2>Reconciliations</h2></div></header><div className="cashroom-list">{workspace.reconciliations.map((item) => <article key={item.id}><Scale /><span><strong>{item.statementClosingOn}</strong><small>{item.status === 'completed' ? 'Completed · awaiting independent sign-off' : label(item.status)} · difference {money(item.differenceMinor)}</small></span><div className="cashroom-actions">{item.status === 'prepared' && workspace.permissions.canPrepareReconciliation ? <button className="button button--secondary" type="button" onClick={() => setDialog({ id: item.id, action: 'complete' })}>Complete reconciliation</button> : null}{item.status === 'completed' && workspace.permissions.canSignoffReconciliation && item.preparedBy !== workspace.actingUserId ? <button className="button button--primary" type="button" onClick={() => setDialog({ id: item.id, action: 'signoff' })}>Sign off reconciliation</button> : null}</div></article>)}</div></> : null}
        {view === 'Exceptions' ? <><header className="section-header"><div><span className="eyebrow">Control queue</span><h2>Financial exceptions</h2></div></header><div className="cashroom-list">{workspace.exceptions.map((item) => <article className={item.severity === 'blocker' ? 'is-blocker' : ''} key={item.id}><AlertTriangle /><span><strong>{label(item.severity)} · {label(item.kind)}</strong><small>{item.summary}</small></span>{item.amountMinor !== null ? <strong>{money(item.amountMinor)}</strong> : null}</article>)}</div></> : null}
      </section>
      <aside className="cashroom-export-evidence"><ShieldCheck size={18} /><span><strong>Audited exports</strong><small>Every export retains its exact columns, filters, row count and SHA-256 checksum.</small></span></aside>
      {dialog ? <Suspense fallback={null}><CashroomReconciliationDialog reconciliation={selectedReconciliation} action={dialog.action} onClose={() => setDialog(null)} onSaved={() => void load()} /></Suspense> : null}
    </main>
  );
}
