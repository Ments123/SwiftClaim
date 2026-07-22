import { useMemo, useState, type FormEvent } from 'react';

import { ApiError, jsonBody, request, type FinanceDocumentSource, type MatterBillingWorkspace, type MatterBill, type MatterTransfer } from '../../api.js';
import { Dialog } from '../Dialog.js';

export type BillingCommand =
  | { kind: 'prepare_bill' }
  | { kind: 'submit_bill'; bill: MatterBill }
  | { kind: 'approve_bill'; bill: MatterBill }
  | { kind: 'issue_bill'; bill: MatterBill }
  | { kind: 'deliver_bill'; bill: MatterBill }
  | { kind: 'prepare_transfer'; bill: MatterBill; balance: number }
  | { kind: 'approve_transfer'; transfer: MatterTransfer }
  | { kind: 'post_transfer'; transfer: MatterTransfer };

interface Props {
  matterId: string; workspace: MatterBillingWorkspace; command: BillingCommand | null;
  documentSources?: FinanceDocumentSource[]; onClose: () => void; onCompleted: () => Promise<void> | void;
}

const key = () => crypto.randomUUID();

export function BillingDialogs({ matterId, workspace, command, documentSources = [], onClose, onCompleted }: Props) {
  const idempotencyKey = useMemo(key, [command]);
  const commandTime = useMemo(() => new Date(), [command]);
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [adjustmentMinor, setAdjustmentMinor] = useState(0);
  const [note, setNote] = useState('Reviewed against the exact financial record.');
  const [amountMinor, setAmountMinor] = useState(0);
  const [deliveryEvidenceId, setDeliveryEvidenceId] = useState(documentSources[0]?.id ?? '');
  const [clientPartyId, setClientPartyId] = useState(workspace.clients[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!command) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      let path = ''; let body: Record<string, unknown> = { idempotencyKey };
      if (command.kind === 'prepare_bill') {
        const sources = workspace.eligibleSources.filter((source) => selected.includes(source.id));
        path = `/api/finance/billing/matters/${matterId}/bills`;
        body = { ...body, clientPartyId, dueOn: new Date(commandTime.getTime() + 30 * 86_400_000).toISOString().slice(0, 10),
          sourceEntries: sources.map((source) => ({ sourceKind: source.kind, sourceId: source.id,
            narrative: source.narrative, netMinor: source.netMinor })),
          adjustments: adjustmentMinor > 0 && sources[0] ? [{ sourceId: sources[0].id, adjustmentKind: 'reduction',
            amountMinor: adjustmentMinor, reason }] : [] };
      } else if (command.kind === 'prepare_transfer') {
        path = `/api/finance/cashroom/matters/${matterId}/transfers`;
        body = { ...body, clientPartyId: command.bill.clientPartyId, billId: command.bill.id,
          amountMinor, note, explicitHumanConfirmation: true };
      } else if (command.kind === 'approve_transfer' || command.kind === 'post_transfer') {
        path = `/api/finance/cashroom/matters/${matterId}/transfers/${command.transfer.id}/${command.kind === 'approve_transfer' ? 'approve' : 'post'}`;
        body = { ...body, expectedVersion: command.transfer.version,
          [command.kind === 'approve_transfer' ? 'approvedAt' : 'postedAt']: commandTime.toISOString() };
        if (command.kind === 'approve_transfer') { body.note = note; body.explicitHumanApproval = true; }
        else body.explicitHumanConfirmation = true;
      } else {
        const action = command.kind.replace('_bill', '');
        path = `/api/finance/billing/matters/${matterId}/bills/${command.bill.id}/${action}`;
        body = { ...body, expectedVersion: command.bill.version, note };
        if (command.kind === 'submit_bill') body.explicitHumanConfirmation = true;
        if (command.kind === 'approve_bill') { body.approvedAt = commandTime.toISOString(); body.explicitHumanApproval = true; }
        if (command.kind === 'issue_bill') { body = { expectedVersion: command.bill.version, idempotencyKey,
          taxPoint: commandTime.toISOString().slice(0, 10), explicitHumanConfirmation: true }; }
        if (command.kind === 'deliver_bill') {
          body = { expectedVersion: command.bill.version, idempotencyKey, deliveredAt: commandTime.toISOString(),
            channel: 'email', recipient: 'Client', evidenceDocumentVersionId: deliveryEvidenceId,
            explicitHumanConfirmation: true };
        }
      }
      await request(path, { method: 'POST', body: jsonBody(body) });
      await onCompleted(); onClose();
    } catch (reasonCaught) {
      setError(reasonCaught instanceof ApiError ? reasonCaught.message : 'The financial command could not be saved.');
    } finally { setBusy(false); }
  };

  const title = command.kind.replaceAll('_', ' ').replace(/^./, (value) => value.toUpperCase());
  return <Dialog open title={title} description="This creates an immutable, audited financial fact." onClose={onClose} size="wide">
    <form className="form-stack" onSubmit={submit}>
      {error ? <div className="inline-notice inline-notice--error" role="alert"><strong>Check this command</strong><span>{error}</span></div> : null}
      {command.kind === 'prepare_bill' ? <>
        <label>Bill client<select value={clientPartyId} onChange={(event) => setClientPartyId(event.target.value)}>
          {workspace.clients.map((client) => <option value={client.id} key={client.id}>{client.name}</option>)}</select></label>
        <fieldset className="billing-source-picker"><legend>Eligible approved sources</legend>
          {workspace.eligibleSources.map((source) => <label className="checkbox-field" key={source.id}>
            <input type="checkbox" checked={selected.includes(source.id)} aria-label={`${source.narrative} ${source.kind}`}
              onChange={(event) => setSelected((current) => event.target.checked ? [...current, source.id] : current.filter((id) => id !== source.id))} />
            <span><strong>{source.narrative}</strong><small>{source.kind} · £{(source.netMinor / 100).toFixed(2)}</small></span>
          </label>)}
        </fieldset>
        <div className="field-grid field-grid--two"><label>Adjustment amount (£)<input type="number" min="0" step="0.01" value={adjustmentMinor / 100}
          onChange={(event) => setAdjustmentMinor(Math.round(Number(event.target.value) * 100))} /></label>
          <label>Adjustment reason<input aria-label="Adjustment reason" value={reason} onChange={(event) => setReason(event.target.value)} /></label></div>
      </> : command.kind === 'prepare_transfer' ? <label>Transfer amount (£)<input type="number" min="0.01" max={command.balance / 100}
        step="0.01" value={amountMinor / 100} onChange={(event) => setAmountMinor(Math.round(Number(event.target.value) * 100))} /></label>
        : command.kind === 'deliver_bill' ? <label>Exact delivery evidence<select value={deliveryEvidenceId} onChange={(event) => setDeliveryEvidenceId(event.target.value)}>
          <option value="">Choose retained evidence</option>{documentSources.map((source) => <option key={source.id} value={source.id}>{source.title} · v{source.version}</option>)}</select></label>
        : command.kind === 'issue_bill' || command.kind === 'post_transfer' ? <div className="finance-dialog-summary"><strong>Explicit human confirmation required</strong><small>The exact approved record will be revalidated and posted atomically. No bank instruction will be initiated.</small></div>
        : <label>Review note<textarea value={note} onChange={(event) => setNote(event.target.value)} /></label>}
      <div className="dialog-actions"><button className="button button--ghost" type="button" onClick={onClose}>Cancel</button>
        <button className="button button--primary" type="submit" disabled={busy || (command.kind === 'prepare_bill' && (!clientPartyId || selected.length === 0)) || (command.kind === 'deliver_bill' && !deliveryEvidenceId)}>{busy ? 'Saving…' : title}</button></div>
    </form>
  </Dialog>;
}
