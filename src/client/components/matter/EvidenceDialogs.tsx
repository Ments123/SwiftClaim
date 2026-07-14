import { useState, type FormEvent } from 'react';

import { jsonBody, request, type EvidenceDefect, type EvidenceWorkspace } from '../../api.js';
import { Dialog } from '../Dialog.js';

interface DialogBaseProps {
  matterId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

function actions(submitting: boolean, onClose: () => void, label: string) {
  return <div className="form-actions form-field--wide"><button className="button button--secondary" type="button" onClick={onClose}>Cancel</button><button className="button button--primary" type="submit" disabled={submitting}>{submitting ? 'Saving…' : label}</button></div>;
}

function errorNotice(error: string) {
  return error ? <div className="form-alert form-field--wide" role="alert">{error}</div> : null;
}

export function DefectDialog({ matterId, open, onClose, onSaved, defect }: DialogBaseProps & { defect?: EvidenceDefect }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSubmitting(true); setError('');
    const form = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = {
      location: form.get('location'), category: form.get('category'), title: form.get('title'),
      description: form.get('description'), severity: form.get('severity'),
      firstObservedOn: form.get('firstObservedOn') || null,
      healthImpact: form.get('healthImpact') || '',
      hazardTags: String(form.get('hazardTags') ?? '').split(',').map((item) => item.trim()).filter(Boolean),
    };
    if (defect) Object.assign(payload, { expectedVersion: defect.version, status: form.get('status'), statusReason: form.get('statusReason') });
    try {
      await request(`/api/matters/${matterId}/defects${defect ? `/${defect.id}` : ''}`, { method: defect ? 'PATCH' : 'POST', body: jsonBody(payload) });
      onClose(); await onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The defect could not be saved.'); }
    finally { setSubmitting(false); }
  };
  return <Dialog open={open} title={defect ? 'Update defect' : 'Record a defect'} description="Record observed facts only; SwiftClaim does not determine liability or hazard classification." onClose={onClose} size="wide"><form className="form-grid" onSubmit={submit}>
    <label className="form-field"><span>Location</span><input name="location" required minLength={2} defaultValue={defect?.location} /></label>
    <label className="form-field"><span>Category</span><select name="category" defaultValue={defect?.category ?? 'damp_mould'}><option value="damp_mould">Damp & mould</option><option value="leak">Leak</option><option value="heating">Heating</option><option value="electrical">Electrical</option><option value="structural">Structural</option><option value="pest">Pest</option><option value="ventilation">Ventilation</option><option value="sanitation">Sanitation</option><option value="other">Other</option></select></label>
    <label className="form-field form-field--wide"><span>Title</span><input name="title" required minLength={3} defaultValue={defect?.title} /></label>
    <label className="form-field form-field--wide"><span>Description</span><textarea name="description" required minLength={10} rows={3} defaultValue={defect?.description} /></label>
    <label className="form-field"><span>Severity</span><select name="severity" defaultValue={defect?.severity ?? 'moderate'}><option value="low">Low</option><option value="moderate">Moderate</option><option value="serious">Serious</option><option value="critical">Critical</option></select></label>
    <label className="form-field"><span>First observed</span><input name="firstObservedOn" type="date" defaultValue={defect?.firstObservedOn ?? ''} /></label>
    <label className="form-field form-field--wide"><span>Health impact (reported)</span><textarea name="healthImpact" rows={2} defaultValue={defect?.healthImpact} /></label>
    <label className="form-field form-field--wide"><span>Descriptive tags (comma separated)</span><input name="hazardTags" defaultValue={defect?.hazardTags.join(', ')} /></label>
    {defect ? <><label className="form-field"><span>Status</span><select name="status" defaultValue={defect.status}><option value="open">Open</option><option value="monitoring">Monitoring</option><option value="repaired">Repaired</option><option value="disputed">Disputed</option><option value="superseded">Superseded</option></select></label><label className="form-field form-field--wide"><span>Status reason</span><textarea name="statusReason" required minLength={10} rows={2} /></label></> : null}
    {errorNotice(error)}{actions(submitting, onClose, defect ? 'Save update' : 'Record defect')}
  </form></Dialog>;
}

export function NoticeDialog({ matterId, open, onClose, onSaved }: DialogBaseProps) {
  const [submitting, setSubmitting] = useState(false); const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSubmitting(true); setError(''); const form = new FormData(event.currentTarget); const payload = { idempotencyKey: crypto.randomUUID(), occurredAt: new Date(String(form.get('occurredAt'))).toISOString(), channel: form.get('channel'), recipientType: form.get('recipientType'), recipientName: form.get('recipientName'), summary: form.get('summary'), proofStatus: form.get('proofStatus'), responseStatus: form.get('responseStatus'), responseSummary: form.get('responseSummary') || '', supersedesNoticeId: null }; try { await request(`/api/matters/${matterId}/notices`, { method: 'POST', body: jsonBody(payload) }); onClose(); await onSaved(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'The notice could not be saved.'); } finally { setSubmitting(false); } };
  return <Dialog open={open} title="Record notice or complaint" onClose={onClose} size="wide"><form className="form-grid" onSubmit={submit}><label className="form-field"><span>Occurred at</span><input name="occurredAt" type="datetime-local" required /></label><label className="form-field"><span>Channel</span><select name="channel"><option value="email">Email</option><option value="phone">Phone</option><option value="whatsapp">WhatsApp</option><option value="letter">Letter</option><option value="portal">Portal</option><option value="in_person">In person</option><option value="other">Other</option></select></label><label className="form-field"><span>Recipient type</span><select name="recipientType"><option value="landlord">Landlord</option><option value="managing_agent">Managing agent</option><option value="contractor">Contractor</option><option value="local_authority">Local authority</option><option value="other">Other</option></select></label><label className="form-field"><span>Recipient name</span><input name="recipientName" required /></label><label className="form-field form-field--wide"><span>Summary</span><textarea name="summary" required minLength={10} /></label><label className="form-field"><span>Proof status</span><select name="proofStatus"><option value="linked">Linked</option><option value="client_recollection">Client recollection</option><option value="unavailable">Unavailable</option><option value="unknown">Unknown</option></select></label><label className="form-field"><span>Response status</span><select name="responseStatus"><option value="none">None</option><option value="acknowledged">Acknowledged</option><option value="inspection_arranged">Inspection arranged</option><option value="repair_promised">Repair promised</option><option value="repair_attempted">Repair attempted</option><option value="repaired">Repaired</option><option value="disputed">Disputed</option><option value="other">Other</option></select></label><label className="form-field form-field--wide"><span>Response summary</span><textarea name="responseSummary" /></label>{errorNotice(error)}{actions(submitting, onClose, 'Record notice')}</form></Dialog>;
}

