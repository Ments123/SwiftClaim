import { AlertTriangle, CalendarClock, CheckCircle2, CircleSlash2, Scale, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import type { ProtocolWorkspace } from '../../api.js';
import { ExpertEvidenceView } from './ExpertEvidenceView.js';
import { LandlordResponseView } from './LandlordResponseView.js';
import { ProtocolActionDialog, type ProtocolAction } from './ProtocolDialogs.js';
import { ProtocolLetterView } from './ProtocolLetterView.js';

interface Props { matterId: string; workspace: ProtocolWorkspace; onRefresh: () => Promise<void>; }
type View = 'letter' | 'response' | 'experts';
const label = (value: string) => value.replaceAll('_', ' ').replace(/^./, (character) => character.toUpperCase());

export function ProtocolExpertsPanel({ matterId, workspace, onRefresh }: Props) {
  const [view, setView] = useState<View>('letter');
  const [action, setAction] = useState<ProtocolAction | null>(null);
  const nextDeadline = workspace.deadlines.find((deadline) => deadline.status === 'pending') ?? workspace.deadlines[0];
  const readyCount = workspace.readiness.controls.filter((control) => control.eligible).length;
  return <section className="protocol-workspace" aria-labelledby="protocol-title">
    <header className="protocol-workspace__header"><div><span className="eyebrow">Human-governed legal work</span><h2 id="protocol-title">Protocol & experts</h2><p>Prepare, approve and evidence the pre-action path without turning drafts into facts.</p></div><span className="protocol-stage"><Scale size={16} /> {label(workspace.case.protocolStatus)}</span></header>

    <div className="protocol-risk-grid" aria-label="Protocol status and risks">
      {workspace.risks.map((risk) => <article className={`protocol-risk-card protocol-risk-card--${risk.level}`} key={risk.key}><AlertTriangle size={18} /><div><span>{label(risk.level)} risk</span><strong>{risk.title}</strong><p>{risk.detail}</p></div></article>)}
      <article className="protocol-readiness-card">{workspace.readiness.progressionBlockers.length ? <CircleSlash2 size={18} /> : <CheckCircle2 size={18} />}<div><span>Readiness</span><strong>{readyCount}/{workspace.readiness.controls.length} controls satisfied</strong><p>{workspace.readiness.progressionBlockers[0]?.label ?? 'No objective progression blocker is recorded.'}</p></div></article>
    </div>

    <div className="protocol-caseboard">
      <div className="protocol-caseboard__main">
        <div className="protocol-view-tabs" role="group" aria-label="Protocol workspace views"><button type="button" className={view === 'letter' ? 'is-active' : ''} onClick={() => setView('letter')}>Letter of Claim</button><button type="button" className={view === 'response' ? 'is-active' : ''} onClick={() => setView('response')}>Landlord response</button><button type="button" className={view === 'experts' ? 'is-active' : ''} onClick={() => setView('experts')}>Experts</button></div>
        {view === 'letter' ? <ProtocolLetterView matterId={matterId} workspace={workspace} onAction={setAction} /> : null}
        {view === 'response' ? <LandlordResponseView workspace={workspace} onRecord={() => setAction('record_response')} /> : null}
        {view === 'experts' ? <ExpertEvidenceView workspace={workspace} onAction={setAction} /> : null}
      </div>
      <aside className="protocol-caseboard__rail">
        {nextDeadline ? <section className="protocol-deadline-card"><header><span><CalendarClock size={18} /></span><div><small>Next legal date</small><strong>{nextDeadline.title}</strong></div></header><time dateTime={nextDeadline.dueDate}>{new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${nextDeadline.dueDate}T00:00:00Z`))}</time><p>{nextDeadline.explanation}</p><footer><span className="provenance-chip provenance-chip--confirmed"><ShieldCheck size={13} /> Official calculation</span><a href={nextDeadline.sourceUrl} target="_blank" rel="noreferrer">{nextDeadline.sourceTitle}</a></footer></section> : null}
        <section className="protocol-control-card"><span className="eyebrow">Objective controls</span><h3>Progression evidence</h3>{workspace.readiness.controls.map((control) => <article key={control.key}>{control.eligible ? <CheckCircle2 size={16} /> : <CircleSlash2 size={16} />}<div><strong>{label(control.key)}</strong><span>{control.explanation}</span></div></article>)}</section>
        <section className="protocol-control-card"><span className="eyebrow">Authority</span><h3>Available actions</h3><dl className="protocol-dl"><div><dt>Prepare</dt><dd>{workspace.permissions.canPrepare ? 'Authorised' : 'Read only'}</dd></div><div><dt>Approve</dt><dd>{workspace.permissions.canApprove ? 'Authorised' : 'Restricted'}</dd></div><div><dt>Conflict override</dt><dd>{workspace.permissions.canOverrideConflict ? 'Authorised' : 'Restricted'}</dd></div><div><dt>Report review</dt><dd>{workspace.permissions.canReviewReport ? 'Authorised' : 'Restricted'}</dd></div></dl></section>
      </aside>
    </div>
    <ProtocolActionDialog action={action} matterId={matterId} workspace={workspace} onClose={() => setAction(null)} onSaved={onRefresh} />
  </section>;
}
