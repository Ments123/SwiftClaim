import { useState, type FormEvent } from 'react';

import { jsonBody, request } from '../../api.js';
import { Dialog } from '../Dialog.js';

interface ObligationEventDialogProps {
  open: boolean;
  matterId: string;
  obligationId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export function ObligationEventDialog({ open, matterId, obligationId, onClose, onSaved }: ObligationEventDialogProps) {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const eventType = String(form.get('eventType'));
    const evidenceDocumentVersionId = String(form.get('evidenceDocumentVersionId') ?? '').trim();
    const evidenceCommunicationEntryId = String(form.get('evidenceCommunicationEntryId') ?? '').trim();
    const waiverAuthorityDocumentVersionId = String(form.get('waiverAuthorityDocumentVersionId') ?? '').trim();
    try {
      await request(`/api/matters/${matterId}/settlement-obligations/${obligationId}/events`, {
        method: 'POST',
        body: jsonBody({
          idempotencyKey: crypto.randomUUID(),
          eventType,
          occurredAt: new Date(String(form.get('occurredAt'))).toISOString(),
          note: form.get('note'),
          amountSatisfiedMinor: null,
          evidenceDocumentVersionIds: evidenceDocumentVersionId ? [evidenceDocumentVersionId] : [],
          evidenceCommunicationEntryIds: evidenceCommunicationEntryId ? [evidenceCommunicationEntryId] : [],
          supersedesEventId: null,
          correctionReason: '',
          waiverAuthorityDocumentVersionId: waiverAuthorityDocumentVersionId || null,
          explicitConfirmation: true,
        }),
      });
      onClose();
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Obligation event could not be recorded.');
    } finally {
      setSubmitting(false);
    }
  };
  return <Dialog open={open} title="Record obligation evidence" description="An assertion does not satisfy an obligation. Satisfaction and waiver require retained evidence." onClose={onClose}><form className="form-grid" onSubmit={submit}><label className="form-field"><span>Event</span><select name="eventType" defaultValue="performance_asserted"><option value="due_confirmed">Due confirmed</option><option value="performance_asserted">Performance asserted</option><option value="part_satisfied">Part satisfied</option><option value="satisfied">Satisfied</option><option value="overdue_reviewed">Overdue reviewed</option><option value="disputed">Disputed</option><option value="waived">Waived</option></select></label><label className="form-field"><span>Occurred at</span><input name="occurredAt" type="datetime-local" required /></label><label className="form-field form-field--wide"><span>Factual note</span><textarea name="note" rows={3} required /></label><label className="form-field"><span>Evidence document version ID</span><input name="evidenceDocumentVersionId" /></label><label className="form-field"><span>Evidence communication entry ID</span><input name="evidenceCommunicationEntryId" /></label><label className="form-field form-field--wide"><span>Waiver authority document version ID</span><input name="waiverAuthorityDocumentVersionId" /></label>{error ? <div className="form-alert form-field--wide" role="alert">{error}</div> : null}<div className="form-actions form-field--wide"><button className="button button--secondary" type="button" onClick={onClose}>Cancel</button><button className="button button--primary" type="submit" disabled={submitting}>{submitting ? 'Recording…' : 'Record event'}</button></div></form></Dialog>;
}
