import { AlertTriangle, CheckCircle2, Clock3, Hammer, ShieldCheck } from 'lucide-react';

import type { WorkScheduleRecord } from '../../api.js';

const label = (value: string) =>
  value.replaceAll('_', ' ').replace(/^./, (character) => character.toUpperCase());

function statusLabel(item: WorkScheduleRecord['items'][number]) {
  if (item.projection.verification === 'verified') return 'Verified complete';
  if (item.projection.completionAsserted) return 'Completion asserted';
  return label(item.projection.status);
}

interface Props {
  schedule: WorkScheduleRecord | undefined;
  canWrite: boolean;
  canApprove: boolean;
  onRecordEvent: (workItemId: string) => void;
  onApprove: (schedule: WorkScheduleRecord) => void;
}

export function RepairsView({
  schedule,
  canWrite,
  canApprove,
  onRecordEvent,
  onApprove,
}: Props) {
  if (!schedule) {
    return (
      <div className="quantum-empty">
        <Hammer size={28} />
        <h3>No schedule of works</h3>
        <p>A governed work schedule has not yet been recorded.</p>
      </div>
    );
  }
  return (
    <div className="repairs-view">
      <header className="quantum-view-header">
        <div>
          <span className="eyebrow">Approved source position</span>
          <h3>{schedule.title}</h3>
          <p>Version {schedule.scheduleVersion} · {label(schedule.sourceType)} · {label(schedule.status)}</p>
        </div>
        {canApprove && schedule.status === 'draft' ? (
          <button className="button button--secondary button--small" type="button" onClick={() => onApprove(schedule)}>
            <ShieldCheck size={15} /> Approve schedule
          </button>
        ) : null}
      </header>
      <div className="repair-item-list">
        {schedule.items.map((item) => (
          <article className={`repair-item repair-item--${item.priority}`} key={item.id}>
            <header>
              <div>
                <span>{item.area}</span>
                <h4>{item.description}</h4>
              </div>
              <span className={`repair-status repair-status--${item.projection.verification}`}>
                {item.projection.verification === 'verified' ? <CheckCircle2 size={14} /> : <Clock3 size={14} />}
                {statusLabel(item)}
              </span>
            </header>
            <div className="repair-item__facts">
              <span>{label(item.priority)} priority</span>
              <span>{label(item.responsibilityPosition)} responsibility</span>
              <span>Target {item.targetCompletionOn ?? 'not recorded'}</span>
              <span>{item.evidenceItemIds.length} source link{item.evidenceItemIds.length === 1 ? '' : 's'}</span>
            </div>
            {item.projection.clientPosition === 'disputed' ? (
              <div className="repair-dispute"><AlertTriangle size={15} /> Client disputes completion</div>
            ) : null}
            {item.projection.warnings.map((warning) => (
              <p className="repair-warning" key={warning.key}><AlertTriangle size={14} /> {warning.detail}</p>
            ))}
            <footer>
              <small>{item.sourceNote}</small>
              {canWrite ? (
                <button type="button" onClick={() => onRecordEvent(item.id)}>Record repair event</button>
              ) : null}
            </footer>
          </article>
        ))}
      </div>
    </div>
  );
}
