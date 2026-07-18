import { useState, type FormEvent } from 'react';

import { jsonBody, request, type DisclosureReviewRecord, type DisclosureWorkspace } from '../../api.js';
import { Dialog } from '../Dialog.js';

export function DisclosureDialogs({ command, matterId, proceedingId, review, workspace, onClose, onSaved }: {
  command: string; matterId: string; proceedingId: string; review: DisclosureReviewRecord;
  workspace: DisclosureWorkspace; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const [kind, id] = command.split(':');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); setError(''); const form = new FormData(event.currentTarget);
    try {
      let path = ''; let body: Record<string, unknown> = { idempotencyKey: crypto.randomUUID() };
      if (kind === 'candidate') { path = `reviews/${review.id}/candidates`; body = { ...body, expectedVersion: review.version,
        documentVersionId: String(form.get('documentVersionId')), evidenceItemId: null,
        custodian: String(form.get('custodian') ?? ''), sourceNote: String(form.get('note')) }; }
      if (kind === 'decision') { const candidate = review.candidates.find((item) => item.id === id)!;
        path = `candidates/${id}/decisions`; body = { ...body, expectedVersion: candidate.version,
          decision: String(form.get('decision')), reason: String(form.get('note')), redactionRequired: false,
          reviewedAt: new Date().toISOString() }; }
      if (kind === 'privilege') { const candidate = review.candidates.find((item) => item.id === id)!;
        path = `candidates/${id}/privilege-reviews`; body = { ...body, expectedVersion: candidate.version,
          category: String(form.get('category')), outcome: String(form.get('outcome')), basis: String(form.get('note')),
          authorityDocumentVersionId: null, confirmExposure: false, reviewedAt: new Date().toISOString() }; }
      if (kind === 'list') { path = `reviews/${review.id}/lists`; body = { ...body, expectedVersion: review.version,
        title: String(form.get('title')), generatedAt: new Date().toISOString(), note: String(form.get('note')) }; }
      await request(`/api/matters/${matterId}/proceedings/${proceedingId}/disclosure/${path}`,
        { method: 'POST', body: jsonBody(body) }); onClose(); await onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Disclosure command failed.'); }
    finally { setSaving(false); }
  };
  const title = kind === 'candidate' ? 'Add exact disclosure candidate' : kind === 'decision' ? 'Record human disclosure decision'
    : kind === 'privilege' ? 'Record human privilege review' : 'Generate immutable list snapshot';
  return <Dialog open title={title} description="This command records a human-controlled disclosure fact and never relies on AI approval." onClose={onClose} size="wide">
    <form className="form-grid" onSubmit={submit}>
      {kind === 'candidate' ? <><label className="form-field form-field--wide"><span>Exact document version</span><select name="documentVersionId" required><option value="">Select retained version</option>{workspace.sources.documents.map((item) => <option value={item.id} key={item.id}>{item.title} · v{item.version}</option>)}</select></label><label className="form-field"><span>Custodian</span><input name="custodian" /></label></> : null}
      {kind === 'decision' ? <label className="form-field"><span>Human decision</span><select name="decision" defaultValue="review_required"><option value="review_required">Review required</option><option value="disclose">Disclose</option><option value="withhold_privilege">Withhold · privilege</option><option value="withhold_not_relevant">Withhold · not relevant</option><option value="withhold_other">Withhold · other</option><option value="duplicate_only">Duplicate only</option></select></label> : null}
      {kind === 'privilege' ? <><label className="form-field"><span>Category</span><select name="category" defaultValue="uncertain"><option value="uncertain">Uncertain</option><option value="legal_advice">Legal advice</option><option value="litigation">Litigation</option><option value="joint">Joint</option><option value="without_prejudice_or_protected">Protected negotiation</option><option value="other">Other</option><option value="none">None</option></select></label><label className="form-field"><span>Outcome</span><select name="outcome" defaultValue="further_review"><option value="further_review">Further review</option><option value="restricted">Restricted</option><option value="not_privileged">Not privileged</option></select></label></> : null}
      {kind === 'list' ? <label className="form-field form-field--wide"><span>Snapshot title</span><input name="title" minLength={3} required /></label> : null}
      <label className="form-field form-field--wide"><span>Human review note</span><textarea name="note" minLength={20} required /></label>
      {error ? <div role="alert" className="form-alert form-field--wide">{error}</div> : null}
      <div className="form-actions form-field--wide"><button type="button" className="button button--secondary" onClick={onClose}>Cancel</button><button type="submit" className="button button--primary" disabled={saving}>{saving ? 'Recording…' : 'Record governed fact'}</button></div>
    </form>
  </Dialog>;
}
