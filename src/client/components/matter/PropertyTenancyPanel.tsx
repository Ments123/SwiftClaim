import {
  AlertTriangle,
  Building2,
  CalendarDays,
  Home,
  MapPin,
  ShieldCheck,
  WalletCards,
} from 'lucide-react';

import type { MatterIntakeProfile } from '../../api.js';

interface PropertyTenancyPanelProps {
  profile: MatterIntakeProfile | null | undefined;
  loading: boolean;
  error: string;
  onRetry: () => void;
}

export function PropertyTenancyPanel({
  profile,
  loading,
  error,
  onRetry,
}: PropertyTenancyPanelProps) {
  return (
    <section className="surface tab-surface intake-profile-panel" aria-labelledby="property-tenancy-title">
      <header className="section-header section-header--page">
        <div><span className="eyebrow">Canonical claim premises</span><h2 id="property-tenancy-title">Property & tenancy</h2></div>
      </header>

      {loading ? <div className="profile-skeleton" aria-label="Loading property and tenancy profile"><div className="skeleton" /><div className="skeleton" /></div> : null}
      {!loading && error ? (
        <div className="profile-state profile-state--error" role="alert">
          <AlertTriangle size={20} aria-hidden="true" />
          <span><strong>Profile unavailable</strong><p>{error}</p></span>
          <button className="button button--secondary button--small" type="button" onClick={onRetry}>Retry profile</button>
        </div>
      ) : null}
      {!loading && !error && profile === null ? (
        <div className="profile-state"><Building2 size={20} aria-hidden="true" /><span><strong>Legacy matter profile</strong><p>This matter has no property and tenancy profile created by SwiftClaim intake.</p></span></div>
      ) : null}

      {!loading && !error && profile ? (
        <>
          <div className="property-profile-hero">
            <span className="property-profile-hero__icon"><Home size={23} aria-hidden="true" /></span>
            <div>
              <span className="eyebrow">Claim property · {profile.property.propertyType}</span>
              <h2>{profile.property.addressLine1}</h2>
              <p>{[profile.property.addressLine2, profile.property.city, profile.property.county, profile.property.postcode, profile.property.country].filter(Boolean).join(', ')}</p>
            </div>
            <span className="profile-evidence-chip"><ShieldCheck size={14} aria-hidden="true" /> Linked at conversion</span>
          </div>

          <div className="property-tenancy-grid">
            <article className="profile-fact-card">
              <header><Building2 size={18} aria-hidden="true" /><span><small>Respondent landlord</small><h3>{profile.landlord.name}</h3></span></header>
              <dl>
                <div><dt>Organisation type</dt><dd>{title(profile.landlord.kind)}</dd></div>
                <div><dt>Linked property</dt><dd>{profile.property.postcode}</dd></div>
              </dl>
            </article>

            <article className="profile-fact-card">
              <header><WalletCards size={18} aria-hidden="true" /><span><small>Tenancy</small><h3>{title(profile.tenancy.tenancyType)}</h3></span></header>
              <dl>
                <div><dt>Rent</dt><dd>{formatMoney(profile.tenancy.rentMinor, profile.tenancy.currency)}</dd></div>
                <div><dt>Frequency</dt><dd>{title(profile.tenancy.rentFrequency)}</dd></div>
              </dl>
            </article>
          </div>

          <section className="profile-subsection" aria-labelledby="tenancy-dates-title">
            <header><span><small>Date-only source facts</small><h3 id="tenancy-dates-title">Tenancy & occupancy dates</h3></span></header>
            <div className="tenancy-date-grid">
              <DateFact label="Tenancy started" value={profile.tenancy.startedOn} />
              <DateFact label="Tenancy ended" value={profile.tenancy.endedOn} />
              <DateFact label="Occupancy started" value={profile.tenancy.occupancyStartedOn} />
              <DateFact label="Occupancy ended" value={profile.tenancy.occupancyEndedOn} />
            </div>
          </section>

          <div className="profile-source-note"><MapPin size={16} aria-hidden="true" /><span><strong>Source enquiry {profile.enquiryReference}</strong><small>Property, landlord and tenancy records were linked atomically when the accepted enquiry became this matter.</small></span></div>
        </>
      ) : null}
    </section>
  );
}

function DateFact({ label, value }: { label: string; value: string | null }) {
  return <article><CalendarDays size={16} aria-hidden="true" /><span><small>{label}</small><strong>{value ? formatDateOnly(value) : 'Not recorded'}</strong></span></article>;
}

function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
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

function title(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}
