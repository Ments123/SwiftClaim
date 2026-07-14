import { AlertTriangle, Scale, Sparkles } from 'lucide-react';
import type { FormEvent } from 'react';

import type { EnquiryDetail, IntakeAssessment, IntakeReadiness } from '../../api.js';

const LEGAL_ISSUES = [
  ['section_11', 'Landlord and Tenant Act 1985, s.11'],
  ['fitness', 'Fitness for human habitation'],
  ['statutory', 'Statutory duty'],
  ['contractual', 'Contractual duty'],
] as const;

const ESCALATIONS = [
  ['personal_injury', 'Personal injury'],
  ['possession', 'Possession action'],
  ['homelessness', 'Homelessness risk'],
  ['safeguarding', 'Safeguarding'],
  ['urgent_injunction', 'Urgent injunction'],
  ['critical_hazard', 'Critical hazard'],
] as const;

export function AssessmentPanel({
  enquiry,
  assessment,
  readiness,
  saving,
  onSave,
}: {
  enquiry: EnquiryDetail;
  assessment: IntakeAssessment | null;
  readiness: IntakeReadiness['assessment'];
  saving: boolean;
  onSave: (command: Record<string, unknown>) => Promise<void>;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void onSave({
      expectedVersion: enquiry.version,
      jurisdictionConfirmed: form.get('jurisdictionConfirmed') === 'on',
      claimantRelationship: form.get('claimantRelationship'),
      noticeSummary: form.get('noticeSummary'),
      conditionsUnresolved: form.get('conditionsUnresolved') === 'on',
      conditionStartDate: form.get('conditionStartDate') || null,
      accessSummary: form.get('accessSummary'),
      evidenceSummary: form.get('evidenceSummary'),
      limitationReview: form.get('limitationReview'),
      legalIssues: form.getAll('legalIssues'),
      escalations: form.getAll('escalations'),
      meritsRating: form.get('meritsRating'),
      proportionalityRating: form.get('proportionalityRating'),
      decision: form.get('decision'),
      decisionReason: form.get('decisionReason'),
    });
  };
  const locked = ['declined', 'referred', 'duplicate', 'unable_to_contact', 'converted'].includes(
    enquiry.status,
  );

  return (
    <section className="surface intake-panel" aria-labelledby="assessment-title">
      <header className="intake-panel__header">
        <div><span className="eyebrow">Legal gatekeeper</span><h2 id="assessment-title">Assessment</h2></div>
        <span className={readiness.ready ? 'readiness-chip readiness-chip--ready' : 'readiness-chip'}><Scale size={14} /> {readiness.ready ? 'Ready for acceptance' : `${readiness.blockers.length} blockers`}</span>
      </header>
      <div className="ai-draft-note"><Sparkles size={18} /><span><strong>AI assistance stays draft-only</strong><small>Future evidence extraction can propose text here. The reviewing solicitor remains responsible for the legal decision.</small></span></div>
      {readiness.blockers.length ? <ul className="blocker-list">{readiness.blockers.map((blocker) => <li key={blocker.key}><AlertTriangle size={15} /><span>{blocker.label}</span></li>)}</ul> : null}
      <form className="form-grid intake-form" onSubmit={submit}>
        <label className="check-field form-field--wide"><input name="jurisdictionConfirmed" type="checkbox" defaultChecked={assessment?.jurisdictionConfirmed ?? false} disabled={locked} /><span><strong>England jurisdiction confirmed</strong><small>Confirm the property and intended claim are within the approved scope.</small></span></label>
        <label className="form-field"><span>Claimant relationship</span><select name="claimantRelationship" defaultValue={assessment?.claimantRelationship ?? 'tenant'} disabled={locked}><option value="tenant">Tenant</option><option value="former_tenant">Former tenant</option><option value="leaseholder">Leaseholder</option><option value="other">Other</option></select></label>
        <label className="form-field"><span>Condition start date</span><input name="conditionStartDate" type="date" defaultValue={assessment?.conditionStartDate ?? ''} disabled={locked} /></label>
        <label className="form-field form-field--wide"><span>Notice history</span><textarea name="noticeSummary" rows={3} defaultValue={assessment?.noticeSummary ?? ''} required minLength={10} disabled={locked} /></label>
        <label className="check-field form-field--wide"><input name="conditionsUnresolved" type="checkbox" defaultChecked={assessment?.conditionsUnresolved ?? true} disabled={locked} /><span>Reported conditions remain unresolved</span></label>
        <label className="form-field form-field--wide"><span>Access history</span><textarea name="accessSummary" rows={2} defaultValue={assessment?.accessSummary ?? ''} disabled={locked} /></label>
        <label className="form-field form-field--wide"><span>Available evidence</span><textarea name="evidenceSummary" rows={3} defaultValue={assessment?.evidenceSummary ?? ''} disabled={locked} /></label>
        <label className="form-field form-field--wide"><span>Limitation review</span><textarea name="limitationReview" rows={2} defaultValue={assessment?.limitationReview ?? ''} required minLength={10} disabled={locked} /></label>
        <fieldset className="choice-fieldset form-field--wide"><legend>Legal issues</legend><div className="choice-grid">{LEGAL_ISSUES.map(([value, label]) => <label key={value}><input type="checkbox" name="legalIssues" value={value} defaultChecked={assessment?.legalIssues.includes(value) ?? false} disabled={locked} /><span>{label}</span></label>)}</div></fieldset>
        <fieldset className="choice-fieldset form-field--wide"><legend>Supervisor escalations</legend><div className="choice-grid">{ESCALATIONS.map(([value, label]) => <label key={value}><input type="checkbox" name="escalations" value={value} defaultChecked={assessment?.escalations.includes(value) ?? false} disabled={locked} /><span>{label}</span></label>)}</div></fieldset>
        <label className="form-field"><span>Merits</span><select name="meritsRating" defaultValue={assessment?.meritsRating ?? 'borderline'} disabled={locked}><option value="weak">Weak</option><option value="borderline">Borderline</option><option value="reasonable">Reasonable</option><option value="strong">Strong</option></select></label>
        <label className="form-field"><span>Proportionality</span><select name="proportionalityRating" defaultValue={assessment?.proportionalityRating ?? 'borderline'} disabled={locked}><option value="poor">Poor</option><option value="borderline">Borderline</option><option value="reasonable">Reasonable</option><option value="strong">Strong</option></select></label>
        <label className="form-field"><span>Assessment decision</span><select name="decision" defaultValue={assessment?.decision ?? 'draft'} disabled={locked}><option value="draft">Draft</option><option value="proceed">Proceed</option><option value="decline">Decline</option><option value="refer">Refer</option></select></label>
        <label className="form-field form-field--wide"><span>Decision reason</span><textarea name="decisionReason" rows={3} defaultValue={assessment?.decisionReason ?? ''} required minLength={10} disabled={locked} /></label>
        {!locked ? <div className="form-actions form-field--wide"><button className="button button--primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save legal assessment'}</button></div> : null}
      </form>
    </section>
  );
}
