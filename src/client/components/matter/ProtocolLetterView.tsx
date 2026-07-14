import { CheckCircle2, Download, FileCheck2, Link2, ShieldAlert } from 'lucide-react';

import type { ProtocolWorkspace } from '../../api.js';

const label = (value: string) => value.replaceAll('_', ' ').replace(/^./, (character) => character.toUpperCase());

interface Props {
  matterId: string;
  workspace: ProtocolWorkspace;
  onAction: (action: 'edit_letter' | 'approve_letter' | 'record_service') => void;
}

export function ProtocolLetterView({ matterId, workspace, onAction }: Props) {
  const { letter, letterVersions, serviceEvents, permissions } = workspace;
  const latestVersion = letterVersions[0];
  return (
    <div className="protocol-view">
      <header className="protocol-view__header">
        <div><span className="eyebrow">Source-linked claim</span><h3>Letter of Claim</h3><p>Canonical matter facts remain separate from reviewed solicitor narrative.</p></div>
        {permissions.canPrepare ? <div className="button-row"><button className="button button--secondary button--small" type="button" onClick={() => onAction('edit_letter')}>Edit preparation</button>{permissions.canApprove ? <button className="button button--primary button--small" type="button" disabled={letter.source.blockers.length > 0} onClick={() => onAction('approve_letter')}>Approve exact version</button> : null}</div> : null}
      </header>

      <div className="protocol-provenance-row">
        <span className="provenance-chip provenance-chip--confirmed"><CheckCircle2 size={14} /> Confirmed fact</span>
        <span className="provenance-chip"><FileCheck2 size={14} /> User supplied</span>
        <span className={`provenance-chip ${latestVersion?.sourceFreshness.fresh ? 'provenance-chip--confirmed' : 'provenance-chip--warning'}`}><Link2 size={14} /> {latestVersion?.sourceFreshness.fresh ? 'Approved sources current' : 'Approved sources changed'}</span>
      </div>

      {letter.source.blockers.length || letter.source.warnings.length ? <div className="protocol-issue-list">{letter.source.blockers.map((item) => <article className="is-critical" key={item.key}><ShieldAlert size={16} /><div><strong>Missing</strong><span>{item.label}</span></div></article>)}{letter.source.warnings.map((item) => <article key={item.key}><ShieldAlert size={16} /><div><strong>Review</strong><span>{item.label}</span></div></article>)}</div> : null}

      <section className="protocol-section">
        <div className="protocol-section__heading"><div><span className="eyebrow">Defect schedule</span><h4>Conditions relied upon</h4></div><span className="count-badge">{letter.source.model.defects.length}</span></div>
        <div className="protocol-defect-grid">{letter.source.model.defects.map((defect) => <article key={defect.id}><header><strong>{defect.title}</strong><span>{defect.severity ? label(defect.severity) : 'Confirmed fact'}</span></header><small>{defect.location}</small>{defect.description ? <p>{defect.description}</p> : null}</article>)}</div>
      </section>

      <div className="protocol-fact-grid">
        <section className="protocol-section"><span className="eyebrow">Notice</span><h4>Landlord knowledge</h4>{letter.source.model.notices?.length ? letter.source.model.notices.map((notice) => <div className="protocol-event" key={notice.id}><strong>{label(notice.channel)}</strong><span>{notice.summary}</span><time>{notice.occurredAt}</time></div>) : <p className="protocol-missing">Missing</p>}</section>
        <section className="protocol-section"><span className="eyebrow">Access</span><h4>Inspection history</h4>{letter.source.model.access?.length ? letter.source.model.access.map((access) => <div className="protocol-event" key={access.id}><strong>{label(access.eventType)}</strong><span>{access.notes}</span><time>{access.appointmentAt ?? 'No date recorded'}</time></div>) : <p className="protocol-missing">Missing</p>}</section>
      </div>

      <section className="protocol-section"><span className="eyebrow">Client effect</span><h4>Reviewed narrative</h4><p>{letter.source.model.effectNarrative || 'Missing'}</p></section>
      <section className="protocol-section"><span className="eyebrow">Disclosure sought</span><h4>Requested records</h4><ul className="protocol-request-list">{letter.source.model.disclosureRequests?.map((request) => <li key={request}>{request}</li>)}</ul></section>

      <section className="protocol-section">
        <div className="protocol-section__heading"><div><span className="eyebrow">Immutable output</span><h4>Approved versions</h4></div>{latestVersion && permissions.canPrepare ? <button className="button button--secondary button--small" type="button" onClick={() => onAction('record_service')}>Record dispatch or receipt</button> : null}</div>
        {letterVersions.length ? <div className="protocol-version-list">{letterVersions.map((version) => <article key={version.id}><FileCheck2 size={19} /><div><strong>Letter of Claim v{version.version}</strong><small>{version.documentVersion.originalName} · SHA-256 {version.contentSha256.slice(0, 12)}…</small></div><span className={version.sourceFreshness.fresh ? 'status-pill status-pill--success' : 'status-pill status-pill--warning'}>{version.sourceFreshness.fresh ? 'Sources current' : 'Source change'}</span><a className="icon-button" href={`/api/matters/${matterId}/protocol/generated/${version.documentVersion.id}/download`} aria-label={`Download Letter of Claim v${version.version}`}><Download size={17} /></a></article>)}</div> : <p className="protocol-empty-copy">No approved version exists. A generated draft is not proof of dispatch.</p>}
        {serviceEvents.length ? <div className="protocol-service-log">{serviceEvents.map((event) => <div key={event.id}><strong>{label(event.eventType)}</strong><span>{event.recipient} · {label(event.method)}</span><time>{event.occurredAt}</time></div>)}</div> : null}
      </section>
    </div>
  );
}
