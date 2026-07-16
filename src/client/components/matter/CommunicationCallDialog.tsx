import { useState, type FormEvent } from 'react';

import { ApiError, jsonBody, request, type MatterDocument } from '../../api.js';
import { Dialog } from '../Dialog.js';

interface Props {
  open: boolean;
  matterId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  documents: MatterDocument[];
}

function localDateTime(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function CommunicationCallDialog({ open, matterId, onClose, onSaved, documents }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const ended = new Date();
  const started = new Date(ended.getTime() - 5 * 60_000);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const startedAt = new Date(String(form.get('startedAt'))).toISOString();
    const endedAt = new Date(String(form.get('endedAt'))).toISOString();
    const recordingStatus = String(form.get('recordingStatus'));
    const artifactVersionId = String(form.get('artifactVersionId') ?? '');
    const artifactPurpose = String(form.get('artifactPurpose') ?? 'call_note');
    const artifactIds = artifactVersionId ? [artifactVersionId] : [];
    try {
      await request(`/api/matters/${matterId}/communication-calls`, {
        method: 'POST',
        body: jsonBody({
          idempotencyKey: crypto.randomUUID(),
          channel: 'telephone',
          confidentiality: String(form.get('confidentiality')),
          direction: String(form.get('direction')),
          participants: [{
            role: String(form.get('direction')) === 'inbound' ? 'caller' : 'callee',
            displayName: String(form.get('displayName')),
            endpointType: 'phone',
            endpoint: String(form.get('endpoint')),
            partyId: null,
            userId: null,
          }],
          occurredAt: startedAt,
          subject: String(form.get('subject')),
          body: String(form.get('outcome')),
          startedAt,
          endedAt,
          purpose: String(form.get('purpose')),
          outcome: String(form.get('outcome')),
          identityCheckStatus: String(form.get('identityCheckStatus')),
          identityCheckNote: String(form.get('identityCheckNote')),
          recordingStatus,
          noticeConsentBasis: String(form.get('noticeConsentBasis')),
          attachmentVersionIds: [],
          recordingVersionIds: artifactPurpose === 'recording' ? artifactIds : [],
          transcriptVersionIds: artifactPurpose === 'transcript' ? artifactIds : [],
          callNoteVersionIds: artifactPurpose === 'call_note' ? artifactIds : [],
          providerKey: null,
          externalCallId: null,
        }),
      });
      onClose();
      await onSaved();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'The call record could not be saved.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Record a call"
      description="Capture facts, identity checks and recording notice. SwiftClaim does not infer consent or legal effect."
      onClose={onClose}
      size="wide"
    >
      <form className="form-grid" onSubmit={submit}>
        <label className="form-field"><span>Direction</span><select name="direction" defaultValue="outbound"><option value="outbound">Outbound</option><option value="inbound">Inbound</option></select></label>
        <label className="form-field"><span>Confidentiality</span><select name="confidentiality" defaultValue="ordinary"><option value="ordinary">Ordinary</option><option value="privileged">Privileged</option></select></label>
        <label className="form-field"><span>Participant</span><input name="displayName" required /></label>
        <label className="form-field"><span>Phone number</span><input name="endpoint" required /></label>
        <label className="form-field"><span>Started</span><input name="startedAt" type="datetime-local" defaultValue={localDateTime(started)} required /></label>
        <label className="form-field"><span>Ended</span><input name="endedAt" type="datetime-local" defaultValue={localDateTime(ended)} required /></label>
        <label className="form-field form-field--wide"><span>Subject</span><input name="subject" required /></label>
        <label className="form-field form-field--wide"><span>Purpose</span><textarea name="purpose" rows={2} required /></label>
        <label className="form-field form-field--wide"><span>Outcome / factual note</span><textarea name="outcome" rows={4} required /></label>
        <label className="form-field"><span>Identity check</span><select name="identityCheckStatus" defaultValue="confirmed"><option value="confirmed">Confirmed</option><option value="failed">Failed</option><option value="not_recorded">Not recorded</option></select></label>
        <label className="form-field"><span>Recording status</span><select name="recordingStatus" defaultValue="not_recorded"><option value="not_recorded">Not recorded</option><option value="notice_given">Notice given</option><option value="consent_recorded">Consent recorded</option><option value="recorded">Recorded</option><option value="unavailable">Unavailable</option></select></label>
        <label className="form-field form-field--wide"><span>Identity-check note</span><input name="identityCheckNote" /></label>
        <label className="form-field form-field--wide"><span>Notice / consent basis</span><textarea name="noticeConsentBasis" rows={2} /></label>
        {documents.some(({ latestVersion }) => latestVersion) ? <><label className="form-field"><span>Retained artifact</span><select name="artifactVersionId" defaultValue=""><option value="">No linked artifact</option>{documents.map((document) => document.latestVersion ? <option key={document.latestVersion.id} value={document.latestVersion.id}>{document.title} · v{document.latestVersion.version}</option> : null)}</select></label><label className="form-field"><span>Artifact purpose</span><select name="artifactPurpose" defaultValue="call_note"><option value="call_note">Call note</option><option value="recording">Recording</option><option value="transcript">Transcript</option></select></label></> : null}
        {error ? <div className="form-alert form-field--wide" role="alert">{error}</div> : null}
        <div className="form-actions form-field--wide"><button className="button button--secondary" type="button" onClick={onClose}>Cancel</button><button className="button button--primary" type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Record call'}</button></div>
      </form>
    </Dialog>
  );
}
