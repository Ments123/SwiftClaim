import { CalendarClock, Home, ListChecks, UserRound } from 'lucide-react';

import type { Matter360Data } from '../../api.js';

interface MatterHeaderProps {
  data: Matter360Data;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value));
}

export function MatterHeader({ data }: MatterHeaderProps) {
  const { matter, workflow } = data;
  const pendingDeadline = data.deadlines.find(
    (deadline) => deadline.status === 'pending',
  );

  return (
    <header className="matter-360-header">
      <div className="matter-360-header__identity">
        <div className="matter-header__topline">
          <span className="reference-chip">{matter.reference}</span>
          <span className={`risk-pill risk-pill--${matter.riskLevel}`}>
            {matter.riskLevel} risk
          </span>
          <span className="status-pill">
            <span /> {matter.status}
          </span>
        </div>
        <h1>{matter.title}</h1>
        <p>
          <strong>{matter.clientName}</strong>
          <span aria-hidden="true">·</span>
          {matter.matterType}
        </p>
      </div>

      <dl className="matter-360-header__facts">
        <div>
          <dt>
            <Home size={14} aria-hidden="true" /> Property
          </dt>
          <dd>Property being confirmed</dd>
        </div>
        <div>
          <dt>
            <ListChecks size={14} aria-hidden="true" /> Workflow
          </dt>
          <dd>
            Stage {workflow.currentStagePosition + 1} of {workflow.stages.length}
          </dd>
        </div>
        <div>
          <dt>
            <UserRound size={14} aria-hidden="true" /> Owner
          </dt>
          <dd>{matter.owner.name}</dd>
        </div>
        <div>
          <dt>
            <CalendarClock size={14} aria-hidden="true" /> Next legal date
          </dt>
          <dd>
            {pendingDeadline
              ? formatDate(pendingDeadline.dueDate)
              : matter.nextDeadline
                ? formatDate(matter.nextDeadline)
                : 'None recorded'}
          </dd>
        </div>
      </dl>
    </header>
  );
}
