import { useState, type FormEvent } from 'react';

import { jsonBody, request, type NegotiationWorkspace } from '../../api.js';
import { Dialog } from '../Dialog.js';

interface ClientInstructionDialogProps {
  open: boolean;
  matterId: string;
  workspace: NegotiationWorkspace;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export function ClientInstructionDialog({ open, matterId, workspace, onClose, onSaved }: ClientInstructionDialogProps) {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const targets = [
    ...workspace.actions.map((action) => ({
      value: `action:${action.id}`,
      label: `${action.actionReference} · action v${action.currentVersion.version}`,
    })),
    ...workspace.settlements.filter(({ currentTerms }) => currentTerms).map((settlement) => ({
      value: `settlement:${settlement.id}`,
      label: `${settlement.settlementReference} · terms v${settlement.currentTerms?.version}`,
    })),
  ];

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const target = String(form.get('target'));
    const [kind, id] = target.split(':');
    const action = kind === 'action' ? workspace.actions.find((item) => item.id === id) : undefined;
    const settlement = kind === 'settlement' ? workspace.settlements.find((item) => item.id === id) : undefined;
    try {
      await request(`/api/matters/${matterId}/client-instructions`, {
        method: 'POST',
        body: jsonBody({
          idempotencyKey: crypto.randomUUID(),
          confidentiality: form.get('confidentiality'),
          reviewId: null,
          actionId: action?.id ?? null,
          actionVersionId: action?.currentVersion.id ?? null,
          settlementId: settlement?.id,
          settlementTermsVersionId: settlement?.currentTerms?.id,
          instructionType: form.get('instructionType'),
          instructingPerson: form.get('instructingPerson'),
          relationshipToClient: form.get('relationshipToClient'),
          authorityBasis: form.get('authorityBasis'),
          decisionNote: form.get('decisionNote'),
          receivedMethod: form.get('receivedMethod'),
          receivedAt: new Date(String(form.get('receivedAt'))).toISOString(),
          identityStatus: form.get('identityStatus'),
          identityNote: form.get('identityNote'),
          understandingConfirmed: true,
          accessibilityMeasures: form.get('accessibilityMeasures'),
          sourceCommunicationEntryId: form.get('sourceCommunicationEntryId') || null,
          sourceDocumentVersionId: form.get('sourceDocumentVersionId') || null,
          supersedesInstructionId: null,
          correctionReason: '',
          explicitClientInstruction: true,
        }),
      });
      onClose();
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Client instruction could not be recorded.');
    } finally {
      setSubmitting(false);
    }
  };

  return <Dialog open={open} title="Record exact client instruction" description="Record what the client decided, how identity and understanding were checked, and retain the evidential source." onClose={onClose}><form className="form-grid" onSubmit={submit}><label className="form-field form-field--wide"><span>Exact target</span><select name="target" required defaultValue=""><option value="" disabled>Select an action or settlement terms version</option>{targets.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}</select></label><label className="form-field"><span>Instruction</span><select name="instructionType" defaultValue="counter"><option value="accept">Accept</option><option value="reject">Reject</option><option value="counter">Counter</option><option value="clarify">Clarify</option><option value="continue_negotiation">Continue negotiation</option><option value="issue_proceedings">Issue proceedings</option><option value="agree_terms">Agree terms</option><option value="other">Other</option></select></label><label className="form-field"><span>Confidentiality</span><select name="confidentiality" defaultValue="privileged"><option value="ordinary">Ordinary</option><option value="privileged">Privileged</option><option value="protected_negotiation">Protected negotiation</option></select></label><label className="form-field"><span>Instructing person</span><input name="instructingPerson" required /></label><label className="form-field"><span>Relationship to client</span><input name="relationshipToClient" defaultValue="self" required /></label><label className="form-field form-field--wide"><span>Authority basis</span><textarea name="authorityBasis" rows={2} required /></label><label className="form-field form-field--wide"><span>Exact decision</span><textarea name="decisionNote" rows={3} required /></label><label className="form-field"><span>Method</span><select name="receivedMethod" defaultValue="telephone"><option value="in_person">In person</option><option value="telephone">Telephone</option><option value="video">Video</option><option value="email">Email</option><option value="letter">Letter</option><option value="portal">Portal</option><option value="other">Other</option></select></label><label className="form-field"><span>Received at</span><input name="receivedAt" type="datetime-local" required /></label><label className="form-field"><span>Identity status</span><select name="identityStatus" defaultValue="confirmed"><option value="confirmed">Confirmed</option><option value="failed">Failed</option><option value="not_required_reviewed">Not required, reviewed</option></select></label><label className="form-field"><span>Identity note</span><input name="identityNote" required /></label><label className="form-field form-field--wide"><span>Accessibility and understanding checks</span><textarea name="accessibilityMeasures" rows={2} required /></label><label className="form-field"><span>Source communication entry ID</span><input name="sourceCommunicationEntryId" /></label><label className="form-field"><span>Source document version ID</span><input name="sourceDocumentVersionId" /></label>{error ? <div className="form-alert form-field--wide" role="alert">{error}</div> : null}<div className="form-actions form-field--wide"><button className="button button--secondary" type="button" onClick={onClose}>Cancel</button><button className="button button--primary" type="submit" disabled={submitting || !targets.length}>{submitting ? 'Recording…' : 'Record instruction'}</button></div></form></Dialog>;
}
