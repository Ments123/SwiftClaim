import {
  AlertTriangle,
  ArrowRight,
  ClipboardList,
  Plus,
  Search,
  ShieldAlert,
  UserRound,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';

import {
  ApiError,
  jsonBody,
  request,
  type CurrentUser,
  type EnquiryListItem,
  type TeamMember,
} from '../api.js';
import { Dialog } from '../components/Dialog.js';

interface IntakeQueuePageProps {
  user: CurrentUser;
  onOpenEnquiry: (enquiryId: string) => void;
}

function statusLabel(status: EnquiryListItem['status']): string {
  return status.replaceAll('_', ' ');
}

function address(enquiry: EnquiryListItem): string {
  return [
    enquiry.property.addressLine1,
    enquiry.property.city,
    enquiry.property.postcode,
  ]
    .filter(Boolean)
    .join(', ');
}

export function IntakeQueuePage({
  user,
  onOpenEnquiry,
}: IntakeQueuePageProps) {
  const [enquiries, setEnquiries] = useState<EnquiryListItem[]>();
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [assignee, setAssignee] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setError('');
      const [enquiryResponse, userResponse] = await Promise.all([
        request<{ enquiries: EnquiryListItem[] }>('/api/enquiries', { signal }),
        request<{ users: TeamMember[] }>('/api/users', { signal }),
      ]);
      setEnquiries(enquiryResponse.enquiries);
      setTeam(userResponse.users);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setError(
        reason instanceof Error ? reason.message : 'The enquiry queue is unavailable.',
      );
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (enquiries ?? []).filter((enquiry) => {
      if (status !== 'all' && enquiry.status !== status) return false;
      if (assignee !== 'all' && enquiry.assignedTo.id !== assignee) return false;
      if (!query) return true;
      return [
        enquiry.reference,
        enquiry.client.displayName,
        enquiry.property.addressLine1,
        enquiry.property.postcode,
        enquiry.landlord?.name ?? '',
      ].some((value) => value.toLowerCase().includes(query));
    });
  }, [assignee, enquiries, search, status]);

  const counts = useMemo(
    () => ({
      new: (enquiries ?? []).filter((item) => item.status === 'new').length,
      assessment: (enquiries ?? []).filter((item) => item.status === 'assessment')
        .length,
      accepted: (enquiries ?? []).filter((item) => item.status === 'accepted').length,
      urgent: (enquiries ?? []).filter((item) =>
        ['urgent', 'critical'].includes(item.urgency),
      ).length,
    }),
    [enquiries],
  );

  if (!enquiries && !error) {
    return (
      <main className="page intake-queue-page" aria-label="Loading enquiries">
        <div className="skeleton skeleton--heading" />
        <div className="intake-stat-grid">
          {Array.from({ length: 4 }, (_, index) => (
            <div className="intake-stat skeleton" key={index} />
          ))}
        </div>
      </main>
    );
  }

  if (!enquiries) {
    return (
      <main className="page page-state">
        <ShieldAlert size={34} aria-hidden="true" />
        <h1>We could not load enquiries</h1>
        <p>{error}</p>
        <button className="button button--primary" type="button" onClick={() => void load()}>
          Try again
        </button>
      </main>
    );
  }

  return (
    <main className="page intake-queue-page">
      <header className="intake-queue-header">
        <div>
          <span className="eyebrow">Claimant intake</span>
          <h1>Housing Conditions enquiries</h1>
          <p>
            Triage prospective clients, control conflicts and move accepted claims
            into governed matters.
          </p>
        </div>
        {user.permissions.canWriteIntake ? (
          <button
            className="button button--primary"
            type="button"
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={17} aria-hidden="true" /> New enquiry
          </button>
        ) : null}
      </header>

      <section className="intake-stat-grid" aria-label="Enquiry summary">
        <article className="intake-stat">
          <span className="intake-stat__icon"><ClipboardList size={18} /></span>
          <strong>{counts.new}</strong>
          <span>New</span>
          <small>Awaiting triage</small>
        </article>
        <article className="intake-stat">
          <span className="intake-stat__icon"><UserRound size={18} /></span>
          <strong>{counts.assessment}</strong>
          <span>Assessment</span>
          <small>Legal review</small>
        </article>
        <article className="intake-stat">
          <span className="intake-stat__icon"><ArrowRight size={18} /></span>
          <strong>{counts.accepted}</strong>
          <span>Accepted</span>
          <small>Onboarding</small>
        </article>
        <article className="intake-stat intake-stat--urgent">
          <span className="intake-stat__icon"><AlertTriangle size={18} /></span>
          <strong>{counts.urgent}</strong>
          <span>{counts.urgent === 1 ? '1 urgent' : `${counts.urgent} urgent`}</span>
          <small>Urgent or critical</small>
        </article>
      </section>

      <section className="surface intake-queue-surface">
        <div className="intake-filters">
          <label className="intake-search">
            <span className="sr-only">Search enquiries</span>
            <Search size={18} aria-hidden="true" />
            <input
              aria-label="Search enquiries"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Client, reference, property or landlord…"
            />
          </label>
          <label className="compact-select">
            <span>Status</span>
            <select
              aria-label="Status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="new">New</option>
              <option value="assessment">Assessment</option>
              <option value="accepted">Accepted</option>
              <option value="declined">Declined</option>
              <option value="referred">Referred</option>
              <option value="converted">Converted</option>
            </select>
          </label>
          <label className="compact-select">
            <span>Assignee</span>
            <select
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
            >
              <option value="all">All assignees</option>
              {team.map((member) => (
                <option value={member.id} key={member.id}>{member.name}</option>
              ))}
            </select>
          </label>
          <span className="queue-result-count">{filtered.length} shown</span>
        </div>

        {filtered.length ? (
          <div className="enquiry-table">
            <div className="enquiry-table__head" aria-hidden="true">
              <span>Enquiry</span><span>Property & landlord</span><span>Owner</span><span>Status</span><span />
            </div>
            <ul className="enquiry-table__body" aria-label="Enquiries">
              {filtered.map((item) => (
                <li key={item.id}>
                  <button
                    className="enquiry-row"
                    type="button"
                    onClick={() => onOpenEnquiry(item.id)}
                  >
                    <span className="enquiry-row__client">
                      <small>{item.reference}</small>
                      <strong>{item.client.displayName}</strong>
                      <em>{item.urgency} priority</em>
                    </span>
                    <span>
                      <strong>{address(item)}</strong>
                      <small>{item.landlord?.name ?? 'Landlord not recorded'}</small>
                    </span>
                    <span>
                      <strong>{item.assignedTo.name}</strong>
                      <small>{item.assignedTo.role}</small>
                    </span>
                    <span className={`intake-status intake-status--${item.status}`}>
                      {statusLabel(item.status)}
                    </span>
                    <ArrowRight size={17} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="empty-state intake-empty">
            <Search size={26} aria-hidden="true" />
            <strong>No enquiries match these filters</strong>
            <p>Clear the search or broaden the status and assignee filters.</p>
          </div>
        )}
      </section>

      <NewEnquiryDialog
        open={createOpen}
        team={team}
        onClose={() => setCreateOpen(false)}
        onCreated={onOpenEnquiry}
      />
    </main>
  );
}

function NewEnquiryDialog({
  open,
  team,
  onClose,
  onCreated,
}: {
  open: boolean;
  team: TeamMember[];
  onClose: () => void;
  onCreated: (enquiryId: string) => void;
}) {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await request<{ enquiry: EnquiryListItem }>('/api/enquiries', {
        method: 'POST',
        body: jsonBody({
          source: 'Direct',
          referrerName: '',
          client: {
            givenName: form.get('givenName'),
            familyName: form.get('familyName'),
            email: form.get('email'),
            phone: form.get('phone'),
            preferredChannel: form.get('preferredChannel'),
          },
          property: {
            addressLine1: form.get('addressLine1'),
            addressLine2: '',
            city: form.get('city'),
            county: '',
            postcode: form.get('postcode'),
            country: 'England',
            propertyType: form.get('propertyType'),
          },
          landlordName: form.get('landlordName'),
          summary: form.get('summary'),
          defectSummary: form.get('defectSummary'),
          desiredOutcome: form.get('desiredOutcome'),
          currentlyOccupied: form.get('currentlyOccupied') === 'on',
          urgency: form.get('urgency'),
          immediateSafetyConcerns: form.get('immediateSafetyConcerns'),
          communicationRequirements: form.get('communicationRequirements'),
          assignedUserId: form.get('assignedUserId'),
        }),
      });
      onClose();
      onCreated(response.enquiry.id);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Enquiry creation failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="New Housing Conditions enquiry"
      description="Capture only the facts needed to begin conflict and legal assessment controls."
      onClose={onClose}
      size="wide"
    >
      <form className="form-grid" onSubmit={submit}>
        <label className="form-field"><span>First name</span><input name="givenName" required /></label>
        <label className="form-field"><span>Last name</span><input name="familyName" required /></label>
        <label className="form-field"><span>Email</span><input name="email" type="email" /></label>
        <label className="form-field"><span>Phone</span><input name="phone" /></label>
        <label className="form-field"><span>Preferred contact</span><select name="preferredChannel" defaultValue="email"><option value="email">Email</option><option value="phone">Phone</option><option value="sms">SMS</option><option value="post">Post</option></select></label>
        <label className="form-field"><span>Assigned to</span><select name="assignedUserId" defaultValue={team[0]?.id}>{team.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.role}</option>)}</select></label>
        <label className="form-field form-field--wide"><span>Address line 1</span><input name="addressLine1" required /></label>
        <label className="form-field"><span>City</span><input name="city" required /></label>
        <label className="form-field"><span>Postcode</span><input name="postcode" required /></label>
        <label className="form-field"><span>Property type</span><select name="propertyType" defaultValue="flat"><option value="house">House</option><option value="flat">Flat</option><option value="maisonette">Maisonette</option><option value="bungalow">Bungalow</option><option value="other">Other</option><option value="unknown">Unknown</option></select></label>
        <label className="form-field"><span>Landlord</span><input name="landlordName" required /></label>
        <label className="form-field form-field--wide"><span>Initial summary</span><textarea name="summary" rows={3} required /></label>
        <label className="form-field form-field--wide"><span>Reported defects</span><textarea name="defectSummary" rows={3} required /></label>
        <label className="form-field form-field--wide"><span>Desired outcome</span><textarea name="desiredOutcome" rows={2} /></label>
        <label className="form-field"><span>Urgency</span><select name="urgency" defaultValue="routine"><option value="routine">Routine</option><option value="priority">Priority</option><option value="urgent">Urgent</option><option value="critical">Critical</option></select></label>
        <label className="check-field"><input name="currentlyOccupied" type="checkbox" defaultChecked /><span>Client currently occupies the property</span></label>
        <label className="form-field form-field--wide"><span>Immediate safety concerns</span><textarea name="immediateSafetyConcerns" rows={2} /></label>
        <label className="form-field form-field--wide"><span>Communication requirements</span><textarea name="communicationRequirements" rows={2} /></label>
        {error ? <div className="form-alert form-field--wide" role="alert">{error}</div> : null}
        <div className="form-actions form-field--wide">
          <button className="button button--secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="button button--primary" type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create enquiry'}</button>
        </div>
      </form>
    </Dialog>
  );
}
