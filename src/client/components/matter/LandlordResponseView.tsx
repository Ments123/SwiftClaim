import { AlertCircle, Building2, FileWarning } from 'lucide-react';

import type { ProtocolWorkspace } from '../../api.js';

const label = (value: string) => value.replaceAll('_', ' ').replace(/^./, (character) => character.toUpperCase());
const disclosureLabel = (value: string) => value === 'partial' ? 'Partial disclosure' : label(value);

interface Props { workspace: ProtocolWorkspace; onRecord: () => void; }

export function LandlordResponseView({ workspace, onRecord }: Props) {
  const response = workspace.landlordResponses[0];
  const positionByDefect = new Map(response?.defectPositions.map((position) => [position.defectId, position]));
  return <div className="protocol-view">
    <header className="protocol-view__header"><div><span className="eyebrow">Controlled response record</span><h3>Landlord response</h3><p>Every pleaded condition is tracked independently, including silence and ambiguity.</p></div>{workspace.permissions.canPrepare ? <button className="button button--primary button--small" type="button" onClick={onRecord}>Record response</button> : null}</header>
    {!response ? <div className="protocol-empty"><FileWarning size={28} /><strong>No landlord response recorded</strong><p>Silence is not inferred. Record a no-response event only after human review.</p></div> : <>
      <div className="protocol-response-summary"><span className="protocol-response-summary__icon"><Building2 size={21} /></span><div><span className="eyebrow">Responding party</span><h4>{response.respondingParty}</h4><p>{response.contactName || 'No contact named'} · received {response.receivedOn ?? 'not confirmed'}</p></div><span className="status-pill status-pill--warning">{label(response.generalLiabilityPosition)}</span></div>
      <div className="protocol-fact-grid"><section className="protocol-section"><span className="eyebrow">Liability</span><h4>{label(response.generalLiabilityPosition)}</h4><p>{response.liabilityReasons || 'No reasons supplied.'}</p></section><section className="protocol-section"><span className="eyebrow">Disclosure</span><h4>{disclosureLabel(response.disclosureStatus)}</h4><p>{response.disclosureSummary || 'No disclosure detail supplied.'}</p></section></div>
      <section className="protocol-section"><div className="protocol-section__heading"><div><span className="eyebrow">By-defect position</span><h4>Response coverage</h4></div><span className="count-badge">{response.defectPositions.length}/{workspace.letter.source.model.defects.length}</span></div><div className="protocol-position-list">{workspace.letter.source.model.defects.map((defect) => { const position = positionByDefect.get(defect.id); return <article key={defect.id}><span className={`position-marker ${position ? '' : 'is-missing'}`}>{position ? <Building2 size={15} /> : <AlertCircle size={15} />}</span><div><strong>{defect.title}</strong><small>{defect.location}</small>{position?.reason ? <p>{position.reason}</p> : null}</div><span className={position ? 'status-pill' : 'status-pill status-pill--critical'}>{position ? label(position.position) : 'Not addressed'}</span></article>; })}</div></section>
      <div className="protocol-fact-grid"><section className="protocol-section"><span className="eyebrow">Notice & access</span><h4>Factual positions</h4><dl className="protocol-dl"><div><dt>Notice</dt><dd>{response.noticePosition || 'Not addressed'}</dd></div><div><dt>Access</dt><dd>{response.accessPosition || 'Not addressed'}</dd></div></dl></section><section className="protocol-section"><span className="eyebrow">Works & expert</span><h4>Proposals</h4><dl className="protocol-dl"><div><dt>Expert</dt><dd>{label(response.expertProposalPosition)}</dd></div><div><dt>Works</dt><dd>{response.worksSchedule || 'Not addressed'}</dd></div></dl></section></div>
    </>}
  </div>;
}
