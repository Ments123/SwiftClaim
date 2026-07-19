import { useRef, useState, type FormEvent } from 'react';

import { jsonBody, request, type FinanceDocumentSource } from '../../api.js';
import { Dialog } from '../Dialog.js';
import type { FinanceCommand } from './FinancePanel.js';

interface FinanceDialogsProps {
  command: FinanceCommand;
  matterId: string;
  documentSources: FinanceDocumentSource[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

const key = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const localDateTime = () => {
  const current = new Date();
  return new Date(current.getTime() - current.getTimezoneOffset() * 60_000).toISOString();
};
const today = () => localDateTime().slice(0, 10);
const minor = (value: FormDataEntryValue | null) => Math.round(Number(value ?? 0) * 100);

function Field({ label, children, wide = false }: {
  label: string; children: React.ReactNode; wide?: boolean;
}) {
  return <label className={`form-field${wide ? ' form-field--wide' : ''}`}><span>{label}</span>{children}</label>;
}

export function FinanceDialogs({ command, matterId, documentSources, onClose, onSaved }: FinanceDialogsProps) {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [commandKey] = useState(() => key(command.kind));
  const commandAt = useRef<string | null>(null);

  const submitReviewedSuggestion = async (
    suggestion: Extract<FinanceCommand, { kind: 'suggestion' | 'submit_suggestion' }>['suggestion'],
    chargeable: boolean,
  ) => request(`/api/matters/${matterId}/finance/time-entries`, {
    method: 'POST', body: jsonBody({
      idempotencyKey: `suggestion-time:${suggestion.id}`,
      workDate: suggestion.observedAt.slice(0, 10), minutes: suggestion.minutes,
      narrative: suggestion.proposedNarrative, activityCode: suggestion.proposedActivityCode,
      costsPhase: suggestion.proposedCostsPhase, chargeable,
      sourceKind: suggestion.sourceKind, sourceId: suggestion.sourceId,
    }),
  });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const commandTimestamp = commandAt.current ?? now();
    commandAt.current = commandTimestamp;
    try {
      switch (command.kind) {
        case 'manual_time':
          await request(`/api/matters/${matterId}/finance/time-entries`, {
            method: 'POST', body: jsonBody({
              idempotencyKey: commandKey, workDate: form.get('workDate'),
              minutes: Number(form.get('minutes')), narrative: form.get('narrative'),
              activityCode: form.get('activityCode'), costsPhase: form.get('costsPhase'),
              chargeable: form.get('chargeable') === 'on', sourceKind: 'manual', sourceId: null,
            }),
          });
          break;
        case 'start_timer':
          await request(`/api/matters/${matterId}/finance/timers`, {
            method: 'POST', body: jsonBody({
              idempotencyKey: commandKey,
              activityCode: form.get('activityCode'), costsPhase: form.get('costsPhase'),
              narrative: form.get('narrative'),
            }),
          });
          break;
        case 'stop_timer':
          await request(`/api/matters/${matterId}/finance/timers/${command.timer.id}/stop`, {
            method: 'POST', body: jsonBody({
              expectedVersion: command.timer.version,
              idempotencyKey: commandKey,
            }),
          });
          break;
        case 'submit_timer':
          if (command.timer.elapsedMinutes === null) throw new Error('The stopped timer has no elapsed duration.');
          await request(`/api/matters/${matterId}/finance/time-entries`, {
            method: 'POST', body: jsonBody({
              idempotencyKey: `timer-time:${command.timer.id}`,
              workDate: command.timer.startedAt.slice(0, 10),
              minutes: command.timer.elapsedMinutes,
              narrative: form.get('narrative'), activityCode: command.timer.activityCode,
              costsPhase: command.timer.costsPhase, chargeable: form.get('chargeable') === 'on',
              sourceKind: 'timer', sourceId: command.timer.id,
            }),
          });
          break;
        case 'suggestion': {
          const reason = String(form.get('reason'));
          await request(`/api/matters/${matterId}/finance/suggestions/${command.suggestion.id}/decisions`, {
            method: 'POST', body: jsonBody({
              expectedVersion: command.suggestion.version,
              idempotencyKey: `suggestion-decision:${command.suggestion.id}:${command.decision}`,
              decision: command.decision, reason,
            }),
          });
          if (command.decision === 'accept') {
            await submitReviewedSuggestion(command.suggestion, form.get('chargeable') === 'on');
          }
          break;
        }
        case 'submit_suggestion':
          await submitReviewedSuggestion(command.suggestion, form.get('chargeable') === 'on');
          break;
        case 'approve_time':
          await request(`/api/matters/${matterId}/finance/time-entries/${command.timeEntry.id}/approve`, {
            method: 'POST', body: jsonBody({
              expectedVersion: command.timeEntry.version,
              idempotencyKey: commandKey, approvedAt: commandTimestamp,
              approvalNote: form.get('note'), explicitHumanApproval: true,
            }),
          });
          break;
        case 'estimate':
          await request(`/api/matters/${matterId}/finance/estimates`, {
            method: 'POST', body: jsonBody({
              idempotencyKey: commandKey, effectiveOn: form.get('effectiveOn'),
              scope: form.get('scope'), feesMinor: minor(form.get('fees')),
              disbursementsMinor: minor(form.get('disbursements')), vatMinor: minor(form.get('vat')),
              overallLimitMinor: minor(form.get('overallLimit')), currency: 'GBP',
              reviewOn: form.get('reviewOn') || null,
              sourceDocumentVersionId: form.get('sourceDocumentVersionId') || null,
              approvalNote: form.get('approvalNote'), explicitApproval: true,
            }),
          });
          break;
        case 'disbursement': {
          const netMinor = minor(form.get('net'));
          const vatMinor = minor(form.get('vat'));
          await request(`/api/matters/${matterId}/finance/disbursements`, {
            method: 'POST', body: jsonBody({
              idempotencyKey: commandKey, supplier: form.get('supplier'),
              invoiceReference: form.get('invoiceReference'), category: form.get('category'),
              description: form.get('description'), netMinor, vatMinor,
              grossMinor: netMinor + vatMinor, currency: 'GBP',
              invoiceDate: form.get('invoiceDate') || null, dueOn: form.get('dueOn') || null,
              sourceDocumentVersionId: form.get('sourceDocumentVersionId') || null,
            }),
          });
          break;
        }
        case 'disbursement_event':
          await request(`/api/matters/${matterId}/finance/disbursements/${command.disbursement.id}/events`, {
            method: 'POST', body: jsonBody({
              expectedVersion: command.disbursement.version,
              idempotencyKey: commandKey, eventType: command.eventType,
              occurredAt: commandTimestamp, evidenceDocumentVersionId: form.get('evidenceDocumentVersionId') || null,
              note: form.get('note'),
            }),
          });
          break;
        case 'journal_approve':
          await request(`/api/matters/${matterId}/finance/journals/${command.journal.id}/approve`, {
            method: 'POST', body: jsonBody({
              expectedVersion: command.journal.version, idempotencyKey: commandKey,
              approvedAt: commandTimestamp, note: form.get('note'), explicitHumanApproval: true,
            }),
          });
          break;
        case 'journal_post':
          await request(`/api/matters/${matterId}/finance/journals/${command.journal.id}/post`, {
            method: 'POST', body: jsonBody({
              expectedVersion: command.journal.version, idempotencyKey: commandKey,
              postedAt: commandTimestamp, explicitHumanConfirmation: true,
            }),
          });
          break;
        case 'rate_card':
          await request('/api/finance/rate-cards', {
            method: 'POST', body: jsonBody({
              idempotencyKey: commandKey, name: form.get('name'),
              description: form.get('description'), currency: 'GBP',
            }),
          });
          break;
        case 'rate_version':
          await request(`/api/finance/rate-cards/${command.rateCard.id}/versions`, {
            method: 'POST', body: jsonBody({
              expectedVersion: command.rateCard.version,
              idempotencyKey: commandKey, effectiveFrom: form.get('effectiveFrom'),
              effectiveTo: form.get('effectiveTo') || null,
              entries: [{
                grade: form.get('grade'), userId: null,
                activityCode: form.get('activityCode'), matterId: null,
                hourlyRateMinor: minor(form.get('hourlyRate')), currency: 'GBP',
              }],
              note: form.get('note'),
            }),
          });
          break;
        case 'rate_activate':
          await request(`/api/finance/rate-cards/${command.rateCard.id}/activate`, {
            method: 'POST', body: jsonBody({
              expectedVersion: command.rateCard.version,
              idempotencyKey: commandKey, rateVersionId: command.rateVersion.id,
              approvedAt: commandTimestamp, approvalNote: form.get('approvalNote'),
              explicitHumanApproval: true,
            }),
          });
          break;
      }
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The finance command could not be saved.');
    } finally {
      setSubmitting(false);
    }
  };

  const titles: Record<FinanceCommand['kind'], string> = {
    manual_time: 'Submit manual time', start_timer: 'Start matter timer', stop_timer: 'Stop matter timer',
    submit_timer: 'Submit stopped timer',
    suggestion: command.kind === 'suggestion' && command.decision === 'accept' ? 'Accept & submit suggestion' : 'Reject suggestion',
    submit_suggestion: 'Submit reviewed suggestion',
    approve_time: 'Approve time into WIP', estimate: 'Approve a new estimate',
    disbursement: 'Propose a disbursement', disbursement_event: 'Record disbursement fact',
    journal_approve: 'Approve balanced journal', journal_post: 'Post balanced journal',
    rate_card: 'Create draft rate card',
    rate_version: 'Prepare rate version', rate_activate: 'Activate rate version',
  };

  return (
    <Dialog open title={titles[command.kind]} description="This governed command is retained with your identity, request and immutable audit facts." onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        {command.kind === 'manual_time' ? <>
          <Field label="Work date"><input name="workDate" type="date" defaultValue={today()} required /></Field>
          <Field label="Minutes"><input name="minutes" type="number" min="1" max="1440" defaultValue="6" required /></Field>
          <Field label="Activity code"><input name="activityCode" defaultValue="case_progression" required /></Field>
          <Field label="Costs phase"><input name="costsPhase" defaultValue="case_management" required /></Field>
          <Field label="Narrative" wide><textarea name="narrative" rows={3} minLength={10} required /></Field>
          <Field label="Chargeability" wide><span className="checkbox-field"><input name="chargeable" type="checkbox" defaultChecked /> Chargeable time</span></Field>
        </> : null}
        {command.kind === 'start_timer' ? <>
          <Field label="Activity code"><input name="activityCode" defaultValue="case_progression" required /></Field>
          <Field label="Costs phase"><input name="costsPhase" defaultValue="case_management" required /></Field>
          <Field label="Narrative" wide><textarea name="narrative" rows={3} minLength={5} required /></Field>
          <p className="form-field--wide">The timer starts when you confirm. SwiftClaim records the timestamp on the server.</p>
        </> : null}
        {command.kind === 'stop_timer' ? <p className="form-field--wide">Stop the running timer now? The server will retain the exact elapsed minutes for later human submission.</p> : null}
        {command.kind === 'submit_timer' ? <>
          <div className="finance-dialog-summary form-field--wide"><strong>{command.timer.elapsedMinutes} exact server-recorded min</strong><small>{command.timer.activityCode.replaceAll('_', ' ')} · {command.timer.costsPhase.replaceAll('_', ' ')}</small></div>
          <Field label="Reviewed narrative" wide><textarea name="narrative" rows={3} minLength={10} defaultValue={command.timer.narrative ?? ''} required /></Field>
          <Field label="Chargeability" wide><span className="checkbox-field"><input name="chargeable" type="checkbox" defaultChecked /> Submit as chargeable</span></Field>
        </> : null}
        {command.kind === 'suggestion' ? <>
          <div className="finance-dialog-summary form-field--wide"><strong>{command.suggestion.minutes} min · {command.suggestion.proposedNarrative}</strong><small>{command.suggestion.label}</small></div>
          <Field label="Human decision reason" wide><textarea name="reason" rows={3} minLength={5} required /></Field>
          {command.decision === 'accept' ? <Field label="Chargeability" wide><span className="checkbox-field"><input name="chargeable" type="checkbox" defaultChecked /> Submit as chargeable after acceptance</span></Field> : null}
        </> : null}
        {command.kind === 'submit_suggestion' ? <>
          <div className="finance-dialog-summary form-field--wide"><strong>{command.suggestion.minutes} min · {command.suggestion.proposedNarrative}</strong><small>The human decision is already retained. This step submits the exact reviewed facts for approval.</small></div>
          <Field label="Chargeability" wide><span className="checkbox-field"><input name="chargeable" type="checkbox" defaultChecked /> Submit as chargeable</span></Field>
        </> : null}
        {command.kind === 'approve_time' ? <>
          <div className="finance-dialog-summary form-field--wide"><strong>{command.timeEntry.minutes} min · {command.timeEntry.narrative ?? 'Narrative restricted'}</strong><small>The exact effective rate will be snapshotted by the server.</small></div>
          <Field label="Independent approval note" wide><textarea name="note" rows={3} minLength={10} required /></Field>
        </> : null}
        {command.kind === 'estimate' ? <>
          <Field label="Effective on"><input name="effectiveOn" type="date" defaultValue={today()} required /></Field>
          <Field label="Review on"><input name="reviewOn" type="date" /></Field>
          <Field label="Fees (£)"><input name="fees" type="number" min="0" step="0.01" required /></Field>
          <Field label="Disbursements (£)"><input name="disbursements" type="number" min="0" step="0.01" required /></Field>
          <Field label="VAT (£)"><input name="vat" type="number" min="0" step="0.01" required /></Field>
          <Field label="Overall limit (£)"><input name="overallLimit" type="number" min="0" step="0.01" required /></Field>
          <Field label="Scope" wide><textarea name="scope" rows={3} minLength={10} required /></Field>
          <DocumentSelect name="sourceDocumentVersionId" label="Exact estimate source" sources={documentSources} optional />
          <Field label="Human approval note" wide><textarea name="approvalNote" rows={3} minLength={10} required /></Field>
        </> : null}
        {command.kind === 'disbursement' ? <>
          <Field label="Supplier"><input name="supplier" minLength={2} required /></Field>
          <Field label="Invoice/reference"><input name="invoiceReference" /></Field>
          <Field label="Category"><input name="category" defaultValue="expert_report" required /></Field>
          <Field label="Invoice date"><input name="invoiceDate" type="date" /></Field>
          <Field label="Net (£)"><input name="net" type="number" min="0" step="0.01" required /></Field>
          <Field label="VAT (£)"><input name="vat" type="number" min="0" step="0.01" defaultValue="0" required /></Field>
          <Field label="Due on"><input name="dueOn" type="date" /></Field>
          <DocumentSelect name="sourceDocumentVersionId" label="Exact invoice/source" sources={documentSources} optional />
          <Field label="Description" wide><textarea name="description" rows={3} minLength={10} required /></Field>
        </> : null}
        {command.kind === 'disbursement_event' ? <>
          <div className="finance-dialog-summary form-field--wide"><strong>{command.disbursement.supplier} · {command.eventType.replaceAll('_', ' ')}</strong><small>Liability, incurrence and payment remain separate facts.</small></div>
          <DocumentSelect name="evidenceDocumentVersionId" label="Exact event evidence" sources={documentSources} optional={command.eventType !== 'paid_external'} />
          <Field label="Human note" wide><textarea name="note" rows={3} minLength={10} required /></Field>
        </> : null}
        {command.kind === 'journal_approve' ? <>
          <div className="finance-dialog-summary form-field--wide"><strong>Debits and credits · {(command.journal.totalDebitMinor / 100).toFixed(2)} GBP</strong><small>Prepared by {command.journal.preparedBy.slice(0, 8)} · version {command.journal.version}</small></div>
          <Field label="Independent approval note" wide><textarea name="note" rows={3} minLength={10} required /></Field>
        </> : null}
        {command.kind === 'journal_post' ? <p className="form-field--wide">Post this approved, balanced journal? Posted facts are immutable and corrections require a separate reversal.</p> : null}
        {command.kind === 'rate_card' ? <>
          <Field label="Rate card name" wide><input name="name" minLength={3} required /></Field>
          <Field label="Description" wide><textarea name="description" rows={3} minLength={10} required /></Field>
        </> : null}
        {command.kind === 'rate_version' ? <>
          <div className="finance-dialog-summary form-field--wide"><strong>{command.rateCard.name}</strong><small>Prepare one firm-wide grade rate. Further grade or activity rates can be added in later immutable versions.</small></div>
          <Field label="Effective from"><input name="effectiveFrom" type="date" defaultValue={today()} required /></Field>
          <Field label="Effective to"><input name="effectiveTo" type="date" /></Field>
          <Field label="Fee-earner grade"><select name="grade" defaultValue="solicitor"><option value="partner">Partner</option><option value="solicitor">Solicitor</option><option value="paralegal">Paralegal</option><option value="trainee">Trainee</option></select></Field>
          <Field label="Hourly rate (£)"><input name="hourlyRate" type="number" min="0" step="0.01" required /></Field>
          <Field label="Activity code" wide><input name="activityCode" placeholder="Leave blank for all activities" /></Field>
          <Field label="Preparation note" wide><textarea name="note" rows={3} minLength={10} required /></Field>
        </> : null}
        {command.kind === 'rate_activate' ? <>
          <div className="finance-dialog-summary form-field--wide"><strong>{command.rateCard.name} · draft v{command.rateVersion.versionNumber}</strong><small>Effective {command.rateVersion.effectiveFrom}. Activation freezes this version; approved time will retain the exact applied rate.</small></div>
          <Field label="Independent approval note" wide><textarea name="approvalNote" rows={3} minLength={10} required /></Field>
        </> : null}
        {error ? <div className="form-alert form-field--wide" role="alert">{error}</div> : null}
        <div className="form-actions form-field--wide"><button className="button button--secondary" type="button" onClick={onClose}>Cancel</button><button className="button button--primary" type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Confirm & save'}</button></div>
      </form>
    </Dialog>
  );
}

function DocumentSelect({ name, label, sources, optional }: {
  name: string; label: string; sources: FinanceDocumentSource[]; optional: boolean;
}) {
  return <Field label={label}><select name={name} required={!optional} defaultValue=""><option value="">{optional ? 'No document linked' : 'Select exact evidence'}</option>{sources.map((source) => <option value={source.id} key={source.id}>{source.title} · v{source.version}</option>)}</select></Field>;
}
