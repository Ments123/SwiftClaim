import { Building2, Mail, MapPin, Phone, UserRound } from 'lucide-react';
import type { FormEvent } from 'react';

import type { EnquiryDetail, TeamMember } from '../../api.js';

export function EnquiryOverview({
  enquiry,
  team,
  saving,
  onSave,
}: {
  enquiry: EnquiryDetail;
  team: TeamMember[];
  saving: boolean;
  onSave: (command: Record<string, unknown>) => Promise<void>;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    return void onSave({
      expectedVersion: enquiry.version,
      summary: form.get('summary'),
      defectSummary: form.get('defectSummary'),
      desiredOutcome: form.get('desiredOutcome'),
      urgency: form.get('urgency'),
      immediateSafetyConcerns: form.get('immediateSafetyConcerns'),
      communicationRequirements: form.get('communicationRequirements'),
      assignedUserId: form.get('assignedUserId'),
    });
  };

  const locked = ['declined', 'referred', 'duplicate', 'unable_to_contact', 'converted'].includes(
    enquiry.status,
  );

  return (
    <section className="surface intake-panel" aria-labelledby="enquiry-overview-title">
      <header className="intake-panel__header">
        <div><span className="eyebrow">Captured facts</span><h2 id="enquiry-overview-title">Enquiry</h2></div>
        <span className="intake-version">Record v{enquiry.version}</span>
      </header>
      <div className="intake-fact-grid">
        <article><UserRound size={17} /><span><small>Prospective client</small><strong>{enquiry.client.displayName}</strong><em>{enquiry.client.dateOfBirth ?? 'Date of birth not recorded'}</em></span></article>
        <article><Building2 size={17} /><span><small>Landlord</small><strong>{enquiry.landlord?.name ?? 'Not recorded'}</strong><em>{enquiry.property.propertyType}</em></span></article>
        <article><MapPin size={17} /><span><small>Property</small><strong>{enquiry.property.addressLine1}</strong><em>{enquiry.property.city}, {enquiry.property.postcode}</em></span></article>
        <article><Mail size={17} /><span><small>Preferred contact</small><strong>{enquiry.client.email || 'No email'}</strong><em><Phone size={12} /> {enquiry.client.phone || 'No phone'} · {enquiry.client.preferredChannel}</em></span></article>
      </div>
      <form className="form-grid intake-form" onSubmit={submit}>
        <label className="form-field form-field--wide"><span>Initial summary</span><textarea name="summary" rows={4} defaultValue={enquiry.summary} required disabled={locked} /></label>
        <label className="form-field form-field--wide"><span>Reported defects</span><textarea name="defectSummary" rows={4} defaultValue={enquiry.defectSummary} required disabled={locked} /></label>
        <label className="form-field form-field--wide"><span>Desired outcome</span><textarea name="desiredOutcome" rows={2} defaultValue={enquiry.desiredOutcome} disabled={locked} /></label>
        <label className="form-field"><span>Urgency</span><select name="urgency" defaultValue={enquiry.urgency} disabled={locked}><option value="routine">Routine</option><option value="priority">Priority</option><option value="urgent">Urgent</option><option value="critical">Critical</option></select></label>
        <label className="form-field"><span>Assigned to</span><select name="assignedUserId" defaultValue={enquiry.assignedTo.id} disabled={locked}>{team.map((member) => <option value={member.id} key={member.id}>{member.name} · {member.role}</option>)}</select></label>
        <label className="form-field form-field--wide"><span>Immediate safety concerns</span><textarea name="immediateSafetyConcerns" rows={2} defaultValue={enquiry.immediateSafetyConcerns} disabled={locked} /></label>
        <label className="form-field form-field--wide"><span>Communication requirements</span><textarea name="communicationRequirements" rows={2} defaultValue={enquiry.communicationRequirements} disabled={locked} /></label>
        {!locked ? <div className="form-actions form-field--wide"><button className="button button--primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save enquiry'}</button></div> : <p className="locked-note form-field--wide">This enquiry has a terminal outcome and is read-only.</p>}
      </form>
    </section>
  );
}
