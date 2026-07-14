import { AlertTriangle, CheckCircle2, Search, ShieldAlert } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import type { ConflictCheck, ConflictDecision, CurrentUser } from '../../api.js';

export function ConflictPanel({
  check,
  decision,
  user,
  busy,
  onRun,
  onDecide,
}: {
  check: ConflictCheck | null;
  decision: ConflictDecision | null;
  user: CurrentUser;
  busy: boolean;
  onRun: () => Promise<void>;
  onDecide: (command: Record<string, unknown>) => Promise<void>;
}) {
  const [selectedDecision, setSelectedDecision] = useState<
    'clear' | 'blocked' | 'cleared_with_override'
  >(check?.matchCount ? 'blocked' : 'clear');

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!check) return;
    const form = new FormData(event.currentTarget);
    void onDecide({
      checkId: check.id,
      decision: selectedDecision,
      reason: form.get('reason'),
    });
  };

  return (
    <section className="surface intake-panel" aria-labelledby="conflicts-title">
      <header className="intake-panel__header">
        <div><span className="eyebrow">Mandatory control</span><h2 id="conflicts-title">Conflicts</h2></div>
        <button className="button button--secondary button--small" type="button" disabled={busy} onClick={() => void onRun()}><Search size={15} /> {busy ? 'Searching…' : 'Run conflict check'}</button>
      </header>
      <div className="human-control-note">
        <ShieldAlert size={20} aria-hidden="true" />
        <div><strong>Human decision required</strong><p>SwiftClaim can identify potential matches, but it never clears a conflict automatically. An authorised fee earner must decide and give a reason.</p></div>
      </div>
      {!check ? (
        <div className="empty-state intake-empty"><Search size={26} /><strong>No conflict check has been run</strong><p>Search the firm’s matters, enquiries, contacts, properties and organisations.</p></div>
      ) : (
        <>
          <div className={`conflict-result ${check.matchCount ? 'conflict-result--matches' : 'conflict-result--clear'}`}>
            {check.matchCount ? <AlertTriangle size={20} /> : <CheckCircle2 size={20} />}
            <span><strong>{check.matchCount ? `${check.matchCount} potential ${check.matchCount === 1 ? 'match' : 'matches'}` : 'No potential matches found'}</strong><small>Checked by {check.runBy.name}. A decision is still required.</small></span>
          </div>
          {check.matches.length ? <div className="conflict-match-list">{check.matches.map((match, index) => <article key={`${match.source}-${index}`}><span>{match.source}</span><strong>{match.display}</strong><small>Matched on {match.matchedOn.join(', ')}</small></article>)}</div> : null}
          {decision ? (
            <div className="decision-evidence"><CheckCircle2 size={18} /><span><strong>{decision.decision.replaceAll('_', ' ')}</strong><small>{decision.reason} · {decision.decidedBy.name}</small></span></div>
          ) : user.permissions.canDecideIntake ? (
            <form className="form-grid intake-form" onSubmit={submit}>
              <fieldset className="choice-fieldset form-field--wide">
                <legend>Conflict decision</legend>
                <label><input type="radio" name="decision" value="clear" checked={selectedDecision === 'clear'} onChange={() => setSelectedDecision('clear')} disabled={check.matchCount > 0} /><span><strong>Clear</strong><small>Only available when no potential matches were found.</small></span></label>
                <label><input type="radio" name="decision" value="blocked" checked={selectedDecision === 'blocked'} onChange={() => setSelectedDecision('blocked')} /><span><strong>Blocked</strong><small>Do not proceed while the conflict remains.</small></span></label>
                {user.permissions.canOverrideConflict ? <label><input type="radio" name="decision" value="cleared_with_override" checked={selectedDecision === 'cleared_with_override'} onChange={() => setSelectedDecision('cleared_with_override')} /><span><strong>Clear with partner override</strong><small>Potential matches were reviewed and an authorised override is justified.</small></span></label> : null}
              </fieldset>
              <label className="form-field form-field--wide"><span>Decision reason</span><textarea name="reason" rows={3} required minLength={10} /></label>
              <div className="form-actions form-field--wide"><button className="button button--primary" type="submit" disabled={busy}>{busy ? 'Recording…' : 'Record conflict decision'}</button></div>
            </form>
          ) : <p className="locked-note">An authorised solicitor or partner must record the conflict decision.</p>}
        </>
      )}
    </section>
  );
}
