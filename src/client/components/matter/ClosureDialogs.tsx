import { useMemo, useState, type FormEvent } from 'react';

import { ApiError, jsonBody, request, type ClosureWorkspace, type TeamMember } from '../../api.js';
import { Dialog } from '../Dialog.js';

export type ClosureCommand =
  | { kind: 'prepare' }
  | { kind: 'approve' }
  | { kind: 'close' }
  | { kind: 'reopen' }
  | { kind: 'apply_hold' }
  | { kind: 'release_hold'; holdId: string };

interface DocumentSource { id: string; title: string; version: number }
interface Props {
  matterId: string; workspace: ClosureWorkspace; command: ClosureCommand; team: TeamMember[];
  documents: DocumentSource[]; onClose: () => void; onCompleted: () => Promise<void> | void;
}

const key = () => crypto.randomUUID();
const addYears = (years: number) => {
  const date = new Date(); date.setFullYear(date.getFullYear() + years); return date.toISOString().slice(0, 10);
};

export function ClosureDialogs({ matterId, workspace, command, team, documents, onClose, onCompleted }: Props) {
  const idempotencyKey = useMemo(key, [command]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reportId, setReportId] = useState(documents[0]?.id ?? '');
  const [ownerId, setOwnerId] = useState(team[0]?.id ?? '');
  const [reason, setReason] = useState('Reviewed against the exact retained matter record and authorised by a human decision-maker.');
  const [dueOn, setDueOn] = useState(addYears(0));
  const title = ({ prepare: 'Prepare closure', approve: 'Approve closure', close: 'Close matter', reopen: 'Reopen matter',
    apply_hold: 'Apply legal hold', release_hold: 'Release legal hold' } as const)[command.kind];

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    try {
      let path = `/api/matters/${matterId}/closure`;
      let body: Record<string, unknown> = { idempotencyKey, explicitHumanAuthority: true };
      if (command.kind === 'prepare') {
        path += '/reviews';
        body = { ...body,
          outcome: form.get('outcome'), closureReason: form.get('closureReason'), lessons: form.get('lessons'),
          finalClientReportStatus: 'sent', finalClientReportDocumentVersionId: reportId,
          documentsPosition: form.get('documentsPosition'), documentsNote: form.get('documentsNote'),
          retentionBasis: form.get('retentionBasis'), retentionUntil: form.get('retentionUntil'),
          undertakingsConfirmedClear: form.get('undertakingsConfirmedClear') === 'on',
          complaintsConfirmedClear: form.get('complaintsConfirmedClear') === 'on', attestationNote: form.get('attestationNote'),
          transfers: workspace.currentReadiness.blockers.filter((item) => item.severity === 'residual').map((item) => ({
            blockerKey: item.key, ownerUserId: ownerId, dueOn, reason,
          })),
        };
      } else if (command.kind === 'approve' || command.kind === 'close') {
        path += `/reviews/${workspace.review!.id}/${command.kind}`;
        body.note = reason;
      } else if (command.kind === 'reopen') {
        path += '/reopen'; body = { ...body, reason, newOwnerUserId: ownerId };
      } else if (command.kind === 'apply_hold') {
        path += '/legal-holds'; body.reason = reason;
      } else {
        path += `/legal-holds/${command.holdId}/release`; body.reason = reason;
      }
      await request(path, { method: 'POST', body: jsonBody(body) });
      await onCompleted(); onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The closure command could not be saved.');
    } finally { setBusy(false); }
  };

  const residual = workspace.currentReadiness.blockers.filter((item) => item.severity === 'residual');
  return <Dialog open title={title} description="This creates immutable closure evidence and requires explicit human authority." onClose={onClose} size="wide">
    <form className="form-stack" onSubmit={submit}>
      {error ? <div className="inline-notice inline-notice--error" role="alert">{error}</div> : null}
      {command.kind === 'prepare' ? <>
        <label>Outcome<textarea name="outcome" required minLength={10} /></label>
        <label>Closure reason<textarea name="closureReason" required minLength={10} /></label>
        <label>Lessons learned<textarea name="lessons" required minLength={10} /></label>
        <label>Exact final client report<select value={reportId} onChange={(event) => setReportId(event.target.value)} required>
          <option value="">Choose retained document version</option>{documents.map((item) => <option key={item.id} value={item.id}>{item.title} · v{item.version}</option>)}</select></label>
        <div className="field-grid field-grid--two"><label>Documents position<select name="documentsPosition" defaultValue="retained">
          <option value="returned">Returned</option><option value="retained">Retained</option><option value="mixed">Mixed</option></select></label>
          <label>Retain until<input name="retentionUntil" type="date" defaultValue={addYears(6)} required /></label></div>
        <label>Documents note<textarea name="documentsNote" required minLength={10} /></label>
        <label>Retention basis<textarea name="retentionBasis" required minLength={10} /></label>
        <fieldset><legend>File attestations</legend><label className="checkbox-field"><input name="undertakingsConfirmedClear" type="checkbox" required /><span>No unrecorded undertaking remains</span></label>
          <label className="checkbox-field"><input name="complaintsConfirmedClear" type="checkbox" required /><span>No unresolved client-service complaint remains</span></label></fieldset>
        <label>Attestation note<textarea name="attestationNote" required minLength={10} /></label>
        {residual.length ? <fieldset><legend>Post-closure obligations</legend><p>Each residual item will remain named, owned and dated after closure.</p>
          <label>Responsible owner<select value={ownerId} onChange={(event) => setOwnerId(event.target.value)} required>{team.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
          <label>Due date<input type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} required /></label>
          <label>Control reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={10} required /></label></fieldset> : null}
      </> : command.kind === 'reopen' ? <><label>New responsible owner<select value={ownerId} onChange={(event) => setOwnerId(event.target.value)} required>
        <option value="">Choose owner</option>{team.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
        <label>Reopening reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={10} required /></label></>
        : <label>Decision reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={10} required /></label>}
      <div className="dialog-actions"><button className="button button--ghost" type="button" onClick={onClose}>Cancel</button>
        <button className="button button--primary" type="submit" disabled={busy || (command.kind === 'prepare' && (!reportId || (residual.length > 0 && !ownerId))) || (command.kind === 'reopen' && !ownerId)}>{busy ? 'Saving…' : title}</button></div>
    </form>
  </Dialog>;
}
