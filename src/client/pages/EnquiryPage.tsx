import {
  ArrowLeft,
  ArrowRight,
  ClipboardCheck,
  FileText,
  Gavel,
  RefreshCw,
  Scale,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import {
  ApiError,
  jsonBody,
  request,
  type CurrentUser,
  type IntakeConversion,
  type IntakeWorkspace,
  type TeamMember,
} from '../api.js';
import { AssessmentPanel } from '../components/intake/AssessmentPanel.js';
import { ConflictPanel } from '../components/intake/ConflictPanel.js';
import { DecisionPanel } from '../components/intake/DecisionPanel.js';
import { EnquiryOverview } from '../components/intake/EnquiryOverview.js';
import { OnboardingPanel } from '../components/intake/OnboardingPanel.js';

type IntakeSection =
  | 'enquiry'
  | 'conflicts'
  | 'assessment'
  | 'onboarding'
  | 'decision';

const SECTIONS = [
  { id: 'enquiry', label: 'Enquiry', icon: FileText },
  { id: 'conflicts', label: 'Conflicts', icon: ShieldCheck },
  { id: 'assessment', label: 'Assessment', icon: Scale },
  { id: 'onboarding', label: 'Onboarding', icon: ClipboardCheck },
  { id: 'decision', label: 'Decision', icon: Gavel },
] as const;

export function EnquiryPage({
  enquiryId,
  user,
  onBack,
  onConverted,
}: {
  enquiryId: string;
  user: CurrentUser;
  onBack: () => void;
  onConverted: (matterId: string) => void;
}) {
  const [workspace, setWorkspace] = useState<IntakeWorkspace>();
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [section, setSection] = useState<IntakeSection>('enquiry');
  const [loadError, setLoadError] = useState('');
  const [mutationError, setMutationError] = useState('');
  const [mutationBlockers, setMutationBlockers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoadError('');
      const [workspaceResponse, usersResponse] = await Promise.all([
        request<IntakeWorkspace>(`/api/enquiries/${enquiryId}`, { signal }),
        request<{ users: TeamMember[] }>('/api/users', { signal }),
      ]);
      setWorkspace(workspaceResponse);
      setTeam(usersResponse.users);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setLoadError(reason instanceof Error ? reason.message : 'Enquiry unavailable.');
    }
  }, [enquiryId]);

  useEffect(() => {
    const controller = new AbortController();
    setWorkspace(undefined);
    setTeam([]);
    setLoadError('');
    setMutationError('');
    setMutationBlockers([]);
    setSection('enquiry');
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const mutate = async (
    path: string,
    method: 'POST' | 'PUT' | 'PATCH',
    command: Record<string, unknown>,
  ) => {
    setBusy(true);
    setMutationError('');
    setMutationBlockers([]);
    try {
      await request(path, { method, body: jsonBody(command) });
      await load();
    } catch (reason) {
      setMutationError(reason instanceof Error ? reason.message : 'The update failed.');
      if (reason instanceof ApiError && Array.isArray(reason.details?.blockers)) {
        setMutationBlockers(
          (reason.details.blockers as Array<{ label?: string }>).map(
            (blocker) => blocker.label ?? 'A required control is incomplete.',
          ),
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const convert = async () => {
    if (!workspace) return;
    setBusy(true);
    setMutationError('');
    try {
      const result = await request<IntakeConversion>(
        `/api/enquiries/${enquiryId}/convert`,
        {
          method: 'POST',
          body: jsonBody({
            expectedVersion: workspace.enquiry.version,
            idempotencyKey: `intake-convert:${enquiryId}:${workspace.enquiry.version}`,
          }),
        },
      );
      onConverted(result.matter.id);
    } catch (reason) {
      setMutationError(reason instanceof Error ? reason.message : 'Conversion failed.');
      if (reason instanceof ApiError && Array.isArray(reason.details?.blockers)) {
        setMutationBlockers(
          (reason.details.blockers as Array<{ label?: string }>).map(
            (blocker) => blocker.label ?? 'A required control is incomplete.',
          ),
        );
      }
    } finally {
      setBusy(false);
    }
  };

  if (!workspace && !loadError) {
    return <main className="page enquiry-page" aria-label="Loading enquiry"><div className="skeleton skeleton--heading" /><div className="surface skeleton skeleton--matter" /></main>;
  }

  if (!workspace) {
    return (
      <main className="page page-state">
        <FileText size={34} /><h1>Enquiry unavailable</h1><p>{loadError}</p>
        <div className="button-row"><button className="button button--secondary" type="button" onClick={onBack}><ArrowLeft size={16} /> Back to enquiries</button><button className="button button--primary" type="button" onClick={() => void load()}><RefreshCw size={16} /> Retry</button></div>
      </main>
    );
  }

  const { enquiry } = workspace;
  return (
    <main className="page enquiry-page">
      <button className="back-link" type="button" onClick={onBack}><ArrowLeft size={16} /> Back to enquiries</button>
      <header className="enquiry-header">
        <div className="enquiry-header__identity">
          <span className="enquiry-avatar"><UserRound size={24} /></span>
          <div><span className="eyebrow">{enquiry.reference}</span><h1>{enquiry.client.displayName}</h1><p>{enquiry.property.addressLine1}, {enquiry.property.city}, {enquiry.property.postcode} · {enquiry.landlord?.name}</p></div>
        </div>
        <div className="enquiry-header__state">
          <span className={`intake-status intake-status--${enquiry.status}`}>{enquiry.status.replaceAll('_', ' ')}</span>
          <span>Enquiry v{enquiry.version}</span>
          {workspace.readiness.conversion.ready ? <strong>Ready to convert</strong> : <small>{workspace.readiness.conversion.blockers.length} conversion blockers</small>}
        </div>
        {workspace.conversion ? <button className="button button--primary button--small" type="button" onClick={() => onConverted(workspace.conversion?.matter.id ?? '')}>Open {workspace.conversion.matter.reference} <ArrowRight size={15} /></button> : null}
      </header>

      <div className="intake-workspace">
        <nav className="intake-section-rail" aria-label="Enquiry sections">
          {SECTIONS.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} type="button" aria-label={item.label} className={section === item.id ? 'is-active' : ''} aria-current={section === item.id ? 'page' : undefined} onClick={() => setSection(item.id)}><Icon size={16} /><span>{item.label}</span>{item.id === 'conflicts' && workspace.conflict.latestDecision ? <small>Done</small> : item.id === 'assessment' && workspace.readiness.assessment.ready ? <small>Ready</small> : item.id === 'decision' && workspace.readiness.conversion.ready ? <small>Ready</small> : null}</button>;
          })}
        </nav>
        <div className="intake-workspace__content">
          {mutationError ? <div className="inline-notice inline-notice--error" role="alert"><span><strong>{mutationError}</strong>{mutationBlockers.map((blocker) => <small key={blocker}>{blocker}</small>)}</span></div> : null}
          {section === 'enquiry' ? <EnquiryOverview enquiry={enquiry} team={team} saving={busy} onSave={(command) => mutate(`/api/enquiries/${enquiryId}`, 'PATCH', command)} /> : null}
          {section === 'conflicts' ? <ConflictPanel key={workspace.conflict.latestCheck?.id ?? 'unchecked'} check={workspace.conflict.latestCheck} decision={workspace.conflict.latestDecision} user={user} busy={busy} onRun={() => mutate(`/api/enquiries/${enquiryId}/conflict-checks`, 'POST', {})} onDecide={(command) => mutate(`/api/enquiries/${enquiryId}/conflict-decisions`, 'POST', command)} /> : null}
          {section === 'assessment' ? <AssessmentPanel enquiry={enquiry} assessment={workspace.assessment} readiness={workspace.readiness.assessment} saving={busy} onSave={(command) => mutate(`/api/enquiries/${enquiryId}/assessment`, 'PUT', command)} /> : null}
          {section === 'onboarding' ? <OnboardingPanel key={workspace.onboarding?.version ?? 'new'} enquiry={enquiry} onboarding={workspace.onboarding} readiness={workspace.readiness.onboarding} team={team} saving={busy} onSave={(command) => mutate(`/api/enquiries/${enquiryId}/onboarding`, 'PUT', command)} /> : null}
          {section === 'decision' ? <DecisionPanel enquiry={enquiry} readiness={workspace.readiness} user={user} busy={busy} onDecide={(command) => mutate(`/api/enquiries/${enquiryId}/decisions`, 'POST', command)} onConvert={convert} /> : null}
        </div>
      </div>
    </main>
  );
}
