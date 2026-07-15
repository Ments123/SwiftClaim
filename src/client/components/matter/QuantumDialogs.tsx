import { useState, type FormEvent } from 'react';

import { jsonBody, request } from '../../api.js';
import { Dialog } from '../Dialog.js';

interface Props {
  matterId: string;
  workItemId: string | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export function RepairEventDialog({ matterId, workItemId, onClose, onSaved }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!workItemId) return;
    setSubmitting(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      await request(`/api/matters/${matterId}/work-items/${workItemId}/events`, {
        method: 'POST',
        body: jsonBody({
          idempotencyKey: crypto.randomUUID(),
          eventType: String(form.get('eventType')),
          occurredAt: new Date(String(form.get('occurredAt'))).toISOString(),
          actorType: String(form.get('actorType')),
          note: String(form.get('note')),
          appointmentFrom: null,
          appointmentTo: null,
          evidenceItemIds: [],
          verifier: '',
          supersedesEventId: null,
          correctionReason: '',
        }),
      });
      onClose();
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The repair event could not be saved.');
    } finally {
      setSubmitting(false);
    }
  };
  return <Dialog open={Boolean(workItemId)} title="Record repair event" description="Record a factual event. Completion verification requires retained evidence and is handled through reviewed controls." onClose={onClose}><form className="form-grid" onSubmit={submit}><label className="form-field"><span>Event</span><select name="eventType" defaultValue="started"><option value="proposed">Proposed</option><option value="appointment_booked">Appointment booked</option><option value="access_offered">Access offered</option><option value="access_provided">Access provided</option><option value="access_refused">Access refused</option><option value="access_unavailable">Access unavailable</option><option value="started">Started</option><option value="paused">Paused</option><option value="completion_asserted">Completion asserted</option><option value="client_disputes_completion">Client disputes completion</option><option value="failed_inspection">Failed inspection</option></select></label><label className="form-field"><span>Actor</span><select name="actorType" defaultValue="contractor"><option value="client">Client</option><option value="landlord">Landlord</option><option value="contractor">Contractor</option><option value="expert">Expert</option><option value="solicitor">Solicitor</option><option value="other">Other</option></select></label><label className="form-field form-field--wide"><span>Occurred</span><input name="occurredAt" type="datetime-local" required /></label><label className="form-field form-field--wide"><span>Factual note</span><textarea name="note" minLength={5} maxLength={4000} rows={4} required /></label>{error ? <div className="form-alert form-field--wide" role="alert">{error}</div> : null}<div className="form-actions form-field--wide"><button className="button button--secondary" type="button" onClick={onClose}>Cancel</button><button className="button button--primary" type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Record event'}</button></div></form></Dialog>;
}
