import { AlertTriangle, Calculator, Scale, ShieldCheck } from 'lucide-react';

import type { LossScheduleRecord, RepairsQuantumWorkspace } from '../../api.js';

const money = (minor: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(minor / 100);
const label = (value: string) =>
  value.replaceAll('_', ' ').replace(/^./, (character) => character.toUpperCase());

interface Props {
  schedule: LossScheduleRecord | undefined;
  review: RepairsQuantumWorkspace['generalDamagesReviews'][number] | undefined;
  canApprove: boolean;
  onApprove: (schedule: LossScheduleRecord) => void;
}

export function QuantumView({ schedule, review, canApprove, onApprove }: Props) {
  if (!schedule) {
    return <div className="quantum-empty"><Calculator size={28} /><h3>No schedule of loss</h3><p>A reviewed loss schedule has not yet been recorded.</p></div>;
  }
  return (
    <div className="quantum-view">
      <div className="quantum-total-grid">
        <article><small>Special damages</small><strong>{money(schedule.totals.specialDamagesMinor)}</strong><span>Server-calculated from approved lines</span></article>
        <article><small>General damages review</small><strong>{schedule.totals.generalDamages ? `${money(schedule.totals.generalDamages.lowMinor)}–${money(schedule.totals.generalDamages.highMinor)}` : 'Not reviewed'}</strong><span>Human valuation, shown separately</span></article>
        <article className={schedule.totals.evidenceGapCount ? 'has-warning' : ''}><small>Evidence gaps</small><strong>{schedule.totals.evidenceGapCount}</strong><span>{money(schedule.totals.unsupportedAmountMinor)} affected</span></article>
      </div>
      <header className="quantum-view-header">
        <div><span className="eyebrow">Versioned schedule</span><h3>{schedule.title}</h3><p>Valued {schedule.valuationOn} · Version {schedule.scheduleVersion} · {label(schedule.status)}</p></div>
        {canApprove && schedule.status === 'draft' ? <button className="button button--secondary button--small" type="button" onClick={() => onApprove(schedule)}><ShieldCheck size={15} /> Approve schedule</button> : null}
      </header>
      <div className="loss-table" role="table" aria-label="Schedule of loss">
        <div className="loss-table__head" role="row"><span>Description</span><span>Calculation</span><span>Evidence</span><span>Amount</span></div>
        {schedule.items.map((item) => <div className="loss-table__row" role="row" key={item.id}><div><strong>{item.description}</strong><small>{label(item.category)} · {label(item.position)}</small></div><span>{item.calculation}</span><span className={`evidence-state evidence-state--${item.evidenceStatus}`}>{item.evidenceStatus === 'partial' ? 'Partial evidence' : label(item.evidenceStatus)}</span><strong>{money(item.calculatedAmountMinor)}</strong></div>)}
      </div>
      {review ? <section className="valuation-provenance"><header><Scale size={18} /><div><small>Human valuation provenance</small><strong>{money(review.lowMinor)}–{money(review.highMinor)}</strong></div></header><p>{review.basis}</p><div className="human-control-note"><AlertTriangle size={14} /> SwiftClaim did not generate this valuation. Verify the evidence, authorities and current law before use.</div></section> : null}
    </div>
  );
}
