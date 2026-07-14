import {
  Accessibility,
  AlertTriangle,
  CheckCircle2,
  Languages,
  Mail,
  MapPin,
  Phone,
  Plus,
  ShieldCheck,
  UserRound,
  UsersRound,
} from 'lucide-react';

import type { MatterIntakeProfile, Party } from '../../api.js';

interface ClientHouseholdPanelProps {
  profile: MatterIntakeProfile | null | undefined;
  loading: boolean;
  error: string;
  parties: Party[];
  canWrite: boolean;
  onAddParty: () => void;
  onRetry: () => void;
}

function label(value: string): string {
  return value.replaceAll('_', ' ');
}

export function ClientHouseholdPanel({
  profile,
  loading,
  error,
  parties,
  canWrite,
  onAddParty,
  onRetry,
}: ClientHouseholdPanelProps) {
  return (
    <section className="surface tab-surface intake-profile-panel" aria-labelledby="client-household-title">
      <header className="section-header section-header--page">
        <div>
          <span className="eyebrow">Canonical claimant record</span>
          <h2 id="client-household-title">Client & household</h2>
        </div>
        {canWrite ? (
          <button className="button button--primary button--small" type="button" onClick={onAddParty}>
            <Plus size={16} aria-hidden="true" /> Add party
          </button>
        ) : null}
      </header>

      {loading ? <ProfileSkeleton label="Loading client and household profile" /> : null}
      {!loading && error ? (
        <div className="profile-state profile-state--error" role="alert">
          <AlertTriangle size={20} aria-hidden="true" />
          <span><strong>Profile unavailable</strong><p>{error}</p></span>
          <button className="button button--secondary button--small" type="button" onClick={onRetry}>Retry profile</button>
        </div>
      ) : null}
      {!loading && !error && profile === null ? (
        <div className="profile-state">
          <UsersRound size={20} aria-hidden="true" />
          <span><strong>Legacy matter profile</strong><p>This matter was not opened through SwiftClaim intake. Existing matter parties remain available below.</p></span>
        </div>
      ) : null}

      {!loading && !error && profile ? (
        <>
          <div className="canonical-client-grid">
            <article className="canonical-client-card">
              <header>
                <span className="profile-avatar"><UserRound size={22} aria-hidden="true" /></span>
                <span>
                  <small>{profile.enquiryReference}</small>
                  <h2>{profile.client.displayName}</h2>
                  <p>{profile.client.dateOfBirth ? `Born ${formatDateOnly(profile.client.dateOfBirth)}` : 'Date of birth not recorded'}</p>
                </span>
              </header>
              <ul className="profile-contact-list">
                <li><Mail size={14} aria-hidden="true" /><span><small>Email</small><strong>{profile.client.email || 'Not recorded'}</strong></span></li>
                <li><Phone size={14} aria-hidden="true" /><span><small>Telephone</small><strong>{profile.client.phone || 'Not recorded'}</strong></span></li>
                <li><ShieldCheck size={14} aria-hidden="true" /><span><small>Preferred channel</small><strong>{label(profile.client.preferredChannel)}</strong></span></li>
              </ul>
              <div className="profile-control-chips" aria-label="Onboarding controls">
                <span className={`profile-control-chip profile-control-chip--${profile.onboarding.identityStatus}`}><CheckCircle2 size={13} aria-hidden="true" /> Identity {label(profile.onboarding.identityStatus)}</span>
                <span>Client care {label(profile.onboarding.clientCareStatus)}</span>
                <span>Authority {label(profile.onboarding.authorityStatus)}</span>
                <span>Funding {label(profile.onboarding.fundingStatus)}</span>
              </div>
            </article>

            <aside className="controlled-contact-card" aria-labelledby="controlled-contact-title">
              <header><ShieldCheck size={19} aria-hidden="true" /><span><small>Controlled contact</small><h3 id="controlled-contact-title">Client needs & safe communication</h3></span></header>
              <dl>
                <div><dt>Safe contact instructions</dt><dd>{profile.client.safeContactInstructions || 'No restrictions recorded.'}</dd></div>
                <div><dt>Vulnerability</dt><dd>{profile.onboarding.vulnerabilitySummary || 'None recorded.'}</dd></div>
                <div><dt><Languages size={13} aria-hidden="true" /> Interpreter</dt><dd>{profile.client.interpreterLanguage || 'Not required'}</dd></div>
                <div><dt><Accessibility size={13} aria-hidden="true" /> Accessibility</dt><dd>{profile.client.accessibilityNeeds || 'None recorded.'}</dd></div>
              </dl>
            </aside>
          </div>

          <section className="profile-subsection" aria-labelledby="household-title">
            <header><span><small>Occupants and participants</small><h3 id="household-title">Household</h3></span><span className="count-badge">{profile.householdMembers.length}</span></header>
            {profile.householdMembers.length ? (
              <div className="household-profile-grid">
                {profile.householdMembers.map((member) => (
                  <article className="household-profile-card" key={member.id}>
                    <header><span className="person-icon"><UserRound size={17} aria-hidden="true" /></span><span><small>{member.relationship}</small><h3>{member.displayName}</h3></span></header>
                    <div className="profile-control-chips"><span>{member.currentlyOccupies ? 'Current occupant' : 'Former occupant'}</span>{member.claimParticipant ? <span className="profile-control-chip--complete">Claim participant</span> : null}</div>
                    <dl>
                      <div><dt>Vulnerability</dt><dd>{member.vulnerabilitySummary || 'None recorded.'}</dd></div>
                      <div><dt>Accessibility</dt><dd>{member.accessibilityNeeds || 'None recorded.'}</dd></div>
                    </dl>
                  </article>
                ))}
              </div>
            ) : <p className="profile-empty-copy">No additional household members were recorded during onboarding.</p>}
          </section>
        </>
      ) : null}

      <PartyRegister parties={parties} />
    </section>
  );
}

function PartyRegister({ parties }: { parties: Party[] }) {
  return (
    <section className="profile-subsection profile-subsection--parties" aria-labelledby="matter-parties-title">
      <header><span><small>Working contact register</small><h3 id="matter-parties-title">All matter participants</h3></span><span className="count-badge">{parties.length}</span></header>
      {parties.length ? (
        <div className="people-grid">
          {parties.map((party) => (
            <article className="person-card" key={party.id}>
              <div className="person-card__header"><span className="person-icon"><UserRound size={18} aria-hidden="true" /></span><span><small>{party.kind}</small><strong>{party.name}</strong></span></div>
              {party.organisation ? <p>{party.organisation}</p> : null}
              <ul>
                {party.email ? <li><Mail size={14} aria-hidden="true" /> {party.email}</li> : null}
                {party.phone ? <li><Phone size={14} aria-hidden="true" /> {party.phone}</li> : null}
                {party.address ? <li><MapPin size={14} aria-hidden="true" /> {party.address}</li> : null}
              </ul>
              {party.externalId ? <footer>Legacy ID · {party.externalId}</footer> : null}
            </article>
          ))}
        </div>
      ) : <p className="profile-empty-copy">No matter participants have been recorded.</p>}
    </section>
  );
}

function ProfileSkeleton({ label: ariaLabel }: { label: string }) {
  return <div className="profile-skeleton" aria-label={ariaLabel}><div className="skeleton" /><div className="skeleton" /></div>;
}

function formatDateOnly(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
