import { useState, type FormEvent } from 'react';

import { jsonBody, request } from '../../api.js';
import { Dialog } from '../Dialog.js';

interface NegotiationActionDialogProps {
  open: boolean;
  matterId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

function minor(value: FormDataEntryValue | null) {
  const amount = String(value ?? '').trim();
  return amount ? Math.round(Number(amount) * 100) : null;
}

export function NegotiationActionDialog({ open, matterId, onClose, onSaved }: NegotiationActionDialogProps) {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const totalMinor = minor(form.get('total'));
    try {
      await request(`/api/matters/${matterId}/negotiation-actions`, {
        method: 'POST',
        body: jsonBody({
          idempotencyKey: crypto.randomUUID(),
          actionType: form.get('actionType'),
          linkedOfferId: null,
          confidentiality: form.get('confidentiality'),
          recipients: [{
            displayName: form.get('recipientName'),
            endpointType: form.get('endpointType'),
            endpoint: form.get('endpoint'),
          }],
          scope: 'whole_claim',
          scopeDescription: form.get('scopeDescription'),
          damagesMinor: totalMinor,
          costsMinor: null,
          totalMinor,
          currency: 'GBP',
          worksTerms: form.get('worksTerms'),
          nonMoneyTerms: form.get('nonMoneyTerms'),
          interestTreatment: form.get('interestTreatment'),
          confidentialityTerms: form.get('confidentialityTerms'),
          paymentTerms: form.get('paymentTerms'),
          proposedInstrumentType: form.get('instrumentType'),
          documentVersionIds: [],
        }),
      });
      onClose();
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Action could not be prepared.');
    } finally {
      setSubmitting(false);
    }
  };

  return <Dialog open={open} title="Prepare an exact negotiation action" description="Preparation does not communicate the action. Exact instruction and approval remain required." onClose={onClose}><form className="form-grid" onSubmit={submit}><label className="form-field"><span>Action</span><select name="actionType" defaultValue="counteroffer"><option value="make_offer">Make offer</option><option value="counteroffer">Counteroffer</option><option value="accept">Accept</option><option value="reject">Reject</option><option value="withdraw">Withdraw</option><option value="clarify">Clarify</option><option value="record_agreement">Record agreement</option></select></label><label className="form-field"><span>Confidentiality</span><select name="confidentiality" defaultValue="protected_negotiation"><option value="ordinary">Ordinary</option><option value="privileged">Privileged</option><option value="protected_negotiation">Protected negotiation</option></select></label><label className="form-field"><span>Recipient</span><input name="recipientName" required /></label><label className="form-field"><span>Endpoint type</span><select name="endpointType" defaultValue="email"><option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="postal_address">Postal address</option><option value="portal">Portal</option><option value="other">Other</option></select></label><label className="form-field form-field--wide"><span>Recipient endpoint</span><input name="endpoint" required /></label><label className="form-field"><span>Total (£)</span><input name="total" type="number" min="0" step="0.01" /></label><label className="form-field"><span>Proposed instrument</span><select name="instrumentType" defaultValue="settlement_agreement"><option value="part36_acceptance">Part 36 acceptance</option><option value="consent_order">Consent order</option><option value="tomlin_order">Tomlin order</option><option value="settlement_agreement">Settlement agreement</option><option value="deed">Deed</option><option value="oral_recorded">Oral recorded</option><option value="other">Other</option></select></label><label className="form-field form-field--wide"><span>Scope</span><textarea name="scopeDescription" rows={2} required /></label><label className="form-field form-field--wide"><span>Works terms</span><textarea name="worksTerms" rows={2} /></label><label className="form-field form-field--wide"><span>Non-money terms</span><textarea name="nonMoneyTerms" rows={2} /></label><label className="form-field"><span>Interest treatment</span><input name="interestTreatment" /></label><label className="form-field"><span>Payment terms</span><input name="paymentTerms" /></label><label className="form-field form-field--wide"><span>Confidentiality terms</span><textarea name="confidentialityTerms" rows={2} /></label>{error ? <div className="form-alert form-field--wide" role="alert">{error}</div> : null}<div className="form-actions form-field--wide"><button className="button button--secondary" type="button" onClick={onClose}>Cancel</button><button className="button button--primary" type="submit" disabled={submitting}>{submitting ? 'Preparing…' : 'Prepare exact version'}</button></div></form></Dialog>;
}
