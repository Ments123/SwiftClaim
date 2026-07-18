import { AlertTriangle, CalendarClock, CheckCircle2, FileCheck2, Gavel, Scale, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import type { ProceedingsWorkspace } from '../../api.js';
import { CreateProceedingDialog } from './ProceedingsDialogs.js';

interface ProceedingsPanelProps {
  matterId: string;
  workspace: ProceedingsWorkspace;
  onRefresh: () => Promise<void> | void;
}

type View = 'case' | 'filings' | 'directions' | 'applications' | 'hearings';

function label(value: string): string {
  return value.replaceAll('_', ' ').replace(/^./, (first) => first.toUpperCase());
}

function dateTime(value: string | null): string {
  if (!value) return 'Not recorded';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function Empty({ title, text }: { title: string; text: string }) {
  return <div className="proceedings-empty"><Scale size={24} /><h4>{title}</h4><p>{text}</p></div>;
}

export function ProceedingsPanel({ matterId, workspace, onRefresh }: ProceedingsPanelProps) {
  const [view, setView] = useState<View>('case');
  const [createOpen, setCreateOpen] = useState(false);
  const proceeding = workspace.proceeding;
  const nextHearing = [...workspace.hearings]
    .filter((hearing) => !['vacated', 'completed'].includes(hearing.projection.state))
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt))[0];
  const overdue = workspace.directions.filter(({ projection }) => projection.overdue);
  const reviewedServices = workspace.services.filter(({ currentState }) => currentState === 'reviewed');
  const assertedDirections = workspace.directions.filter(
    ({ projection }) => projection.state === 'performance_asserted',
  );

  return (
    <section className="proceedings-workspace">
      <header className="proceedings-header">
        <div><span className="eyebrow">Court record · governed facts</span><h2>Proceedings</h2>
          <p>Filing, issue, service, orders and compliance remain distinct, source-backed events.</p></div>
        {proceeding ? <span className="governance-state"><ShieldCheck size={14} /> Human-confirmed court record</span>
          : workspace.permissions?.canPrepare !== false ? <button className="button button--primary button--small" type="button" onClick={() => setCreateOpen(true)}>Create proceeding</button> : null}
      </header>

      <div className="proceedings-critical" aria-label="Critical court summary">
        <article><CalendarClock size={20} /><div><h3>Next court date</h3><strong>{nextHearing ? dateTime(nextHearing.startsAt) : 'No hearing listed'}</strong><span>{nextHearing?.title ?? 'Retain the court listing notice when received.'}</span></div></article>
        <article className={overdue.length ? 'is-critical' : ''}><AlertTriangle size={20} /><div><h3>Directions</h3><strong>{overdue.length} overdue direction{overdue.length === 1 ? '' : 's'}</strong><span>{assertedDirections.length ? 'Performance asserted — evidence not accepted' : 'No unaccepted performance assertion'}</span></div></article>
        <article><FileCheck2 size={20} /><div><h3>Service position</h3><strong>{reviewedServices.length ? 'Service reviewed' : 'Service not reviewed'}</strong><span>{reviewedServices.length} of {workspace.services.length} records human-reviewed</span></div></article>
      </div>

      <nav className="workspace-tabs" aria-label="Proceedings views">
        {([['case', 'Case'], ['filings', 'Filings & service'], ['directions', 'Directions'],
          ['applications', 'Applications'], ['hearings', 'Hearings & orders']] as const)
          .map(([id, text]) => <button key={id} type="button" className={view === id ? 'is-active' : ''}
            aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}>{text}</button>)}
      </nav>

      <div className="proceedings-content">
        {view === 'case' ? proceeding ? <div className="proceedings-view">
          <header><div><span className="eyebrow">{proceeding.proceedingReference}</span><h3>{proceeding.caseNumber ?? 'Case number pending'}</h3></div>
            <span className={`governance-state governance-state--${proceeding.currentState}`}>
              {proceeding.currentState === 'issued' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}{label(proceeding.currentState)}</span></header>
          <dl className="proceedings-details"><div><dt>Procedure</dt><dd>{label(proceeding.procedureType)}</dd></div><div><dt>Court</dt><dd>{proceeding.courtName}</dd></div><div><dt>Track</dt><dd>{proceeding.track ? label(proceeding.track) : 'Not allocated'}</dd></div><div><dt>Issued</dt><dd>{dateTime(proceeding.issuedAt)}</dd></div><div><dt>Issue authority</dt><dd>{workspace.authority ? `Version ${workspace.authority.version}` : 'Required'}</dd></div></dl>
        </div> : <Empty title="No proceeding workspace" text="Create the governed court record before preparing an issue request." /> : null}

        {view === 'filings' ? <div className="proceedings-view"><header><div><span className="eyebrow">Submission is not acceptance</span><h3>Filings & service</h3></div></header>
          {workspace.filings.map((filing) => <article className="proceedings-record" key={filing.id}><div><span>{filing.filingReference}</span><h4>{filing.purpose}</h4></div><strong>{label(filing.currentState)}</strong></article>)}
          {workspace.services.map((record) => <article className="proceedings-record" key={record.id}><div><span>{record.serviceReference} · {label(record.method)}</span><h4>Service on retained recipient</h4></div><strong>{record.currentState === 'reviewed' ? 'Service reviewed' : label(record.currentState)}</strong></article>)}
          {!workspace.filings.length && !workspace.services.length ? <Empty title="No filing or service records" text="Prepare exact document sets and keep each recipient’s service record separate." /> : null}</div> : null}

        {view === 'directions' ? <div className="proceedings-view"><header><div><span className="eyebrow">Atomic obligations</span><h3>Directions</h3></div></header>
          {workspace.directions.map((direction) => <article className={`proceedings-record ${direction.projection.overdue ? 'is-critical' : ''}`} key={direction.id}><div><span>{direction.directionReference} · due {dateTime(direction.dueAt)}</span><h4>{direction.requirementText}</h4></div><strong>{direction.projection.state === 'performance_asserted' ? 'Performance asserted — evidence not accepted' : label(direction.projection.state)}</strong></article>)}
          {!workspace.directions.length ? <Empty title="No court directions" text="Transcribe each obligation separately from the exact sealed order or rule source." /> : null}</div> : null}

        {view === 'applications' ? <div className="proceedings-view"><header><div><span className="eyebrow">Notice and evidence retained</span><h3>Applications</h3></div></header>
          {workspace.applications.map((application) => <article className="proceedings-record" key={application.id}><div><span>{application.applicationReference} · {label(application.noticePosition)}</span><h4>{application.requestedOrder}</h4></div><strong>{label(application.currentState)}</strong></article>)}
          {!workspace.applications.length ? <Empty title="No applications" text="Prepared, filed, served and decided remain separate application events." /> : null}</div> : null}

        {view === 'hearings' ? <div className="proceedings-view"><header><div><span className="eyebrow">Outcome is not an order</span><h3>Hearings & orders</h3></div></header>
          {workspace.hearings.map((hearing) => <article className="proceedings-record" key={hearing.id}><div><span>{hearing.hearingReference} · {dateTime(hearing.startsAt)}</span><h4>{hearing.title}</h4></div><strong>{label(hearing.projection.state)}</strong></article>)}
          {workspace.orders.map((order) => <article className="proceedings-record" key={order.id}><div><span>{order.orderReference} · {order.orderDate}</span><h4>{order.title}</h4></div><strong>Sealed order</strong></article>)}
          {!workspace.hearings.length && !workspace.orders.length ? <Empty title="No hearings or orders" text="Retain listing notices, factual outcomes and sealed orders as separate records." /> : null}</div> : null}
      </div>
      <CreateProceedingDialog open={createOpen} matterId={matterId} onClose={() => setCreateOpen(false)} onSaved={onRefresh} />
    </section>
  );
}
