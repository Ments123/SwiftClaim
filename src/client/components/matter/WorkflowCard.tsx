import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Circle,
  CircleDot,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';

import {
  ApiError,
  type Matter360Data,
  type TransitionWorkflowCommand,
} from '../../api.js';

interface WorkflowCardProps {
  data: Matter360Data;
  onTransition: (command: TransitionWorkflowCommand) => Promise<void>;
}

export function WorkflowCard({ data, onTransition }: WorkflowCardProps) {
  const [confirming, setConfirming] = useState(false);
  const [completedKeys, setCompletedKeys] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const { workflow } = data;
  const nextStage = workflow.stages.find(
    (stage) => stage.position === workflow.currentStagePosition + 1,
  );
  const unresolvedBlockers = workflow.blockers.filter(
    (blocker) => !completedKeys.includes(blocker.key),
  );
  const canOverride =
    data.permissions.canOverrideWorkflow && overrideReason.trim().length >= 10;
  const canSubmit =
    reason.trim().length >= 10 &&
    (unresolvedBlockers.length === 0 || canOverride) &&
    !submitting;

  const toggleChecklistKey = (key: string) => {
    setCompletedKeys((current) =>
      current.includes(key)
        ? current.filter((candidate) => candidate !== key)
        : [...current, key],
    );
  };

  const closeConfirmation = () => {
    setConfirming(false);
    setCompletedKeys([]);
    setReason('');
    setOverrideReason('');
    setError('');
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!nextStage || !canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      const command: TransitionWorkflowCommand = {
        toStageKey: nextStage.key,
        expectedVersion: workflow.version,
        completedChecklistKeys: completedKeys,
        reason: reason.trim(),
      };
      if (unresolvedBlockers.length > 0 && overrideReason.trim()) {
        command.overrideReason = overrideReason.trim();
      }
      await onTransition(command);
      closeConfirmation();
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'CONFLICT') {
        setError(
          'This matter changed in another window. Reload the latest position before trying again.',
        );
      } else {
        setError(
          cause instanceof Error
            ? cause.message
            : 'The stage could not be changed.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="surface workflow-card" aria-labelledby="workflow-title">
      <header className="workflow-card__header">
        <div>
          <span className="eyebrow">Controlled workflow</span>
          <h2 id="workflow-title">{workflow.name}</h2>
          <p>
            Definition v{workflow.definitionVersion} · Matter state v
            {workflow.version}
          </p>
        </div>
        <span className="workflow-progress">
          {workflow.currentStagePosition + 1}/{workflow.stages.length}
        </span>
      </header>

      <ol className="workflow-stage-list">
        {workflow.stages.map((stage) => (
          <li
            key={stage.key}
            className={`workflow-stage workflow-stage--${stage.state}`}
            aria-current={stage.state === 'current' ? 'step' : undefined}
          >
            <span className="workflow-stage__marker">
              {stage.state === 'completed' ? (
                <CheckCircle2 size={18} aria-hidden="true" />
              ) : stage.state === 'current' ? (
                <CircleDot size={18} aria-hidden="true" />
              ) : (
                <Circle size={18} aria-hidden="true" />
              )}
            </span>
            <div>
              <strong>{stage.name}</strong>
              {stage.state === 'current' ? <p>{stage.description}</p> : null}
            </div>
            <small>
              {stage.state === 'completed'
                ? 'Complete'
                : stage.state === 'current'
                  ? 'Current'
                  : 'Upcoming'}
            </small>
          </li>
        ))}
      </ol>

      <div
        className={`workflow-readiness ${workflow.blockers.some((blocker) => blocker.severity === 'critical') ? 'workflow-readiness--critical' : ''}`}
      >
        <ShieldAlert size={17} aria-hidden="true" />
        <div>
          <strong>
            {workflow.blockers.length}{' '}
            {workflow.blockers.length === 1
              ? 'readiness blocker'
              : 'readiness blockers'}
          </strong>
          <span>
            {workflow.blockers.length
              ? 'Complete or formally override these controls before progression.'
              : 'Current-stage exit controls are complete.'}
          </span>
        </div>
      </div>

      {nextStage && data.permissions.canTransition && !confirming ? (
        <button
          className="button button--primary workflow-card__transition"
          type="button"
          onClick={() => setConfirming(true)}
        >
          Move to {nextStage.name} <ArrowRight size={15} aria-hidden="true" />
        </button>
      ) : null}

      {confirming && nextStage ? (
        <form className="transition-panel" onSubmit={submit}>
          <header>
            <div>
              <span className="eyebrow">Confirm controlled change</span>
              <h3>Move to {nextStage.name}</h3>
            </div>
            <button
              className="icon-button"
              type="button"
              onClick={closeConfirmation}
              aria-label="Cancel transition"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </header>

          {workflow.blockers.length ? (
            <fieldset className="transition-checklist">
              <legend>Confirm completed readiness controls</legend>
              {workflow.blockers.map((blocker) => (
                <label key={blocker.key}>
                  <input
                    type="checkbox"
                    aria-label={blocker.label}
                    checked={completedKeys.includes(blocker.key)}
                    onChange={() => toggleChecklistKey(blocker.key)}
                  />
                  <span className="transition-checkmark">
                    <Check size={13} aria-hidden="true" />
                  </span>
                  <span>{blocker.label}</span>
                  <small>{blocker.severity}</small>
                </label>
              ))}
            </fieldset>
          ) : null}

          <label className="form-field">
            <span>Reason for transition</span>
            <textarea
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Record why the matter is ready to move."
              required
              minLength={10}
            />
          </label>

          {data.permissions.canOverrideWorkflow && unresolvedBlockers.length ? (
            <label className="form-field transition-override">
              <span>
                Override reason <small>Partner/admin only</small>
              </span>
              <textarea
                rows={2}
                value={overrideReason}
                onChange={(event) => setOverrideReason(event.target.value)}
                placeholder="Explain why progression is authorised with controls outstanding."
                minLength={10}
              />
            </label>
          ) : null}

          {unresolvedBlockers.length > 0 && !canOverride ? (
            <p className="transition-guidance">
              <AlertTriangle size={14} aria-hidden="true" />{' '}
              {unresolvedBlockers.length} control
              {unresolvedBlockers.length === 1 ? '' : 's'} still outstanding.
            </p>
          ) : null}
          {error ? (
            <div className="form-alert" role="alert">
              {error}
            </div>
          ) : null}
          <div className="transition-actions">
            <button
              className="button button--secondary"
              type="button"
              onClick={closeConfirmation}
            >
              Cancel
            </button>
            <button
              className="button button--primary"
              type="submit"
              disabled={!canSubmit}
            >
              {submitting ? 'Changing stage…' : 'Confirm transition'}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
