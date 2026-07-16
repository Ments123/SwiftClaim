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

export function CommunicationComposeDialog({ open, matterId, onClose, onSaved, documents }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const channel = String(form.get('channel'));
    const endpointType = channel === 'email' ? 'email' : 'whatsapp';
    try {
      await request(`/api/matters/${matterId}/communication-drafts`, {
        method: 'POST',
        body: jsonBody({
          channel,
          confidentiality: String(form.get('confidentiality')),
          participants: [{
            role: 'to',
            displayName: String(form.get('displayName')),
            endpointType,
            endpoint: String(form.get('endpoint')),
            partyId: null,
            userId: null,
          }],
          subject: String(form.get('subject')),
          body: String(form.get('body')),
          bodyFormat: 'plain',
          attachmentVersionIds: form.getAll('attachmentVersionIds').map(String),
          conversationId: null,
        }),
      });
      onClose();
      await onSaved();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'The draft could not be saved.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Compose communication"
      description="Save a versioned draft. External dispatch is a separate confirmed action."
      onClose={onClose}
      size="wide"
    >
      <form className="form-grid" onSubmit={submit}>
        <label className="form-field">
          <span>Channel</span>
          <select name="channel" defaultValue="email">
            <option value="email">Email</option>
            <option value="whatsapp">WhatsApp message</option>
          </select>
        </label>
        <label className="form-field">
          <span>Confidentiality</span>
          <select name="confidentiality" defaultValue="ordinary">
            <option value="ordinary">Ordinary</option>
            <option value="privileged">Privileged</option>
            <option value="protected_negotiation">Protected negotiation</option>
          </select>
        </label>
        <label className="form-field">
          <span>Recipient name</span>
          <input name="displayName" required />
        </label>
        <label className="form-field">
          <span>Email or WhatsApp number</span>
          <input name="endpoint" required />
        </label>
        <label className="form-field form-field--wide">
          <span>Subject</span>
          <input name="subject" />
        </label>
        {documents.some(({ latestVersion }) => latestVersion) ? (
          <fieldset className="form-field form-field--wide communication-document-picker">
            <legend>Exact document-version attachments</legend>
            {documents.map((document) => document.latestVersion ? (
              <label key={document.latestVersion.id}>
                <input type="checkbox" name="attachmentVersionIds" value={document.latestVersion.id} />
                <span><strong>{document.title}</strong><small>v{document.latestVersion.version} · {document.latestVersion.originalName} · {document.latestVersion.sha256.slice(0, 10)}…</small></span>
              </label>
            ) : null)}
          </fieldset>
        ) : null}
        <label className="form-field form-field--wide">
          <span>Message</span>
          <textarea name="body" rows={8} required />
        </label>
        {error ? <div className="form-alert form-field--wide" role="alert">{error}</div> : null}
        <div className="form-actions form-field--wide">
          <button className="button button--secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="button button--primary" type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save versioned draft'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
