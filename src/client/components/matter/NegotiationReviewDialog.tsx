import { useState, type FormEvent } from 'react';

import { jsonBody, request } from '../../api.js';
import { Dialog } from '../Dialog.js';

interface NegotiationReviewDialogProps {
  open: boolean;
  matterId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export function NegotiationReviewDialog({ open, matterId, onClose, onSaved }: NegotiationReviewDialogProps) {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      await request(`/api/matters/${matterId}/negotiation-reviews`, {
        method: 'POST',
        body: jsonBody({
          idempotencyKey: crypto.randomUUID(),
          confidentiality: form.get('confidentiality'),
          reviewedOn: form.get('reviewedOn'),
          reviewerUserId: null,
          selectedOfferIds: [],
          lossScheduleId: null,
          generalDamagesReviewId: null,
          workScheduleId: null,
          confirmedFacts: form.get('confirmedFacts'),
          optionsExplained: form.get('optionsExplained'),
          riskAnalysis: form.get('riskAnalysis'),
          costsFundingExplanation: form.get('costsFundingExplanation'),
          humanRecommendation: form.get('humanRecommendation'),
          adviceLimitations: form.get('adviceLimitations'),
          clientQuestions: form.get('clientQuestions'),
          supersedesReviewId: null,
          correctionReason: '',
        }),
      });
      onClose();
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Advice review could not be recorded.');
    } finally {
      setSubmitting(false);
    }
  };

  return <Dialog open={open} title="Record negotiation advice" description="Retain a human-authored review. SwiftClaim does not recommend an outcome." onClose={onClose}><form className="form-grid" onSubmit={submit}><label className="form-field"><span>Confidentiality</span><select name="confidentiality" defaultValue="privileged"><option value="ordinary">Ordinary</option><option value="privileged">Privileged</option><option value="protected_negotiation">Protected negotiation</option></select></label><label className="form-field"><span>Reviewed on</span><input name="reviewedOn" type="date" defaultValue="2026-08-20" required /></label><label className="form-field form-field--wide"><span>Confirmed source facts</span><textarea name="confirmedFacts" rows={3} required /></label><label className="form-field form-field--wide"><span>Options explained</span><textarea name="optionsExplained" rows={3} required /></label><label className="form-field form-field--wide"><span>Human risk analysis</span><textarea name="riskAnalysis" rows={4} required /></label><label className="form-field form-field--wide"><span>Costs and funding consequences</span><textarea name="costsFundingExplanation" rows={3} required /></label><label className="form-field form-field--wide"><span>Human recommendation</span><textarea name="humanRecommendation" rows={3} /></label><label className="form-field form-field--wide"><span>Advice limitations</span><textarea name="adviceLimitations" rows={3} required /></label><label className="form-field form-field--wide"><span>Client questions</span><textarea name="clientQuestions" rows={2} /></label>{error ? <div className="form-alert form-field--wide" role="alert">{error}</div> : null}<div className="form-actions form-field--wide"><button className="button button--secondary" type="button" onClick={onClose}>Cancel</button><button className="button button--primary" type="submit" disabled={submitting}>{submitting ? 'Recording…' : 'Record immutable review'}</button></div></form></Dialog>;
}