export function AccessDialog({ matterId, open, onClose, onSaved }: DialogBaseProps) {
  const [submitting, setSubmitting] = useState(false); const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSubmitting(true); setError(''); const form = new FormData(event.currentTarget); const appointment = form.get('appointmentAt'); const payload = { idempotencyKey: crypto.randomUUID(), eventType: form.get('eventType'), appointmentAt: appointment ? new Date(String(appointment)).toISOString() : null, notes: form.get('notes'), supersedesAccessEventId: null }; try { await request(`/api/matters/${matterId}/access-events`, { method: 'POST', body: jsonBody(payload) }); onClose(); await onSaved(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'The access event could not be saved.'); } finally { setSubmitting(false); } };
  return <Dialog open={open} title="Record access event" onClose={onClose}><form className="form-grid" onSubmit={submit}><label className="form-field"><span>Event</span><select name="eventType"><option value="offered">Offered</option><option value="scheduled">Scheduled</option><option value="attempted">Attempted</option><option value="completed">Completed</option><option value="refused_by_landlord">Refused by landlord</option><option value="refused_by_client">Refused by client</option><option value="no_access">No access</option><option value="cancelled">Cancelled</option></select></label><label className="form-field"><span>Appointment</span><input name="appointmentAt" type="datetime-local" /></label><label className="form-field form-field--wide"><span>Notes</span><textarea name="notes" required minLength={5} /></label>{errorNotice(error)}{actions(submitting, onClose, 'Record access')}</form></Dialog>;
}

export function EvidenceItemDialog({ matterId, open, onClose, onSaved, workspace }: DialogBaseProps & { workspace: EvidenceWorkspace }) {
  const [submitting, setSubmitting] = useState(false); const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSubmitting(true); setError(''); const form = new FormData(event.currentTarget); const payload = { idempotencyKey: crypto.randomUUID(), kind: form.get('kind'), title: form.get('title'), description: form.get('description'), occurredOn: form.get('occurredOn') || null, provenanceSource: form.get('provenanceSource'), provenanceDetail: form.get('provenanceDetail'), documentVersionId: form.get('documentVersionId'), defectIds: form.getAll('defectIds'), noticeIds: form.getAll('noticeIds'), accessEventIds: form.getAll('accessEventIds') }; try { await request(`/api/matters/${matterId}/evidence-items`, { method: 'POST', body: jsonBody(payload) }); onClose(); await onSaved(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'The evidence item could not be linked.'); } finally { setSubmitting(false); } };
  return <Dialog open={open} title="Link preserved evidence" description="Choose one exact immutable document version and at least one fact." onClose={onClose} size="wide"><form className="form-grid" onSubmit={submit}><label className="form-field form-field--wide"><span>Document version</span><select name="documentVersionId" required>{workspace.availableDocumentVersions.map((version) => <option value={version.id} key={version.id}>{version.documentTitle} · v{version.version} · {version.originalName}</option>)}</select></label><label className="form-field"><span>Kind</span><select name="kind"><option value="photograph">Photograph</option><option value="video">Video</option><option value="correspondence">Correspondence</option><option value="repair_record">Repair record</option><option value="tenancy_record">Tenancy record</option><option value="medical_link">Medical link</option><option value="client_statement">Client statement</option><option value="other">Other</option></select></label><label className="form-field"><span>Occurred on</span><input name="occurredOn" type="date" /></label><label className="form-field form-field--wide"><span>Title</span><input name="title" required minLength={3} /></label><label className="form-field form-field--wide"><span>Description</span><textarea name="description" required minLength={5} /></label><label className="form-field"><span>Provenance source</span><select name="provenanceSource"><option value="client">Client</option><option value="solicitor">Solicitor</option><option value="landlord">Landlord</option><option value="managing_agent">Managing agent</option><option value="contractor">Contractor</option><option value="expert">Expert</option><option value="medical_provider">Medical provider</option><option value="third_party">Third party</option><option value="other">Other</option></select></label><label className="form-field form-field--wide"><span>Provenance detail</span><textarea name="provenanceDetail" required minLength={5} /></label><fieldset className="evidence-targets form-field--wide"><legend>Link to investigation facts</legend>{workspace.defects.map((item) => <label key={item.id}><input type="checkbox" name="defectIds" value={item.id} /> {item.location}: {item.title}</label>)}{workspace.notices.map((item) => <label key={item.id}><input type="checkbox" name="noticeIds" value={item.id} /> Notice: {item.summary}</label>)}{workspace.accessEvents.map((item) => <label key={item.id}><input type="checkbox" name="accessEventIds" value={item.id} /> Access: {item.notes}</label>)}</fieldset>{errorNotice(error)}{actions(submitting, onClose, 'Link evidence')}</form></Dialog>;
}
