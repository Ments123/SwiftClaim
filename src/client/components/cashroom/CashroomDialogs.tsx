import { useState, type FormEvent } from 'react';

import { ApiError, jsonBody, request, type CashroomWorkspace } from '../../api.js';
import { Dialog } from '../Dialog.js';

type Reconciliation = CashroomWorkspace['reconciliations'][number];

export function CashroomReconciliationDialog({ reconciliation, action, onClose, onSaved }: {
  reconciliation: Reconciliation | null;
  action: 'complete' | 'signoff' | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!reconciliation || !action) return;
    setSaving(true); setError('');
    try {
      const occurredAt = new Date().toISOString();
      await request(`/api/finance/cashroom/reconciliations/${reconciliation.id}/${action}`, {
        method: 'POST', body: jsonBody(action === 'complete' ? {
          expectedVersion: reconciliation.version,
          idempotencyKey: `cashroom-complete-${reconciliation.id}-${reconciliation.version}`,
          completedAt: occurredAt, explicitHumanConfirmation: true,
        } : {
          expectedVersion: reconciliation.version,
          idempotencyKey: `cashroom-signoff-${reconciliation.id}-${reconciliation.version}`,
          signedOffAt: occurredAt, note, explicitHumanApproval: true,
        }),
      });
      onSaved(); onClose();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'The reconciliation action could not be retained.');
    } finally { setSaving(false); }
  };
  return (
    <Dialog open={Boolean(reconciliation && action)} title={action === 'signoff' ? 'Independent reconciliation sign-off' : 'Complete reconciliation'} onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <p className="dialog-copy">This records a human-controlled accounting decision. It does not initiate a bank action.</p>
        {action === 'signoff' ? <label className="form-field">Sign-off note<textarea value={note} onChange={(event) => setNote(event.target.value)} minLength={10} required /></label> : null}
        {error ? <div className="inline-notice inline-notice--error" role="alert">{error}</div> : null}
        <div className="dialog-actions"><button className="button button--secondary" type="button" onClick={onClose}>Cancel</button><button className="button button--primary" type="submit" disabled={saving}>{saving ? 'Saving…' : action === 'signoff' ? 'Sign off reconciliation' : 'Complete reconciliation'}</button></div>
      </form>
    </Dialog>
  );
}
