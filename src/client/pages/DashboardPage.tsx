import {
  AlertTriangle,
  ArrowRight,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Plus,
  Search,
  ShieldAlert,
  UserRound,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

import {
  ApiError,
  jsonBody,
  request,
  type CurrentUser,
  type DashboardData,
  type MatterSummary,
} from '../api.js';
import { Dialog } from '../components/Dialog.js';

interface DashboardPageProps {
  user: CurrentUser;
  onOpenMatter: (matterId: string) => void;
}

function formatDate(value: string | null) {
  if (!value) return 'No deadline';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function urgency(value: string) {
  const due = new Date(value);
  const now = new Date('2026-07-13T12:00:00.000Z');
  if (due < now) return 'Overdue';
  const hours = Math.ceil((due.getTime() - now.getTime()) / 3_600_000);
  return hours <= 48 ? `Due in ${hours}h` : formatDate(value);
}

export function DashboardPage({ user, onOpenMatter }: DashboardPageProps) {
  const [data, setData] = useState<DashboardData>();
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<MatterSummary[]>();
  const [searching, setSearching] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const load = async () => {
    try {
      setError('');
      setData(await request<DashboardData>('/api/dashboard'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Dashboard unavailable.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const matters = searchResults ?? data?.recentMatters ?? [];
  const firstName = user.name.split(' ')[0];

  const searchMatters = async (event: FormEvent) => {
    event.preventDefault();
    if (!search.trim()) {
      setSearchResults(undefined);
      return;
    }
    setSearching(true);
    try {
      const response = await request<{ matters: MatterSummary[] }>(
        `/api/matters?q=${encodeURIComponent(search.trim())}`,
      );
      setSearchResults(response.matters);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Search failed.');
    } finally {
      setSearching(false);
    }
  };

  if (!data && !error) {
    return (
      <main className="page page--dashboard">
        <div className="skeleton skeleton--heading" />
        <div className="summary-grid">
          {Array.from({ length: 4 }, (_, index) => <div className="summary-card skeleton" key={index} />)}
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="page page-state">
        <ShieldAlert size={34} aria-hidden="true" />
        <h1>We could not load your workspace</h1>
        <p>{error}</p>
        <button className="button button--primary" type="button" onClick={() => void load()}>Try again</button>
      </main>
    );
  }

  return (
    <main className="page page--dashboard">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">Monday, 13 July</span>
          <h1>Good afternoon, {firstName}</h1>
          <p>Here is the work that needs attention across your litigation matters.</p>
        </div>
        {user.permissions.canCreateMatter ? (
          <button className="button button--primary" type="button" onClick={() => setCreateOpen(true)}>
            <Plus size={17} aria-hidden="true" /> New matter
          </button>
        ) : null}
      </header>

      <form className="global-search" onSubmit={searchMatters} role="search">
        <Search size={19} aria-hidden="true" />
        <label className="sr-only" htmlFor="matter-search">Search matters</label>
        <input
          id="matter-search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            if (!event.target.value) setSearchResults(undefined);
          }}
          placeholder="Search by reference, client, matter or owner…"
        />
        <button type="submit">{searching ? 'Searching…' : 'Search'}</button>
      </form>

      {error ? <div className="inline-notice inline-notice--error" role="alert">{error}</div> : null}

      <section className="summary-grid" aria-label="Work summary">
        <article className="summary-card">
          <span className="summary-icon summary-icon--blue"><BriefcaseBusiness size={19} /></span>
          <div><strong>{data.summary.activeMatters}</strong><span>Active matters</span></div>
          <small>Accessible to you</small>
        </article>
        <article className="summary-card summary-card--attention">
          <span className="summary-icon summary-icon--red"><Clock3 size={19} /></span>
          <div><strong>{data.summary.overdueTasks}</strong><span>Overdue deadlines</span></div>
          <small>{data.summary.overdueTasks} overdue</small>
        </article>
        <article className="summary-card">
          <span className="summary-icon summary-icon--amber"><CalendarClock size={19} /></span>
          <div><strong>{data.summary.dueThisWeek}</strong><span>Due next 7 days</span></div>
          <small>Plan the week</small>
        </article>
        <article className="summary-card">
          <span className="summary-icon summary-icon--purple"><AlertTriangle size={19} /></span>
          <div><strong>{data.summary.highRiskMatters}</strong><span>High-risk matters</span></div>
          <small>Keep under review</small>
        </article>
      </section>

      <div className="dashboard-columns">
        <section className="surface urgent-work">
          <header className="section-header">
            <div><span className="eyebrow">Priorities</span><h2>Urgent work</h2></div>
            <span className="count-badge">{data.urgentTasks.length}</span>
          </header>
          <div className="urgent-list">
            {data.urgentTasks.length ? data.urgentTasks.map((task) => (
              <button className="urgent-row" type="button" key={task.id} onClick={() => onOpenMatter(task.matterId)}>
                <span className={`priority-marker priority-marker--${task.priority}`} />
                <span className="urgent-row__main">
                  <strong>{task.title}</strong>
                  <small>{task.matter.title} · {task.assignee.name}</small>
                </span>
                <span className={urgency(task.dueAt) === 'Overdue' ? 'due-chip due-chip--overdue' : 'due-chip'}>
                  {urgency(task.dueAt)}
                </span>
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            )) : (
              <div className="empty-state empty-state--compact">
                <CheckCircle2 size={25} /><strong>No urgent work</strong><p>Your immediate queue is clear.</p>
              </div>
            )}
          </div>
        </section>

        <aside className="surface workload-card">
          <header className="section-header"><div><span className="eyebrow">Team</span><h2>Your caseload</h2></div></header>
          <div className="caseload-ring" aria-label={`${data.summary.activeMatters} active matters`}>
            <span><strong>{data.summary.activeMatters}</strong><small>active</small></span>
          </div>
          <dl className="workload-facts">
            <div><dt><UserRound size={15} /> Role</dt><dd>{user.role}</dd></div>
            <div><dt><CheckCircle2 size={15} /> Team</dt><dd>{data.team.length} people</dd></div>
          </dl>
        </aside>
      </div>

      <section className="matters-section">
        <header className="section-header section-header--page">
          <div>
            <span className="eyebrow">{searchResults ? 'Search results' : 'Recently active'}</span>
            <h2>{searchResults ? `Matters matching “${search}”` : 'Your matters'}</h2>
          </div>
          <span className="count-badge">{matters.length}</span>
        </header>
        {matters.length ? (
          <div className="matter-grid">
            {matters.map((matter) => (
              <article className="matter-card" key={matter.id}>
                <div className="matter-card__topline">
                  <button type="button" className="reference-link" onClick={() => onOpenMatter(matter.id)}>
                    {matter.reference}
                  </button>
                  <span className={`risk-pill risk-pill--${matter.riskLevel}`}>{matter.riskLevel} risk</span>
                </div>
                <button className="matter-card__title" type="button" onClick={() => onOpenMatter(matter.id)}>
                  {matter.title}
                </button>
                <p>{matter.clientName}</p>
                <div className="matter-card__meta">
                  <span>{matter.stage}</span>
                  <span>{matter.openTaskCount} open tasks</span>
                </div>
                <footer>
                  <span className="avatar avatar--tiny">{matter.owner.name.split(' ').map((part) => part[0]).join('')}</span>
                  <span>{matter.owner.name}</span>
                  <span className="matter-card__deadline"><CalendarClock size={14} /> {formatDate(matter.nextDeadline)}</span>
                </footer>
              </article>
            ))}
          </div>
        ) : (
          <div className="surface empty-state"><Search size={27} /><strong>No matching matters</strong><p>Try a client name, reference or owner.</p></div>
        )}
      </section>

      <CreateMatterDialog
        open={createOpen}
        team={data.team}
        onClose={() => setCreateOpen(false)}
        onCreated={onOpenMatter}
      />
    </main>
  );
}

function CreateMatterDialog({
  open,
  team,
  onClose,
  onCreated,
}: {
  open: boolean;
  team: DashboardData['team'];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const defaultOwner = useMemo(() => team[0]?.id ?? '', [team]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const result = await request<{ matter: MatterSummary }>('/api/matters', {
        method: 'POST',
        body: jsonBody({
          reference: form.get('reference'),
          title: form.get('title'),
          clientName: form.get('clientName'),
          matterType: form.get('matterType'),
          stage: form.get('stage'),
          riskLevel: form.get('riskLevel'),
          ownerUserId: form.get('ownerUserId'),
          openedAt: form.get('openedAt'),
          description: form.get('description'),
          externalSource: form.get('externalSource') || undefined,
          externalId: form.get('externalId') || undefined,
        }),
      });
      onClose();
      onCreated(result.matter.id);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Matter creation failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} title="Open a new matter" description="Create the canonical SwiftClaim record. Migration references stay as compatibility metadata." onClose={onClose} size="wide">
      <form className="form-grid" onSubmit={submit}>
        <label className="form-field"><span>Reference</span><input name="reference" placeholder="NCL-2026-0042" required /></label>
        <label className="form-field"><span>Opened date</span><input name="openedAt" type="date" defaultValue="2026-07-13" required /></label>
        <label className="form-field form-field--wide"><span>Matter title</span><input name="title" placeholder="Ahmed v Orion Logistics" required /></label>
        <label className="form-field"><span>Client</span><input name="clientName" required /></label>
        <label className="form-field"><span>Matter type</span><input name="matterType" defaultValue="Commercial dispute" required /></label>
        <label className="form-field"><span>Stage</span><input name="stage" defaultValue="Pre-action" required /></label>
        <label className="form-field"><span>Risk</span><select name="riskLevel" defaultValue="medium"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>
        <label className="form-field form-field--wide"><span>Owner</span><select name="ownerUserId" defaultValue={defaultOwner}>{team.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.role}</option>)}</select></label>
        <label className="form-field"><span>Legacy system</span><input name="externalSource" placeholder="proclaim" /></label>
        <label className="form-field"><span>Legacy ID</span><input name="externalId" placeholder="Optional" /></label>
        <label className="form-field form-field--wide"><span>Description</span><textarea name="description" rows={3} /></label>
        {error ? <div className="form-alert form-field--wide" role="alert">{error}</div> : null}
        <div className="form-actions form-field--wide"><button className="button button--secondary" type="button" onClick={onClose}>Cancel</button><button className="button button--primary" type="submit" disabled={submitting}>{submitting ? 'Opening…' : 'Open matter'}</button></div>
      </form>
    </Dialog>
  );
}
