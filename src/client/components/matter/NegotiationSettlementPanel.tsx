import {
  AlertTriangle,
  CheckCircle2,
  FileCheck2,
  Handshake,
  LockKeyhole,
  Scale,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { useState } from 'react';

import type { NegotiationWorkspace } from '../../api.js';
import { ClientInstructionDialog } from './ClientInstructionDialog.js';
import { NegotiationActionDialog } from './NegotiationActionDialog.js';
import { NegotiationReviewDialog } from './NegotiationReviewDialog.js';
import { SettlementDialog } from './SettlementDialog.js';

interface NegotiationSettlementPanelProps {
  matterId: string;
  workspace: NegotiationWorkspace;
  onRefresh: () => Promise<void>;
  loadProtected: () => Promise<NegotiationWorkspace>;
}

type View = 'position' | 'advice' | 'authority' | 'settlement';

function money(value: number | null, currency = 'GBP') {
  if (value === null) return 'Not recorded';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(value / 100);
}

function stateLabel(value: string) {
  return value.replaceAll('_', ' ');
}

export function NegotiationSettlementPanel({
  matterId,
  workspace,
  onRefresh,
  loadProtected,
}: NegotiationSettlementPanelProps) {
  const [view, setView] = useState<View>('position');
  const [protectedWorkspace, setProtectedWorkspace] = useState<NegotiationWorkspace>();
  const [protectedError, setProtectedError] = useState('');
  const [loadingProtected, setLoadingProtected] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [actionOpen, setActionOpen] = useState(false);
  const [instructionOpen, setInstructionOpen] = useState(false);
  const [settlementOpen, setSettlementOpen] = useState(false);
  const active = protectedWorkspace ?? workspace;
  const authority = protectedWorkspace?.currentAuthority ?? workspace.currentAuthority;

  const revealProtected = async () => {
    setLoadingProtected(true);
    setProtectedError('');
    try {
      setProtectedWorkspace(await loadProtected());
    } catch (reason) {
      setProtectedError(reason instanceof Error ? reason.message : 'Protected workspace unavailable.');
    } finally {
      setLoadingProtected(false);
    }
  };

  return (
    <section className="negotiation-workspace">
      <header className="negotiation-header">
        <div>
          <span className="eyebrow">Governed human decisions</span>
          <h2>Negotiation & settlement</h2>
          <p>Advice, instructions and authority remain separate from external acts and legal conclusions.</p>
        </div>
        {protectedWorkspace ? (
          <span className="protected-access-badge"><LockKeyhole size={14} /> Protected view active</span>
        ) : (
          <button className="button button--secondary button--small" type="button" disabled={loadingProtected} onClick={() => void revealProtected()}>
            <LockKeyhole size={14} /> {loadingProtected ? 'Opening…' : 'Open protected view'}
          </button>
        )}
      </header>

      {protectedError ? <div className="inline-notice inline-notice--error" role="alert">{protectedError}</div> : null}
      <div className="negotiation-control-note">
        <ShieldCheck size={17} />
        <span>SwiftClaim records source facts and human decisions. It does not decide whether an offer should be made, accepted, rejected or treated as binding.</span>
      </div>

      <div className="negotiation-metrics" aria-label="Negotiation record summary">
        <div><Scale size={17} /><span>Current actions</span><strong>{active.actions.length}</strong></div>
        <div><UserCheck size={17} /><span>Instructions</span><strong>{active.instructions.length}</strong></div>
        <div><FileCheck2 size={17} /><span>Advice reviews</span><strong>{active.reviews.length}</strong></div>
        <div><Handshake size={17} /><span>Settlements</span><strong>{active.settlements.length}</strong></div>
      </div>

      <nav className="workspace-tabs" aria-label="Negotiation views">
        {([
          ['position', 'Position'],
          ['advice', 'Advice & instructions'],
          ['authority', 'Authority'],
          ['settlement', 'Settlement & compliance'],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" className={view === id ? 'is-active' : ''} aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}>{label}</button>
        ))}
      </nav>

      <div className="negotiation-content">
        {view === 'position' ? (
          <div className="negotiation-view">
            <header><div><span className="eyebrow">Exact versions</span><h3>Proposed actions</h3></div><button className="button button--primary button--small" type="button" onClick={() => setActionOpen(true)}>Prepare action</button></header>
            {active.actions.length ? <div className="negotiation-card-list">{active.actions.map((action) => (
              <article className="negotiation-card" key={action.id}>
                <div><span>{action.actionReference} · v{action.currentVersion.version}</span><h4>{stateLabel(action.actionType)}</h4><p>{money(action.currentVersion.totalMinor, action.currentVersion.currency)}</p></div>
                <span className={`governance-state governance-state--${action.projection.state}`}>
                  {action.projection.state === 'authorised' || action.projection.state === 'externally_recorded' ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                  {stateLabel(action.projection.state)}
                </span>
                <dl><div><dt>Exact instruction</dt><dd>{action.projection.instructionCurrent ? 'Current' : 'Required'}</dd></div><div><dt>Firm approval</dt><dd>{action.projection.approvalCurrent ? 'Current' : 'Required'}</dd></div></dl>
              </article>
            ))}</div> : <Empty title="No negotiation actions" text="Prepare exact terms before recording instructions or requesting approval." />}
          </div>
        ) : null}

        {view === 'advice' ? (
          <div className="negotiation-view">
            <header><div><span className="eyebrow">Human-authored</span><h3>Advice & client instructions</h3></div><div className="button-row"><button className="button button--secondary button--small" type="button" onClick={() => setInstructionOpen(true)}>Record instruction</button><button className="button button--primary button--small" type="button" onClick={() => setReviewOpen(true)}>Record advice review</button></div></header>
            {active.reviews.map((review) => <article className="advice-record" key={review.id}><header><div><span>Review {review.reviewNumber} · {review.reviewedOn}</span><h4>{review.humanRecommendation || 'No recommendation recorded'}</h4></div><code title={review.sourceManifestDigest}>{review.sourceManifestDigest.slice(0, 10)}…</code></header><p>{review.riskAnalysis}</p><small>{stateLabel(review.confidentiality)} · immutable source manifest</small></article>)}
            {active.instructions.map((instruction) => <article className="instruction-record" key={instruction.id}><UserCheck size={17} /><div><span>{stateLabel(instruction.instructionType)} · {instruction.receivedMethod}</span><strong>{instruction.instructingPerson}</strong><p>{instruction.decisionNote}</p></div><time>{new Date(instruction.receivedAt).toLocaleDateString('en-GB')}</time></article>)}
            {!active.reviews.length && !active.instructions.length ? <Empty title="No advice or instruction records" text="Record human-authored advice before retaining the client’s exact decision." /> : null}
          </div>
        ) : null}

        {view === 'authority' ? authority ? (
          <article className="authority-card"><header><div><span className="eyebrow">Current immutable version</span><h3>Settlement authority v{authority.version}</h3></div><ShieldCheck size={24} /></header><p>{authority.scope}</p><dl><div><dt>Action types</dt><dd>{authority.actionTypes.map(stateLabel).join(', ')}</dd></div><div><dt>Recorded range</dt><dd>{money(authority.minimumAmountMinor)} – {money(authority.maximumAmountMinor)}</dd></div><div><dt>Client instruction</dt><dd>{authority.requiresClientInstruction ? 'Required' : 'Not required by this record'}</dd></div><div><dt>Partner approval</dt><dd>{authority.requiresPartnerApproval ? 'Required' : 'Not required by this record'}</dd></div><div><dt>Review on</dt><dd>{authority.reviewOn ?? 'No review date'}</dd></div></dl><small>{authority.reviewNote}</small></article>
        ) : <Empty title="No current authority" text="Open the protected view to inspect authority, or record a reviewed authority version." /> : null}

        {view === 'settlement' ? (
          <div className="negotiation-view"><header><div><span className="eyebrow">Terms are not closure</span><h3>Settlement & compliance</h3></div><button className="button button--primary button--small" type="button" onClick={() => setSettlementOpen(true)}>Create settlement record</button></header>{active.settlements.length ? <div className="negotiation-card-list">{active.settlements.map((settlement) => <article className="settlement-card" key={settlement.id}><header><div><span>{settlement.settlementReference}</span><h4>{settlement.title}</h4></div><span className={`governance-state governance-state--${settlement.projection.state}`}>{stateLabel(settlement.projection.state)}</span></header><dl><div><dt>Exact terms</dt><dd>{settlement.currentTerms ? `v${settlement.currentTerms.version} · ${money(settlement.currentTerms.totalMinor, settlement.currentTerms.currency)}` : 'Not recorded'}</dd></div><div><dt>Court approval</dt><dd>{stateLabel(settlement.courtApprovalPosition)}</dd></div><div><dt>Payment due</dt><dd>{settlement.currentTerms?.paymentDueAt ? new Date(settlement.currentTerms.paymentDueAt).toLocaleString('en-GB') : 'Not recorded'}</dd></div></dl></article>)}</div> : <Empty title="No settlement record" text="Agreed terms, retained instruments and performance obligations will appear here." />}</div>
        ) : null}
      </div>

      <NegotiationReviewDialog open={reviewOpen} matterId={matterId} onClose={() => setReviewOpen(false)} onSaved={onRefresh} />
      <NegotiationActionDialog open={actionOpen} matterId={matterId} onClose={() => setActionOpen(false)} onSaved={onRefresh} />
      <ClientInstructionDialog open={instructionOpen} matterId={matterId} workspace={active} onClose={() => setInstructionOpen(false)} onSaved={onRefresh} />
      <SettlementDialog open={settlementOpen} matterId={matterId} workspace={active} onClose={() => setSettlementOpen(false)} onSaved={onRefresh} />
    </section>
  );
}

function Empty({ title, text }: { title: string; text: string }) {
  return <div className="negotiation-empty"><Scale size={24} /><h4>{title}</h4><p>{text}</p></div>;
}
