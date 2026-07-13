import { CalendarDays, ExternalLink, Info } from 'lucide-react';

import type { MatterLegalDeadline } from '../../api.js';

interface DeadlineCardProps {
  deadline: MatterLegalDeadline;
}

function formatDateOnly(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00.000Z`));
}

export function DeadlineCard({ deadline }: DeadlineCardProps) {
  return (
    <article className="legal-deadline-card">
      <header>
        <span className="legal-deadline-card__icon">
          <CalendarDays size={18} aria-hidden="true" />
        </span>
        <div>
          <span className={`deadline-status deadline-status--${deadline.status}`}>
            {deadline.status}
          </span>
          <h3>{deadline.title}</h3>
        </div>
        <time dateTime={deadline.dueDate}>
          <small>Due</small>
          <strong>{formatDateOnly(deadline.dueDate)}</strong>
        </time>
      </header>
      <dl className="legal-deadline-card__dates">
        <div>
          <dt>Confirmed trigger</dt>
          <dd>{formatDateOnly(deadline.triggerDate)}</dd>
        </div>
        <div>
          <dt>Rule</dt>
          <dd>{deadline.ruleKey}</dd>
        </div>
      </dl>
      <p className="legal-deadline-card__explanation">{deadline.explanation}</p>
      <footer>
        <span>
          <Info size={14} aria-hidden="true" /> Calculated date — verify before
          reliance
        </span>
        <a
          href={deadline.sourceUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={`Official source for ${deadline.title}`}
        >
          Official source <ExternalLink size={13} aria-hidden="true" />
        </a>
      </footer>
      <p className="legal-deadline-card__source">{deadline.sourceTitle}</p>
    </article>
  );
}
