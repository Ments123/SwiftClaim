import { AlertTriangle, ArrowRight, CheckCircle2, Gavel, LockKeyhole } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import type { CurrentUser, EnquiryDetail, IntakeReadiness } from '../../api.js';

export function DecisionPanel({
  enquiry,
  readiness,
  user,
  busy,
  onDecide,
  onConvert,
}: {
  enquiry: EnquiryDetail;
  readiness: IntakeReadiness;
  user: CurrentUser;
  busy: boolean;
  onDecide: (command: Record<string, unknown>) => Promise<void>;
  onConvert: () => Promise<void>;
}) {
  const [outcome, setOutcome] = useState('accepted');
  const terminal = ['declined', 'referred', 'duplicate', 'unable_to_contact', 'converted'].includes(
    enquiry.status,
  );
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void onDecide({
      expectedVersion: enquiry.version,
      outcome,
      reason: form.get('reason'),
    });
  };

  return (
    <section className="surface intake-panel" aria-labelledby="decision-title">
      <header className="intake-panel__header">
        <div><span className="eyebrow">Authorised outcome</span><h2 id="decision-title">Decision</h2></div>
        <span className={`intake-status intake-status--${enquiry.status}`}>{enquiry.status.replaceAll('_', ' ')}</span>
      </header>
      <div className="decision-readiness-grid">
        <ReadinessCard title="Legal assessment" readiness={readiness.assessment} />
        <ReadinessCard title="Matter conversion" readiness={readiness.conversion} />
      </div>
      {!terminal && enquiry.status !== 'accepted' && user.permissions.canDecideIntake ? (
        <form className="form-grid intake-form decision-form" onSubmit={submit}>
          <label className="form-field"><span>Outcome</span><select aria-label="Outcome" value={outcome} onChange={(event) => setOutcome(event.target.value)}><option value="accepted">Accept</option><option value="declined">Decline</option><option value="referred">Refer</option><option value="duplicate">Duplicate</option><option value="unable_to_contact">Unable to contact</option></select></label>
          <label className="form-field form-field--wide"><span>Decision reason</span><textarea aria-label="Decision reason" name="reason" rows={3} minLength={10} required placeholder="Record the reviewed facts and approved criteria supporting this outcome." /></label>
          {outcome === 'accepted' && !readiness.assessment.ready ? <div className="inline-notice inline-notice--warning form-field--wide"><AlertTriangle size={17} /><span>Acceptance will remain blocked until every server-listed legal assessment control is resolved.</span></div> : null}
          <div className="form-actions form-field--wide"><button className="button button--primary" type="submit" disabled={busy || (outcome === 'accepted' && !readiness.assessment.ready)}><Gavel size={16} /> {busy ? 'Recording…' : 'Record decision'}</button></div>
        </form>
      ) : null}
      {!terminal ? (
        <div className="conversion-card">
          <div><span className="conversion-card__icon"><ArrowRight size={20} /></span><span><strong>Open the governed matter</strong><p>Conversion is atomic and starts the Housing Conditions workflow at Evidence and notice. It cannot create a partial matter.</p></span></div>
          <button className="button button--primary" type="button" disabled={busy || enquiry.status !== 'accepted' || !readiness.conversion.ready || !user.permissions.canConvertIntake} onClick={() => void onConvert()}>{busy ? 'Converting…' : 'Convert to matter'}</button>
        </div>
      ) : null}
      {terminal ? <div className="locked-note"><LockKeyhole size={17} /><span>{enquiry.status === 'converted' ? 'This enquiry has been converted and its matter is the canonical working file.' : 'This terminal outcome is preserved in immutable status history.'}</span></div> : null}
    </section>
  );
}

function ReadinessCard({
  title,
  readiness,
}: {
  title: string;
  readiness: IntakeReadiness['assessment'];
}) {
  return (
    <article className={readiness.ready ? 'readiness-card readiness-card--ready' : 'readiness-card'}>
      <header>{readiness.ready ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}<span><strong>{title}</strong><small>{readiness.ready ? 'Ready' : `${readiness.blockers.length} blockers`}</small></span></header>
      {readiness.blockers.length ? <ul>{readiness.blockers.map((blocker) => <li key={blocker.key}>{blocker.label}</li>)}</ul> : <p>All required controls are complete.</p>}
    </article>
  );
}
