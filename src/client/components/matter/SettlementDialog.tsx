import { useState, type FormEvent } from 'react';

import { jsonBody, request, type NegotiationWorkspace } from '../../api.js';
import { Dialog } from '../Dialog.js';

interface SettlementDialogProps {
  open: boolean;
  matterId: string;
  workspace: NegotiationWorkspace;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export function SettlementDialog({ open, matterId, workspace, onClose, onSaved }: SettlementDialogProps) {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      await request(`/api/matters/${matterId}/settlements`, {
        method: 'POST',
        body: jsonBody({
          idempotencyKey: crypto.randomUUID(),
          settlementType: form.get('settlementType'),
          scope: form.get('scope'),
          confidentiality: form.get('confidentiality'),
          originatingActionId: form.get('originatingActionId') || null,
          linkedOfferId: null,
          clientInstructionId: form.get('clientInstructionId'),
          title: form.get('title'),
        }),
      });
      onClose();
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Settlement record could not be created.');
    } finally {
      setSubmitting(false);
    }
  };
  return <Dialog open={open} title="Create settlement record" description="This records a governed settlement workspace. It does not determine that terms are valid, binding or concluded." onClose={onClose}><form className="form-grid" onSubmit={submit}><label className="form-field form-field--wide"><span>Title</span><input name="title" required /></label><label className="form-field"><span>Type</span><select name="settlementType" defaultValue="settlement_agreement"><option value="part36_acceptance">Part 36 acceptance</option><option value="consent_order">Consent order</option><option value="tomlin_order">Tomlin order</option><option value="settlement_agreement">Settlement agreement</option><option value="deed">Deed</option><option value="oral_recorded">Oral recorded</option><option value="other">Other</option></select></label><label className="form-field"><span>Scope</span><select name="scope" defaultValue="whole_claim"><option value="whole_claim">Whole claim</option><option value="part_of_claim">Part of claim</option><option value="issue">Issue</option><option value="costs_only">Costs only</option><option value="works_only">Works only</option></select></label><label className="form-field"><span>Confidentiality</span><select name="confidentiality" defaultValue="privileged"><option value="ordinary">Ordinary</option><option value="privileged">Privileged</option><option value="protected_negotiation">Protected negotiation</option></select></label><label className="form-field"><span>Originating action</span><select name="originatingActionId" defaultValue=""><option value="">No originating action</option>{workspace.actions.map((action) => <option key={action.id} value={action.id}>{action.actionReference}</option>)}</select></label><label className="form-field form-field--wide"><span>Initial client instruction</span><select name="clientInstructionId" required defaultValue=""><option value="" disabled>Select retained instruction</option>{workspace.instructions.map((instruction) => <option key={instruction.id} value={instruction.id}>{instruction.instructingPerson} · {instruction.instructionType}</option>)}</select></label>{error ? <div className="form-alert form-field--wide" role="alert">{error}</div> : null}<div className="form-actions form-field--wide"><button className="button button--secondary" type="button" onClick={onClose}>Cancel</button><button className="button button--primary" type="submit" disabled={submitting || !workspace.instructions.length}>{submitting ? 'Creating…' : 'Create settlement record'}</button></div></form></Dialog>;
}
