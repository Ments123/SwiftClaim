import {
  AlertTriangle,
  Home,
  Plus,
  ShieldCheck,
  Trash2,
  UsersRound,
} from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';

import type {
  EnquiryDetail,
  IntakeOnboarding,
  IntakeReadiness,
  TeamMember,
} from '../../api.js';

const CONTROL_OPTIONS = [
  ['not_started', 'Not started'],
  ['pending', 'Pending'],
  ['complete', 'Complete'],
] as const;

function options(
  values: readonly (readonly [string, string])[] = CONTROL_OPTIONS,
) {
  return values.map(([value, label]) => <option value={value} key={value}>{label}</option>);
}

interface HouseholdDraft {
  formKey: string;
  displayName: string;
  relationship: string;
  currentlyOccupies: boolean;
  claimParticipant: boolean;
  vulnerabilitySummary: string;
  accessibilityNeeds: string;
}

export function OnboardingPanel({
  enquiry,
  onboarding,
  readiness,
  team,
  saving,
  onSave,
}: {
  enquiry: EnquiryDetail;
  onboarding: IntakeOnboarding | null;
  readiness: IntakeReadiness['onboarding'];
  team: TeamMember[];
  saving: boolean;
  onSave: (command: Record<string, unknown>) => Promise<void>;
}) {
  const nextHouseholdKey = useRef(1);
  const [householdMembers, setHouseholdMembers] = useState<HouseholdDraft[]>(
    () =>
      (onboarding?.householdMembers ?? []).map((member) => ({
        formKey: `existing-${member.id}`,
        displayName: member.displayName,
        relationship: member.relationship,
        currentlyOccupies: member.currentlyOccupies,
        claimParticipant: member.claimParticipant,
        vulnerabilitySummary: member.vulnerabilitySummary,
        accessibilityNeeds: member.accessibilityNeeds,
      })),
  );

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void onSave({
      expectedVersion: enquiry.version,
      identityStatus: form.get('identityStatus'),
      clientCareStatus: form.get('clientCareStatus'),
      authorityStatus: form.get('authorityStatus'),
      privacyStatus: form.get('privacyStatus'),
      fundingType: form.get('fundingType'),
      fundingStatus: form.get('fundingStatus'),
      signatureStatus: form.get('signatureStatus'),
      vulnerabilitySummary: form.get('vulnerabilitySummary'),
      accessibilityNeeds: form.get('accessibilityNeeds'),
      interpreterLanguage: form.get('interpreterLanguage') || null,
      safeContactInstructions: form.get('safeContactInstructions'),
      ownerUserId: form.get('ownerUserId'),
      supervisorUserId: form.get('supervisorUserId'),
      tenancy: {
        tenancyType: form.get('tenancyType'),
        startedOn: form.get('startedOn') || null,
        endedOn: form.get('endedOn') || null,
        rentMinor: Math.round(Number(form.get('rentPounds') || 0) * 100),
        currency: 'GBP',
        rentFrequency: form.get('rentFrequency'),
        occupancyStartedOn: form.get('occupancyStartedOn') || null,
        occupancyEndedOn: form.get('occupancyEndedOn') || null,
      },
      householdMembers: householdMembers.map((member) => ({
        displayName: String(
          form.get(`household:${member.formKey}:name`) ?? '',
        ).trim(),
        relationship: String(
          form.get(`household:${member.formKey}:relationship`) ?? '',
        ).trim(),
        currentlyOccupies: form.has(
          `household:${member.formKey}:occupies`,
        ),
        claimParticipant: form.has(
          `household:${member.formKey}:participant`,
        ),
        vulnerabilitySummary: form.get(
          `household:${member.formKey}:vulnerability`,
        ),
        accessibilityNeeds: form.get(
          `household:${member.formKey}:accessibility`,
        ),
      })),
    });
  };

  const addHouseholdMember = () => {
    setHouseholdMembers((current) => [
      ...current,
      {
        formKey: `new-${nextHouseholdKey.current++}`,
        displayName: '',
        relationship: '',
        currentlyOccupies: true,
        claimParticipant: false,
        vulnerabilitySummary: '',
        accessibilityNeeds: '',
      },
    ]);
  };

  if (enquiry.status !== 'accepted') {
    return (
      <section className="surface intake-panel" aria-labelledby="onboarding-title">
        <header className="intake-panel__header"><div><span className="eyebrow">Client opening controls</span><h2 id="onboarding-title">Onboarding</h2></div></header>
        <div className="human-control-note"><ShieldCheck size={20} /><div><strong>Acceptance required first</strong><p>Complete the reviewed legal decision before collecting formal client-care, identity, authority and funding statuses.</p></div></div>
      </section>
    );
  }

  const supervisors = team.filter((member) => ['partner', 'admin'].includes(member.role));
  return (
    <section className="surface intake-panel" aria-labelledby="onboarding-title">
      <header className="intake-panel__header">
        <div><span className="eyebrow">Client opening controls</span><h2 id="onboarding-title">Onboarding</h2></div>
        <span className={readiness.ready ? 'readiness-chip readiness-chip--ready' : 'readiness-chip'}><ShieldCheck size={14} /> {readiness.ready ? 'Complete' : `${readiness.blockers.length} blockers`}</span>
      </header>
      {readiness.blockers.length ? <ul className="blocker-list">{readiness.blockers.map((blocker) => <li key={blocker.key}><AlertTriangle size={15} /><span>{blocker.label}</span></li>)}</ul> : null}
      <form className="form-grid intake-form" onSubmit={submit}>
        <fieldset className="intake-subsection form-field--wide"><legend><ShieldCheck size={16} /> Compliance controls</legend><div className="form-grid">
          <label className="form-field"><span>Identity verification</span><select name="identityStatus" defaultValue={onboarding?.identityStatus ?? 'not_started'}>{options([...CONTROL_OPTIONS, ['failed', 'Failed']] as const)}</select></label>
          <label className="form-field"><span>Client care</span><select name="clientCareStatus" defaultValue={onboarding?.clientCareStatus ?? 'not_started'}>{options()}</select></label>
          <label className="form-field"><span>Authority to act</span><select name="authorityStatus" defaultValue={onboarding?.authorityStatus ?? 'not_started'}>{options()}</select></label>
          <label className="form-field"><span>Privacy information</span><select name="privacyStatus" defaultValue={onboarding?.privacyStatus ?? 'not_started'}>{options()}</select></label>
          <label className="form-field"><span>Funding type</span><select name="fundingType" defaultValue={onboarding?.fundingType ?? 'unconfirmed'}><option value="unconfirmed">Unconfirmed</option><option value="cfa">CFA</option><option value="legal_aid">Legal aid</option><option value="private">Private</option><option value="before_event">Before-the-event insurance</option><option value="trade_union">Trade union</option><option value="other">Other</option></select></label>
          <label className="form-field"><span>Funding status</span><select name="fundingStatus" defaultValue={onboarding?.fundingStatus ?? 'not_started'}>{options()}</select></label>
          <label className="form-field"><span>Signature status</span><select name="signatureStatus" defaultValue={onboarding?.signatureStatus ?? 'not_started'}><option value="not_started">Not started</option><option value="sent">Sent</option><option value="complete">Complete</option></select></label>
          <label className="form-field"><span>Matter owner</span><select name="ownerUserId" defaultValue={onboarding?.owner?.id ?? enquiry.assignedTo.id}>{team.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.role}</option>)}</select></label>
          <label className="form-field"><span>Supervisor</span><select name="supervisorUserId" defaultValue={onboarding?.supervisor?.id ?? supervisors[0]?.id}>{supervisors.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.role}</option>)}</select></label>
        </div></fieldset>
        <fieldset className="intake-subsection form-field--wide"><legend><UsersRound size={16} /> Client needs & household</legend><div className="form-grid">
          <label className="form-field form-field--wide"><span>Vulnerability summary</span><textarea name="vulnerabilitySummary" rows={2} defaultValue={onboarding?.vulnerabilitySummary ?? ''} /></label>
          <label className="form-field"><span>Accessibility needs</span><input name="accessibilityNeeds" defaultValue={onboarding?.accessibilityNeeds ?? ''} /></label>
          <label className="form-field"><span>Interpreter language</span><input name="interpreterLanguage" defaultValue={onboarding?.interpreterLanguage ?? ''} /></label>
          <label className="form-field form-field--wide"><span>Safe contact instructions</span><textarea name="safeContactInstructions" rows={2} defaultValue={onboarding?.safeContactInstructions ?? ''} /></label>
          <div className="household-editor form-field--wide">
            <div className="household-editor__header">
              <span><strong>Household members</strong><small>Record everyone affected, including any additional claim participants.</small></span>
              <button className="button button--secondary button--small" type="button" onClick={addHouseholdMember} disabled={householdMembers.length >= 50}><Plus size={15} aria-hidden="true" /> Add household member</button>
            </div>
            {householdMembers.length ? householdMembers.map((member, index) => {
              const prefix = `Household member ${index + 1}`;
              return (
                <fieldset className="household-member-card" key={member.formKey}>
                  <legend>{prefix}</legend>
                  <button className="household-member-card__remove" type="button" aria-label={`Remove ${prefix.toLowerCase()}`} onClick={() => setHouseholdMembers((current) => current.filter((item) => item.formKey !== member.formKey))}><Trash2 size={15} aria-hidden="true" /></button>
                  <div className="form-grid">
                    <label className="form-field"><span>Name</span><input aria-label={`${prefix} name`} name={`household:${member.formKey}:name`} defaultValue={member.displayName} minLength={2} required /></label>
                    <label className="form-field"><span>Relationship</span><input aria-label={`${prefix} relationship`} name={`household:${member.formKey}:relationship`} defaultValue={member.relationship} minLength={2} required /></label>
                    <label className="check-field"><input aria-label={`${prefix} currently occupies`} name={`household:${member.formKey}:occupies`} type="checkbox" defaultChecked={member.currentlyOccupies} /><span>Currently occupies</span></label>
                    <label className="check-field"><input aria-label={`${prefix} claim participant`} name={`household:${member.formKey}:participant`} type="checkbox" defaultChecked={member.claimParticipant} /><span>Claim participant</span></label>
                    <label className="form-field form-field--wide"><span>Vulnerability</span><textarea aria-label={`${prefix} vulnerability`} name={`household:${member.formKey}:vulnerability`} rows={2} defaultValue={member.vulnerabilitySummary} /></label>
                    <label className="form-field form-field--wide"><span>Accessibility needs</span><input aria-label={`${prefix} accessibility needs`} name={`household:${member.formKey}:accessibility`} defaultValue={member.accessibilityNeeds} /></label>
                  </div>
                </fieldset>
              );
            }) : <p className="household-editor__empty">No additional household members recorded.</p>}
          </div>
        </div></fieldset>
        <fieldset className="intake-subsection form-field--wide"><legend><Home size={16} /> Tenancy</legend><div className="form-grid">
          <label className="form-field"><span>Tenancy type</span><select name="tenancyType" defaultValue={onboarding?.tenancy?.tenancyType ?? 'unknown'}><option value="secure">Secure</option><option value="assured">Assured</option><option value="assured_shorthold">Assured shorthold</option><option value="introductory">Introductory</option><option value="flexible">Flexible</option><option value="leasehold">Leasehold</option><option value="licence">Licence</option><option value="other">Other</option><option value="unknown">Unknown</option></select></label>
          <label className="form-field"><span>Rent frequency</span><select name="rentFrequency" defaultValue={onboarding?.tenancy?.rentFrequency ?? 'monthly'}><option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option><option value="other">Other</option></select></label>
          <label className="form-field"><span>Tenancy started</span><input name="startedOn" type="date" defaultValue={onboarding?.tenancy?.startedOn ?? ''} /></label>
          <label className="form-field"><span>Tenancy ended</span><input name="endedOn" type="date" defaultValue={onboarding?.tenancy?.endedOn ?? ''} /></label>
          <label className="form-field"><span>Rent (£)</span><input name="rentPounds" type="number" min="0" step="0.01" defaultValue={(onboarding?.tenancy?.rentMinor ?? 0) / 100} /></label>
          <label className="form-field"><span>Occupancy started</span><input name="occupancyStartedOn" type="date" defaultValue={onboarding?.tenancy?.occupancyStartedOn ?? ''} /></label>
          <label className="form-field"><span>Occupancy ended</span><input name="occupancyEndedOn" type="date" defaultValue={onboarding?.tenancy?.occupancyEndedOn ?? ''} /></label>
        </div></fieldset>
        <div className="form-actions form-field--wide"><button className="button button--primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save onboarding'}</button></div>
      </form>
    </section>
  );
}
