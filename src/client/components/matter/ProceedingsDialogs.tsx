import { useState, type FormEvent } from 'react';

import { jsonBody, request } from '../../api.js';
import { Dialog } from '../Dialog.js';

interface CreateProceedingDialogProps {
  open: boolean; matterId: string; onClose: () => void;
  onSaved: () => Promise<void> | void;
}

export function CreateProceedingDialog({ open, matterId, onClose, onSaved }: CreateProceedingDialogProps) {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      await request(`/api/matters/${matterId}/proceedings`, {
        method: 'POST', body: jsonBody({
          idempotencyKey: crypto.randomUUID(), procedureType: form.get('procedureType'),
          jurisdiction: 'england_wales', courtName: form.get('courtName'),
          courtCode: String(form.get('courtCode') ?? '').trim() || null,
          hearingCentre: String(form.get('hearingCentre') ?? '').trim() || null,
        }),
      });
      onClose();
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The proceeding could not be created.');
    } finally { setSubmitting(false); }
  };
  return <Dialog open={open} title="Create governed proceeding" description="This creates the internal court workspace only. It does not file or issue a claim." onClose={onClose}>
    <form className="form-grid" onSubmit={submit}>
      <label className="form-field"><span>Procedure</span><select name="procedureType" defaultValue="part7"><option value="part7">CPR Part 7</option><option value="part8">CPR Part 8</option><option value="other">Other</option></select></label>
      <label className="form-field"><span>Court code</span><input name="courtCode" /></label>
      <label className="form-field form-field--wide"><span>Court name</span><input name="courtName" minLength={2} required /></label>
      <label className="form-field form-field--wide"><span>Hearing centre</span><input name="hearingCentre" /></label>
      <div className="form-alert form-field--wide">Creating this record does not mean the claim was submitted, accepted or issued.</div>
      {error ? <div className="form-alert form-field--wide" role="alert">{error}</div> : null}
      <div className="form-actions form-field--wide"><button className="button button--secondary" type="button" onClick={onClose}>Cancel</button><button className="button button--primary" type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create court workspace'}</button></div>
    </form>
  </Dialog>;
}
