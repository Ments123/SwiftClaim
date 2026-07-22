import { AlertTriangle, ArrowRightLeft, FileText, History, Landmark, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';

import { request, type FinanceDocumentSource, type MatterBillingWorkspace, type MatterBill } from '../../api.js';
import type { BillingCommand } from './BillingDialogs.js';

const BillingDialogs = lazy(() => import('./BillingDialogs.js').then((module) => ({ default: module.BillingDialogs })));
type View = 'billing' | 'money' | 'history';
const money = (minor: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(minor / 100);
const label = (value: string) => value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());

export function BillingPanel({ matterId, initialWorkspace, availableDocumentSources = [] }: { matterId: string; initialWorkspace?: MatterBillingWorkspace; availableDocumentSources?: FinanceDocumentSource[] }) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [view, setView] = useState<View>('billing');
  const [expanded, setExpanded] = useState('');
  const [command, setCommand] = useState<BillingCommand | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!initialWorkspace);
  const load = useCallback(async (signal?: AbortSignal) => {
    setError('');
    try {
      const response = await request<{ workspace: MatterBillingWorkspace }>(`/api/finance/billing/matters/${matterId}/workspace`, { signal });
      setWorkspace(response.workspace);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(caught instanceof Error ? caught.message : 'Billing and money are unavailable.');
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [matterId]);
  useEffect(() => {
    if (initialWorkspace) return;
    const controller = new AbortController(); void load(controller.signal); return () => controller.abort();
  }, [initialWorkspace, load]);
  if (loading && !workspace) return <section className="surface tab-surface finance-state" aria-busy="true"><div className="skeleton skeleton--heading" /></section>;
  if (!workspace) return <section className="surface tab-surface page-state"><Landmark size={30} /><h2>Billing & money unavailable</h2><p>{error}</p><button className="button button--secondary" type="button" onClick={() => void load()}><RefreshCw size={15} /> Retry</button></section>;
  const clientName = (id: string) => workspace.clients.find((client) => client.id === id)?.name ?? 'Matter client';
  const availableFor = (bill: MatterBill) => Math.min(workspace.money.find((item) => item.clientPartyId === bill.clientPartyId)?.clientAvailableMinor ?? 0, bill.outstandingMinor);
  const transferApprover = (events: Array<Record<string, unknown>>) => events.find((event) => event.eventType === 'approved')?.recordedBy;
  return <section className="billing-workspace">
    <header className="finance-header"><div><span className="eyebrow">Governed billing & cashroom</span><h2>Billing & money</h2><p>Bills, client funds and office money remain exact, separate and fully auditable.</p></div><span className="governance-state"><ShieldCheck size={14} /> Human authority only</span></header>
    {error ? <div className="inline-notice inline-notice--error" role="alert">{error}</div> : null}
    <nav className="workspace-tabs finance-tabs" aria-label="Billing and money views">{(['billing','money','history'] as const).map((item) => <button key={item} type="button" className={view === item ? 'is-active' : ''} aria-current={view === item ? 'page' : undefined} onClick={() => setView(item)}>{label(item)}</button>)}</nav>
    {view === 'billing' ? <div className="finance-view"><header className="finance-view-header"><div><span className="eyebrow">Immutable bill register</span><h3>Bills</h3></div>{workspace.permissions.canPrepareBill ? <button className="button button--primary button--small" type="button" onClick={() => setCommand({ kind: 'prepare_bill' })}><Plus size={15} /> Prepare bill</button> : null}</header>
      <div className="billing-list">{workspace.bills.map((bill) => <article className="billing-card" key={bill.id}>
        <button className="billing-card__summary" type="button" aria-expanded={expanded === bill.id} onClick={() => setExpanded(expanded === bill.id ? '' : bill.id)} aria-label={`${bill.billReference ?? 'Draft bill'} ${label(bill.status)}`}>
          <span><strong>{bill.billReference ?? 'Draft bill'}</strong><small>{clientName(bill.clientPartyId)} · due {bill.dueOn}</small></span><span><strong>{money(bill.grossMinor)}</strong><small>{label(bill.status)} · {money(bill.outstandingMinor)} outstanding</small></span>
        </button>
        {expanded === bill.id ? <div className="billing-drilldown"><div className="billing-totals"><span>Net<strong>{money(bill.netMinor)}</strong></span><span>VAT<strong>{money(bill.vatMinor)}</strong></span><span>Paid<strong>{money(bill.paidMinor)}</strong></span></div>
          <div className="responsive-table" role="table" aria-label="Exact bill lines">{bill.lines.map((line) => <div className="billing-line" role="row" key={line.id}><span role="cell"><strong>{line.narrative}</strong><small>{label(line.sourceKind)} · exact source {line.sourceId.slice(0, 8)}</small></span><span role="cell">{money(line.sourceKind === 'adjustment' ? -line.netMinor : line.netMinor)}</span><span role="cell">VAT {money(line.sourceKind === 'adjustment' ? -line.vatMinor : line.vatMinor)}</span></div>)}</div>
          {bill.documentVersionId ? <a className="finance-source" href={`/api/finance/documents/bill/${bill.id}/versions/${bill.documentVersionId}/download?matterId=${matterId}`}>Download exact issued bill</a> : null}
          <div className="button-row billing-actions">
            {workspace.permissions.canPrepareBill && bill.status === 'draft' ? <button className="button button--secondary button--small" type="button" onClick={() => setCommand({ kind: 'submit_bill', bill })}>Submit bill</button> : null}
            {workspace.permissions.canApproveBill && bill.status === 'submitted' && bill.preparedBy !== workspace.actingUserId ? <button className="button button--primary button--small" type="button" onClick={() => setCommand({ kind: 'approve_bill', bill })}>Approve bill</button> : null}
            {workspace.permissions.canIssueBill && bill.status === 'approved' ? <button className="button button--primary button--small" type="button" onClick={() => setCommand({ kind: 'issue_bill', bill })}>Issue bill</button> : null}
            {workspace.permissions.canIssueBill && bill.status === 'issued' && availableDocumentSources.length ? <button className="button button--primary button--small" type="button" onClick={() => setCommand({ kind: 'deliver_bill', bill })}>Record delivery</button> : null}
          </div></div> : null}
      </article>)}</div></div> : null}
    {view === 'money' ? <div className="finance-view"><div className="money-grid">{workspace.money.map((balance) => <article className="finance-card money-card" key={balance.clientPartyId}><header><div><span className="eyebrow">{clientName(balance.clientPartyId)}</span><h3>Client money</h3></div><Landmark size={20} /></header><strong>{money(balance.clientAvailableMinor)} available</strong><small>{money(balance.clientHeldMinor)} held · {money(balance.clientRestrictedMinor)} restricted · {money(balance.clientReservedMinor)} reserved</small></article>)}
      <article className="finance-card money-card"><header><div><span className="eyebrow">Firm funds</span><h3>Office money</h3></div><ArrowRightLeft size={20} /></header><strong>{money(workspace.money.reduce((total, item) => total + item.officeHeldMinor, 0))} held</strong><small>Never combined with the client-money balance.</small></article></div>
      <section className="finance-section"><header><div><h4>Delivered bills eligible for transfer</h4><p>The limit is the lower of exact available client funds and the outstanding delivered bill.</p></div></header>{workspace.bills.filter((bill) => ['delivered','part_paid'].includes(bill.status)).map((bill) => <article className="finance-record" key={bill.id}><div className="finance-record__icon"><FileText size={18} /></div><div className="finance-record__body"><strong>{bill.billReference}</strong><p>Maximum transferable now</p><small>{money(availableFor(bill))} · {money(bill.outstandingMinor)} outstanding</small></div>{workspace.permissions.canPrepareTransfer && availableFor(bill) > 0 ? <button className="button button--primary button--small" type="button" onClick={() => setCommand({ kind: 'prepare_transfer', bill, balance: availableFor(bill) })}>Prepare transfer</button> : null}</article>)}</section>
      <section className="finance-section"><header><div><h4>Money movements</h4><p>Prepared, approved and externally posted facts remain separate.</p></div></header><div className="finance-list">
        {workspace.transfers.map((transfer) => <article className="finance-record" key={transfer.id}><div className="finance-record__icon"><ArrowRightLeft size={18} /></div><div className="finance-record__body"><strong>Client-to-office transfer · {money(transfer.amountMinor)}</strong><p>{label(transfer.status)} · bill {workspace.bills.find((bill) => bill.id === transfer.billId)?.billReference ?? transfer.billId.slice(0, 8)}</p><small>Prepared {new Date(transfer.preparedAt).toLocaleString('en-GB')}</small></div><div className="finance-record__actions">
          {workspace.permissions.canApproveTransfer && transfer.status === 'prepared' && transfer.preparedBy !== workspace.actingUserId ? <button className="button button--primary button--small" type="button" onClick={() => setCommand({ kind: 'approve_transfer', transfer })}>Approve transfer</button> : null}
          {workspace.permissions.canPostTransfer && transfer.status === 'approved' && transferApprover(transfer.events) !== workspace.actingUserId ? <button className="button button--primary button--small" type="button" onClick={() => setCommand({ kind: 'post_transfer', transfer })}>Post transfer</button> : null}
        </div></article>)}
        {workspace.payments.map((payment) => <article className="finance-record" key={payment.id}><div className="finance-record__icon"><Landmark size={18} /></div><div className="finance-record__body"><strong>Client payment · {money(payment.amountMinor)}</strong><p>{label(payment.status)} · {payment.purpose}</p><small>Bank action is recorded from external evidence only.</small></div></article>)}
      </div></section>
      {workspace.exceptions.length ? <section className="finance-warning-list"><h4>Blocking exceptions</h4>{workspace.exceptions.map((item) => <article key={item.id}><AlertTriangle size={18} /><div><strong>{label(item.severity)} · {label(item.kind)}</strong><p>{item.summary}</p></div></article>)}</section> : null}</div> : null}
    {view === 'history' ? <div className="finance-view"><section className="finance-section"><header><div><span className="eyebrow">Append-only evidence</span><h3>History</h3><p>Corrections appear as later events; retained facts are never overwritten.</p></div><History size={20} /></header><div className="finance-list">{workspace.history.map((event) => <article className="finance-record" key={event.id}><div className="finance-record__icon"><History size={17} /></div><div className="finance-record__body"><strong>{event.summary}</strong><p>{label(event.kind)} · {label(event.status)}</p><small>{new Date(event.occurredAt).toLocaleString('en-GB')}</small></div></article>)}</div></section></div> : null}
    {command ? <Suspense fallback={null}><BillingDialogs matterId={matterId} workspace={workspace} command={command} documentSources={availableDocumentSources} onClose={() => setCommand(null)} onCompleted={() => load()} /></Suspense> : null}
  </section>;
}
