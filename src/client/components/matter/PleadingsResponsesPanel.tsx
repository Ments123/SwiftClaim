import { AlertTriangle, CalendarClock, FileText, Scale } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';

import { request, type PleadingsWorkspace } from '../../api.js';

const StatementDialog = lazy(() => import('./PleadingsDialogs.js').then((module) => ({ default: module.StatementDialog })));
const DeadlineReviewDialog = lazy(() => import('./PleadingsDialogs.js').then((module) => ({ default: module.DeadlineReviewDialog })));
const DefaultReviewDialog = lazy(() => import('./PleadingsDialogs.js').then((module) => ({ default: module.DefaultReviewDialog })));
const AmendmentAuthorityDialog = lazy(() => import('./PleadingsDialogs.js').then((module) => ({ default: module.AmendmentAuthorityDialog })));

interface Props {
  matterId: string;
  proceedingId: string;
  initialWorkspace?: PleadingsWorkspace;
}

function label(value: string): string {
  return value.replaceAll('_', ' ').replace(/^./, (first) => first.toUpperCase());
}

function date(value: string | null): string {
  if (!value) return 'Date requires review';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00.000Z`));
}

const reviewLabels = {
  review_incomplete: 'Review incomplete',
  blockers_recorded: 'Blockers recorded',
  human_review_completed: 'Human review completed',
};

export function PleadingsResponsesPanel({ matterId, proceedingId, initialWorkspace }: Props) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!initialWorkspace);
  const [command, setCommand] = useState<'statement' | 'deadline' | 'default' | 'amendment' | null>(null);
  const [trackId, setTrackId] = useState<string | null>(null);

  const refresh = async () => {
    const next = await request<PleadingsWorkspace>(
      `/api/matters/${matterId}/proceedings/${proceedingId}/pleadings`,
    );
    setWorkspace(next);
  };

  useEffect(() => {
    if (initialWorkspace) return;
    const controller = new AbortController();
    request<PleadingsWorkspace>(
      `/api/matters/${matterId}/proceedings/${proceedingId}/pleadings`,
      { signal: controller.signal },
    ).then(setWorkspace).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Workspace unavailable.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [initialWorkspace, matterId, proceedingId]);

  if (loading) return <div className="pleadings-state">Loading pleading response records…</div>;
  if (error) return <div className="pleadings-state is-error"><AlertTriangle size={20} />{error}</div>;
  if (!workspace?.tracks.length) return <div className="pleadings-state"><Scale size={24} /><strong>No response tracks</strong><span>Open a track for each defendant from exact claim and service sources.</span></div>;

  return <div className="pleadings-response-view">
    <header className="pleadings-response-header">
      <div><span className="eyebrow">Per-defendant governed ledger</span><h3>Pleadings & responses</h3>
        <p>Dates are qualified projections or retained court dates—not automated legal conclusions.</p></div>
    </header>
    <div className="pleadings-track-list">
      {workspace.tracks.map((track) => {
        const nearest = track.deadlines.find(({ outcome }) => outcome !== 'superseded');
        const review = track.defaultReviews[0];
        return <article className="pleadings-track" key={track.id}>
          <header><div><span>{label(track.regime)}</span><h4>{track.defendant?.name ?? 'Defendant not labelled'}</h4></div>
            <div className="pleading-track-actions"><strong className="pleading-state">{label(track.currentState)}</strong>
              {workspace.permissions.canPrepare ? <button className="button button--secondary button--small" type="button" onClick={() => { setTrackId(track.id); setCommand('statement'); }}>Add statement</button> : null}
              {workspace.permissions.canRecordExternal ? <button className="button button--secondary button--small" type="button" onClick={() => { setTrackId(track.id); setCommand('deadline'); }}>Review response date</button> : null}
              {workspace.permissions.canReviewDefault ? <button className="button button--secondary button--small" type="button" onClick={() => { setTrackId(track.id); setCommand('default'); }}>Default review</button> : null}
              {workspace.permissions.canRecordAmendmentAuthority && track.statements.length ? <button className="button button--secondary button--small" type="button" onClick={() => { setTrackId(track.id); setCommand('amendment'); }}>Amendment authority</button> : null}
            </div></header>
          <div className="pleading-summary-grid">
            <div><CalendarClock size={18} /><span>Nearest response date</span><strong>{date(nearest?.projectedDate ?? null)}</strong>
              <small>{nearest?.outcome === 'projected' ? 'Projected from reviewed service facts' : nearest?.outcome === 'source_date' ? 'Date from retained source' : 'Manual court period required'}</small></div>
            <div><FileText size={18} /><span>Current statements</span><strong>{track.statements.length || 'None retained'}</strong><small>Filing and service remain separate events</small></div>
            <div className={review?.outcome === 'blockers_recorded' ? 'has-warning' : ''}><AlertTriangle size={18} /><span>Default review</span><strong>{review ? reviewLabels[review.outcome] : 'Review not started'}</strong><small>{review?.blockers[0] ?? 'Human checklist required'}</small></div>
          </div>
          {track.statements.length ? <div className="pleading-statement-list" aria-label="Current statements of case">
            {track.statements.map((statement) => {
              const current = statement.currentVersion;
              if (!current) return null;
              const authority = statement.amendmentAuthorities[0];
              const source = workspace.sources.documents.find(({ id }) => id === current.documentVersionId);
              return <section key={statement.id} className="pleading-statement-row">
                <div><strong>{label(current.statementType)} · version {current.versionNumber}</strong>
                  <small>{source?.title ?? 'Exact document version retained'}</small></div>
                <div className="pleading-statement-facts">
                  <span>{label(statement.projection.filingState)}</span>
                  <span>{label(statement.projection.serviceState)}</span>
                  <span>Statement of truth: {label(current.statementOfTruthStatus)}</span>
                  <span>Amendment authority: {authority ? label(authority.route) : 'None recorded'}</span>
                </div>
              </section>;
            })}
          </div> : null}
          {nearest ? <footer><span>{label(nearest.kind)} · {nearest.sourceTitle || 'Source review required'}</span>{nearest.sourceUrl ? <a href={nearest.sourceUrl} target="_blank" rel="noreferrer">View rule source</a> : null}</footer> : null}
        </article>;
      })}
    </div>
    {workspace.tracks.find(({ id }) => id === trackId) ? <Suspense fallback={null}>{(() => {
      const track = workspace.tracks.find(({ id }) => id === trackId)!;
      const shared = { open: Boolean(command), matterId, proceedingId, track, workspace,
        onClose: () => { setCommand(null); setTrackId(null); }, onSaved: refresh };
      if (command === 'statement') return <StatementDialog {...shared} />;
      if (command === 'deadline') return <DeadlineReviewDialog {...shared} />;
      if (command === 'default') return <DefaultReviewDialog {...shared} />;
      if (command === 'amendment') return <AmendmentAuthorityDialog {...shared} />;
      return null;
    })()}</Suspense> : null}
  </div>;
}
