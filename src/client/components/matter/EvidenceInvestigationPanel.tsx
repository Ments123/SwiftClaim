import { AlertTriangle, CheckCircle2, FileCheck2, FolderOpen, Link2, ShieldCheck, XCircle } from 'lucide-react';
import { useState } from 'react';

import type { EvidenceWorkspace } from '../../api.js';
import { EvidenceItemDialog } from './EvidenceDialogs.js';

interface Props { matterId: string; workspace: EvidenceWorkspace; onRefresh: () => Promise<void>; onNavigateDocuments: () => void; }
const label = (value: string) => value.replaceAll('_', ' ').replace(/^./, (char) => char.toUpperCase());

export function EvidenceInvestigationPanel({ matterId, workspace, onRefresh, onNavigateDocuments }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [kind, setKind] = useState('all');
  const visible = kind === 'all' ? workspace.evidenceItems : workspace.evidenceItems.filter((item) => item.kind === kind);
  const defectTitle = (id: string) => workspace.defects.find((item) => item.id === id)?.title ?? 'Unavailable defect';
  return <section className="evidence-workspace" aria-labelledby="evidence-title"><header className="section-header section-header--page"><div><span className="eyebrow">Preserved proof</span><h2 id="evidence-title">Evidence investigation</h2><p>Every classification points to one immutable document version and retains its provenance.</p></div>{workspace.permissions.canWrite ? workspace.availableDocumentVersions.length ? <button className="button button--primary button--small" type="button" onClick={() => setDialogOpen(true)}><Link2 size={15} /> Link evidence</button> : <button className="button button--secondary button--small" type="button" onClick={onNavigateDocuments}><FolderOpen size={15} /> Go to Documents</button> : null}</header>
    <div className="readiness-grid">{workspace.readiness.controls.map((control) => <article className={control.eligible ? 'is-ready' : 'is-blocked'} key={control.key}>{control.eligible ? <CheckCircle2 size={19} /> : <XCircle size={19} />}<div><strong>{label(control.key)}</strong><span>{control.explanation}</span></div></article>)}</div>
    {workspace.risks.length ? <div className="evidence-risk-strip" aria-label="Evidence risks">{workspace.risks.map((risk) => <article key={risk.key}><AlertTriangle size={16} /><div><strong>{risk.title}</strong><span>{risk.detail}</span></div></article>)}</div> : null}
    <div className="evidence-register-header"><div><ShieldCheck size={18} /><strong>{workspace.evidenceItems.length} preserved evidence items</strong></div><label>Filter evidence<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">All kinds</option><option value="photograph">Photographs</option><option value="correspondence">Correspondence</option><option value="repair_record">Repair records</option><option value="tenancy_record">Tenancy records</option><option value="medical_link">Medical links</option></select></label></div>
    <div className="evidence-card-grid">{visible.map((item) => <article className="evidence-card" key={item.id}><header><FileCheck2 size={20} /><span>{label(item.kind)}</span></header><h3>{item.title}</h3><p>{item.description}</p><dl><div><dt>Source file</dt><dd>{item.documentVersion.originalName}</dd></div><div><dt>Immutable version</dt><dd>Version {item.documentVersion.version}</dd></div><div><dt>SHA-256</dt><dd><code>{item.documentVersion.sha256.slice(0, 12)}…</code></dd></div><div><dt>Provenance</dt><dd>{item.provenanceDetail}</dd></div></dl><footer>{item.defectIds.map((id) => <span key={id}>{defectTitle(id)}</span>)}{item.noticeIds.map((id) => <span key={id}>Linked notice</span>)}{item.accessEventIds.map((id) => <span key={id}>Linked access event</span>)}</footer></article>)}</div>
    {!visible.length ? <div className="empty-state"><FileCheck2 /><strong>No matching evidence</strong><p>Link an exact document version to an investigation fact.</p></div> : null}
    <EvidenceItemDialog matterId={matterId} open={dialogOpen} onClose={() => setDialogOpen(false)} onSaved={onRefresh} workspace={workspace} />
  </section>;
}
