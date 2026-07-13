import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  ClipboardList,
  UserRound,
} from 'lucide-react';

import type {
  Matter360Data,
  TransitionWorkflowCommand,
} from '../../api.js';
import { DeadlineCard } from './DeadlineCard.js';
import { WorkflowCard } from './WorkflowCard.js';

interface OperationalOverviewProps {
  data: Matter360Data;
  onTransition: (command: TransitionWorkflowCommand) => Promise<void>;
  onViewTasks?: () => void;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value));
}

export function OperationalOverview({
  data,
  onTransition,
  onViewTasks,
}: OperationalOverviewProps) {
  return (
    <div className="operational-overview">
      {data.alerts.length ? (
        <section className="matter-alerts" aria-label="Matter alerts">
          {data.alerts.map((alert) => (
            <article
              key={alert.key}
              className={`matter-alert matter-alert--${alert.severity}`}
            >
              <AlertTriangle size={18} aria-hidden="true" />
              <div>
                <strong>{alert.title}</strong>
                <p>{alert.detail}</p>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      <div className="operational-overview__top">
        <section className="surface position-card">
          <header className="section-header">
            <div>
              <span className="eyebrow">Matter position</span>
              <h2>Current claim</h2>
            </div>
            <span className="position-card__stage">
              {data.workflow.stages.find(
                (stage) => stage.key === data.workflow.currentStageKey,
              )?.name ?? data.matter.stage}
            </span>
          </header>
          <p>{
            data.matter.description ||
            'No concise matter position has been recorded.'
          }</p>
          <dl className="position-card__facts">
            <div>
              <dt>Client</dt>
              <dd>{data.matter.clientName}</dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>{data.matter.owner.name}</dd>
            </div>
            <div>
              <dt>Opened</dt>
              <dd>{formatDate(data.matter.openedAt)}</dd>
            </div>
            <div>
              <dt>Legacy source</dt>
              <dd>{data.matter.externalSource ?? 'SwiftClaim native'}</dd>
            </div>
          </dl>
        </section>

        <section className="surface matter-next-actions">
          <header className="section-header">
            <div>
              <span className="eyebrow">Operational queue</span>
              <h2>Next actions</h2>
            </div>
            {onViewTasks ? (
              <button type="button" onClick={onViewTasks}>
                View all <ArrowRight size={13} aria-hidden="true" />
              </button>
            ) : null}
          </header>
          {data.nextActions.length ? (
            <div className="matter-next-actions__list">
              {data.nextActions.slice(0, 4).map((task) => (
                <article key={task.id}>
                  <span className={`priority-marker priority-marker--${task.priority}`} />
                  <div>
                    <strong>{task.title}</strong>
                    <p>{task.notes || 'No supporting note recorded.'}</p>
                    <small>
                      <UserRound size={12} aria-hidden="true" />{' '}
                      {task.assignee.name} · {formatDate(task.dueAt)}
                    </small>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state empty-state--compact">
              <CheckCircle2 size={24} aria-hidden="true" />
              <strong>No open actions</strong>
              <p>There are no operational tasks requiring attention.</p>
            </div>
          )}
        </section>
      </div>

      <div className="operational-overview__control-grid">
        <WorkflowCard data={data} onTransition={onTransition} />
        <section className="surface deadline-register" aria-labelledby="deadline-register-title">
          <header className="section-header">
            <div>
              <span className="eyebrow">Legal date control</span>
              <h2 id="deadline-register-title">Deadline register</h2>
            </div>
            <span className="count-badge">{data.deadlines.length}</span>
          </header>
          <div className="deadline-register__notice">
            <CalendarCheck2 size={15} aria-hidden="true" />
            Dates retain the confirmed trigger, effective rule and official source.
          </div>
          {data.deadlines.length ? (
            <div className="deadline-register__list">
              {data.deadlines.map((deadline) => (
                <DeadlineCard key={deadline.id} deadline={deadline} />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <ClipboardList size={26} aria-hidden="true" />
              <strong>No calculated legal dates</strong>
              <p>Confirm a supported workflow trigger to create a dated record.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
