import { useState, type FormEvent, type ReactNode } from 'react';

import { jsonBody, request, type PleadingResponseTrack, type PleadingsWorkspace } from '../../api.js';
import { Dialog } from '../Dialog.js';

interface Props {
  open: boolean; matterId: string; proceedingId: string;
  track: PleadingResponseTrack; workspace: PleadingsWorkspace;
  onClose: () => void; onSaved: () => Promise<void> | void;
}

const key = () => crypto.randomUUID();
const value = (form: FormData, name: string) => String(form.get(name) ?? '').trim();
const nullable = (form: FormData, name: string) => value(form, name) || null;
const iso = (form: FormData, name: string) => new Date(value(form, name)).toISOString();

function Command({ open, title, description, path, submitLabel, onClose, onSaved, build, children }: {
  open: boolean; title: string; description: string; path: string; submitLabel: string;
  onClose: () => void; onSaved: () => Promise<void> | void;
  build: (form: FormData) => unknown; children: ReactNode;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSubmitting(true); setError('');
    try {
      await request(path, { method: 'POST', body: jsonBody(build(new FormData(event.currentTarget))) });
      onClose(); await onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The command could not be recorded.'); }
    finally { setSubmitting(false); }
  };
  return <Dialog open={open} title={title} description={description} onClose={onClose} size="wide">
    <form className="form-grid" onSubmit={submit}>{children}
      {error ? <div className="form-alert form-field--wide" role="alert">{error}</div> : null}
      <div className="form-actions form-field--wide"><button className="button button--secondary" type="button" onClick={onClose}>Cancel</button><button className="button button--primary" type="submit" disabled={submitting}>{submitting ? 'Recording…' : submitLabel}</button></div>
    </form>
  </Dialog>;
}

function Documents({ workspace, name, label }: { workspace: PleadingsWorkspace; name: string; label: string }) {
  return <label className="form-field form-field--wide"><span>{label}</span><select name={name} defaultValue="" required><option value="">Select exact retained version</option>{workspace.sources.documents.map((document) => <option key={document.id} value={document.id}>{document.title} · v{document.version} · {document.originalName}</option>)}</select></label>;
}

export function StatementDialog(props: Props) {
  const path = `/api/matters/${props.matterId}/proceedings/${props.proceedingId}/pleadings/tracks/${props.track.id}/statements`;
  return <Command {...props} title="Retain statement of case" description="Retain one exact document version. Prepared, filed, accepted and served remain separate events." path={path} submitLabel="Retain exact version" build={(form) => ({
    idempotencyKey: key(), statementType: value(form, 'statementType'), partyId: value(form, 'partyId'),
    documentVersionId: value(form, 'documentVersionId'), predecessorVersionId: nullable(form, 'predecessorVersionId'),
    preparedByUserId: props.workspace.actingUserId, statementOfTruthStatus: value(form, 'statementOfTruthStatus'),
    signatoryName: '', signatoryCapacity: '', signedAt: null,
    responsePosition: value(form, 'responsePosition'), amendmentRoute: value(form, 'amendmentRoute'),
    amendmentReason: value(form, 'amendmentReason'),
  })}>
    <label className="form-field"><span>Statement type</span><select name="statementType" defaultValue="defence"><option value="acknowledgment_of_service">Acknowledgment of service</option><option value="defence">Defence</option><option value="reply">Reply</option><option value="counterclaim">Counterclaim</option><option value="defence_to_counterclaim">Defence to counterclaim</option><option value="amended_statement">Amended statement</option><option value="other">Other statement</option></select></label>
    <label className="form-field"><span>Party making statement</span><select name="partyId" defaultValue={props.track.defendantPartyId} required>{props.workspace.sources.parties.map((party) => <option key={party.id} value={party.id}>{party.name} · {party.kind}</option>)}</select></label>
    <Documents workspace={props.workspace} name="documentVersionId" label="Exact statement version" />
    <label className="form-field"><span>Statement of truth position</span><select name="statementOfTruthStatus" defaultValue="not_reviewed"><option value="not_reviewed">Not reviewed</option><option value="required_unconfirmed">Required · unconfirmed</option><option value="present_unsigned">Present · unsigned</option><option value="defective_or_disputed">Defective or disputed</option><option value="not_applicable">Not applicable</option></select></label>
    <label className="form-field"><span>Response position</span><select name="responsePosition" defaultValue="not_recorded"><option value="not_recorded">Not recorded</option><option value="defend_all">Defend all</option><option value="defend_part">Defend part</option><option value="admit_all">Admit all</option><option value="admit_part">Admit part</option><option value="jurisdiction_challenged">Jurisdiction challenged</option><option value="counterclaim_included">Counterclaim included</option></select></label>
    <label className="form-field"><span>Amendment route</span><select name="amendmentRoute" defaultValue="not_applicable"><option value="not_applicable">Not applicable</option><option value="before_service">Before service</option><option value="written_consent">Written consent</option><option value="court_permission">Court permission</option><option value="court_direction">Court direction</option></select></label>
    <label className="form-field form-field--wide"><span>Amendment reason, if applicable</span><textarea name="amendmentReason" /></label>
    <div className="form-alert form-field--wide">SwiftClaim records the selected position; it does not approve legal content or sign a statement of truth.</div>
  </Command>;
}

export function DeadlineReviewDialog(props: Props) {
  const path = `/api/matters/${props.matterId}/proceedings/${props.proceedingId}/pleadings/tracks/${props.track.id}/deadline-reviews`;
  return <Command {...props} title="Review response date" description="Record a qualified projection or exact source date after checking the trigger facts and applicable regime." path={path} submitLabel="Record reviewed date" build={(form) => ({
    expectedVersion: props.track.version, idempotencyKey: key(), kind: value(form, 'kind'), outcome: value(form, 'outcome'),
    triggerDate: nullable(form, 'triggerDate'), projectedDate: nullable(form, 'projectedDate'),
    sourceDocumentVersionId: nullable(form, 'sourceDocumentVersionId'), ruleKey: value(form, 'ruleKey'),
    ruleVersion: value(form, 'ruleVersion'), sourceTitle: value(form, 'sourceTitle'), sourceUrl: value(form, 'sourceUrl'),
    reviewedAt: iso(form, 'reviewedAt'), note: value(form, 'note'),
  })}>
    <label className="form-field"><span>Date kind</span><select name="kind" defaultValue="defence"><option value="acknowledgment">Acknowledgment</option><option value="defence">Defence</option><option value="reply">Reply</option><option value="counterclaim_response">Counterclaim response</option></select></label>
    <label className="form-field"><span>Outcome</span><select name="outcome" defaultValue="projected"><option value="projected">Qualified projection</option><option value="source_date">Exact source date</option><option value="manual_court_period_required">Manual court period required</option><option value="blocked_missing_facts">Blocked · missing facts</option></select></label>
    <label className="form-field"><span>Trigger date</span><input name="triggerDate" type="date" /></label><label className="form-field"><span>Response date</span><input name="projectedDate" type="date" /></label>
    <label className="form-field"><span>Rule key</span><input name="ruleKey" /></label><label className="form-field"><span>Rule version</span><input name="ruleVersion" defaultValue="reviewed-2026-07-18" /></label>
    <label className="form-field"><span>Source title</span><input name="sourceTitle" /></label><label className="form-field"><span>Source URL</span><input name="sourceUrl" type="url" /></label>
    <label className="form-field"><span>Reviewed at</span><input name="reviewedAt" type="datetime-local" required /></label>
    <label className="form-field"><span>Exact court source, if applicable</span><select name="sourceDocumentVersionId" defaultValue=""><option value="">No court-stated date source</option>{props.workspace.sources.documents.map((document) => <option key={document.id} value={document.id}>{document.title} · v{document.version}</option>)}</select></label>
    <label className="form-field form-field--wide"><span>Review note</span><textarea name="note" minLength={10} required /></label>
    <div className="form-alert form-field--wide">A reviewed date remains a recorded projection or source date, not an automated legal conclusion.</div>
  </Command>;
}

export function DefaultReviewDialog(props: Props) {
  const current = props.track.defaultReviews[0];
  const path = current
    ? `/api/matters/${props.matterId}/proceedings/${props.proceedingId}/pleadings/default-reviews/${current.id}/complete`
    : `/api/matters/${props.matterId}/proceedings/${props.proceedingId}/pleadings/tracks/${props.track.id}/default-reviews`;
  return <Command {...props} title="Human default judgment review" description="This checklist records review work and blockers. It never declares eligibility or entitlement." path={path} submitLabel={current ? 'Record human review' : 'Open review'} build={(form) => current ? ({
    expectedVersion: current.version, idempotencyKey: key(), outcome: value(form, 'outcome'),
    reviewedAt: iso(form, 'reviewedAt'), blockers: value(form, 'blockers').split('\n').map((item) => item.trim()).filter(Boolean), note: value(form, 'note'),
  }) : ({
    idempotencyKey: key(), statementVersionId: null,
    deadlineProjectionId: props.track.deadlines[0]?.id ?? null,
    claimType: value(form, 'claimType'), requestedMethod: value(form, 'requestedMethod'), note: value(form, 'note'),
  })}>
    {current ? <><label className="form-field"><span>Review outcome</span><select name="outcome" defaultValue="blockers_recorded"><option value="review_incomplete">Review incomplete</option><option value="blockers_recorded">Blockers recorded</option><option value="human_review_completed">Human review completed</option></select></label><label className="form-field"><span>Reviewed at</span><input name="reviewedAt" type="datetime-local" required /></label><label className="form-field form-field--wide"><span>Blockers · one per line</span><textarea name="blockers" defaultValue={current.blockers.join('\n')} /></label></> : <><label className="form-field"><span>Claim type</span><input name="claimType" minLength={2} required /></label><label className="form-field"><span>Requested method</span><input name="requestedMethod" minLength={2} required /></label></>}
    <label className="form-field form-field--wide"><span>Human review note</span><textarea name="note" minLength={10} required /></label>
    <div className="form-alert form-field--wide">The resulting status is only review incomplete, blockers recorded, or human review completed.</div>
  </Command>;
}

export function AmendmentAuthorityDialog(props: Props) {
  const versions = props.track.statements.flatMap((statement) => statement.currentVersion ? [statement.currentVersion] : []);
  const selected = versions[0];
  const path = `/api/matters/${props.matterId}/proceedings/${props.proceedingId}/pleadings/statement-versions/${selected?.id ?? 'missing'}/amendment-authority`;
  return <Command {...props} title="Retain amendment authority" description="Link the exact consent or court source to the exact proposed amended statement version." path={path} submitLabel="Retain authority source" build={(form) => ({
    expectedVersion: props.track.statements.find(({ currentVersion }) => currentVersion?.id === selected?.id)?.version ?? 1,
    idempotencyKey: key(), route: value(form, 'route'), consentDocumentVersionId: nullable(form, 'consentDocumentVersionId'),
    applicationId: null, sealedOrderId: null, reviewedAt: iso(form, 'reviewedAt'), note: value(form, 'note'),
  })}>
    <label className="form-field"><span>Amended version</span><select disabled><option>{selected ? `${selected.statementType.replaceAll('_', ' ')} · v${selected.versionNumber}` : 'No statement version available'}</option></select></label>
    <label className="form-field"><span>Authority route</span><select name="route" defaultValue="written_consent"><option value="before_service">Before service</option><option value="written_consent">Written consent</option></select></label>
    <Documents workspace={props.workspace} name="consentDocumentVersionId" label="Exact written consent source" />
    <label className="form-field"><span>Reviewed at</span><input name="reviewedAt" type="datetime-local" required /></label>
    <label className="form-field form-field--wide"><span>Review note</span><textarea name="note" minLength={10} required /></label>
  </Command>;
}
