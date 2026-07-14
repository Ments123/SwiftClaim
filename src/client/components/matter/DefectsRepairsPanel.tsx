import { AlertTriangle, Camera, Edit3, KeyRound, Mail, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { EvidenceDefect, EvidenceWorkspace } from '../../api.js';
import { AccessDialog, DefectDialog, NoticeDialog } from './EvidenceDialogs.js';

interface Props { matterId: string; workspace: EvidenceWorkspace; onRefresh: () => Promise<void>; }
const label = (value: string) => value.replaceAll('_', ' ').replace(/^./, (char) => char.toUpperCase());
const date = (value: string | null) => value ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value)) : 'Date not recorded';

export function DefectsRepairsPanel({ matterId, workspace, onRefresh }: Props) {
  const [dialog, setDialog] = useState<'defect' | 'notice' | 'access' | null>(null);
  const [editing, setEditing] = useState<EvidenceDefect>();
  const groups = useMemo(() => {
    const result = new Map<string, EvidenceDefect[]>();
    for (const defect of workspace.defects) {
      result.set(defect.location, [...(result.get(defect.location) ?? []), defect]);
    }
    return result;
  }, [workspace.defects]);
  const active = workspace.defects.filter(({ status }) => !['repaired', 'superseded'].includes(status));
  const close = () => { setDialog(null); setEditing(undefined); };
  return <section className="evidence-workspace" aria-labelledby="defects-title">
    <header className="section-header section-header--page"><div><span className="eyebrow">Structured investigation</span><h2 id="defects-title">Defects & repairs</h2><p>Observed conditions, landlord notice and access history. No liability determination is made.</p></div>{workspace.permissions.canWrite ? <div className="button-row"><button className="button button--secondary button--small" type="button" onClick={() => setDialog('notice')}><Mail size={15} /> Record notice</button><button className="button button--secondary button--small" type="button" onClick={() => setDialog('access')}><KeyRound size={15} /> Record access</button><button className="button button--primary button--small" type="button" onClick={() => setDialog('defect')}><Plus size={15} /> Add defect</button></div> : null}</header>
    <div className="evidence-metrics"><div><strong>{active.length} active defects</strong><span>{groups.size} locations</span></div><div><strong>{workspace.notices.length} notices</strong><span>{workspace.notices.filter(({ proofStatus }) => proofStatus === 'linked').length} with linked proof</span></div><div><strong>{workspace.accessEvents.length} access events</strong><span>{workspace.accessEvents.filter(({ eventType }) => eventType === 'completed').length} completed</span></div></div>
    {workspace.risks.length ? <div className="evidence-risk-strip" aria-label="Investigation risks">{workspace.risks.map((risk) => <article key={risk.key}><AlertTriangle size={16} /><div><strong>{risk.title}</strong><span>{risk.detail}</span></div></article>)}</div> : null}
    <div className="defect-groups">{[...groups.entries()].map(([location, defects]) => <section key={location}><h3>{location}</h3><div className="defect-grid">{defects.map((defect) => <article className={`defect-card defect-card--${defect.severity}`} key={defect.id}><header><span className={`status-pill status-pill--${defect.status}`}>{label(defect.status)}</span><span className={`severity-pill severity-pill--${defect.severity}`}>{label(defect.severity)}</span></header><h4>{defect.title}</h4><p>{defect.description}</p>{defect.healthImpact ? <small>Reported impact: {defect.healthImpact}</small> : null}<footer><span>{date(defect.firstObservedOn)}</span><span><Camera size={13} /> {defect.evidenceIds.length} linked</span>{workspace.permissions.canWrite ? <button type="button" className="button button--ghost button--small" onClick={() => { setEditing(defect); setDialog('defect'); }}><Edit3 size={13} /> Edit</button> : null}</footer></article>)}</div></section>)}</div>
    <div className="investigation-history"><section><h3>Notice chronology</h3>{workspace.notices.map((notice) => <article key={notice.id}><strong>{notice.recipientName}</strong><span>{label(notice.channel)} · {date(notice.occurredAt)}</span><p>{notice.summary}</p><small>Proof: {label(notice.proofStatus)} · Response: {label(notice.responseStatus)}</small></article>)}</section><section><h3>Access history</h3>{workspace.accessEvents.map((access) => <article key={access.id}><strong>{label(access.eventType)}</strong><span>{date(access.appointmentAt)}</span><p>{access.notes}</p></article>)}</section></div>
    <DefectDialog matterId={matterId} open={dialog === 'defect'} defect={editing} onClose={close} onSaved={onRefresh} />
    <NoticeDialog matterId={matterId} open={dialog === 'notice'} onClose={close} onSaved={onRefresh} />
    <AccessDialog matterId={matterId} open={dialog === 'access'} onClose={close} onSaved={onRefresh} />
  </section>;
}
