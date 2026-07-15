import { Eye, EyeOff, FileWarning, LockKeyhole, Scale } from 'lucide-react';

import type { OfferRecord } from '../../api.js';

const money = (minor: number | null) =>
  minor === null
    ? 'Terms only'
    : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(minor / 100);
const label = (value: string) =>
  value.replaceAll('_', ' ').replace(/^./, (character) => character.toUpperCase());

function OfferCard({ offer, protectedView }: { offer: OfferRecord; protectedView: boolean }) {
  const amount = offer.totalMinor ?? offer.damagesMinor ?? offer.costsMinor;
  return <article className={`offer-card ${protectedView ? 'offer-card--protected' : ''}`}>
    <header><div><span>{offer.offerReference} · {label(offer.direction)}</span><h4>{label(offer.offerType)}</h4></div><strong>{money(amount)}</strong></header>
    <p>{offer.scopeDescription}</p>
    {offer.worksTerms ? <div className="offer-terms"><strong>Works</strong><span>{offer.worksTerms}</span></div> : null}
    {offer.part36 ? <section className="part36-review"><header><Scale size={15} /><strong>Part 36 review</strong></header><dl><div><dt>Service</dt><dd>{offer.part36.serviceOn ?? 'Not confirmed'}</dd></div><div><dt>Projected end</dt><dd>{offer.part36.projectedPeriodEndOn ?? 'Awaiting review'}</dd></div><div><dt>Status</dt><dd>{label(offer.part36.validationStatus)}</dd></div></dl><p>{offer.part36.calculationExplanation || offer.part36.relevantPeriodBasis}</p><div><FileWarning size={14} /> Legal validity and effect require solicitor review.</div></section> : null}
  </article>;
}

interface Props {
  openOffers: OfferRecord[];
  protectedOffers: OfferRecord[] | null;
  protectedCount: number;
  canReadProtected: boolean;
  loadingProtected: boolean;
  protectedError: string;
  onLoadProtected: () => void;
}

export function OffersView({ openOffers, protectedOffers, protectedCount, canReadProtected, loadingProtected, protectedError, onLoadProtected }: Props) {
  return <div className="offers-view">
    <section><header className="quantum-view-header"><div><span className="eyebrow">Ordinary matter record</span><h3>Open offers</h3><p>Visible in the normal case position.</p></div></header>{openOffers.length ? <div className="offer-list">{openOffers.map((offer) => <OfferCard key={offer.id} offer={offer} protectedView={false} />)}</div> : <div className="quantum-empty"><Eye size={24} /><h4>No open offers</h4></div>}</section>
    <section className="protected-offer-zone"><header><span><LockKeyhole size={17} /> Protected negotiation material</span>{canReadProtected && protectedOffers === null ? <button className="button button--secondary button--small" type="button" onClick={onLoadProtected} disabled={loadingProtected}><EyeOff size={15} /> {loadingProtected ? 'Opening…' : `Open ${protectedCount} protected offer${protectedCount === 1 ? '' : 's'}`}</button> : null}</header><p>Part 36 and without-prejudice terms are loaded only after an authorised explicit action.</p>{protectedError ? <div className="inline-notice inline-notice--error" role="alert">{protectedError}</div> : null}{protectedOffers ? <div className="offer-list">{protectedOffers.map((offer) => <OfferCard key={offer.id} offer={offer} protectedView />)}</div> : null}{!canReadProtected ? <small>You are not authorised to open protected offer terms.</small> : null}</section>
  </div>;
}
