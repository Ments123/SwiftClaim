import {
  Activity,
  ArrowLeft,
  Check,
  ClipboardCheck,
  Download,
  FileCheck2,
  FileText,
  Fingerprint,
  MessageSquareText,
  Paperclip,
  Plus,
  RefreshCw,
  Scale,
  ShieldCheck,
  Upload,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import {
  ApiError,
  jsonBody,
  request,
  type Matter360Data,
  type MatterAggregate,
  type CommunicationWorkspace,
  type EvidenceWorkspace,
  type MatterIntakeProfile,
  type NegotiationWorkspace,
  type ProceedingsWorkspace,
  type MatterSection,
  type ProtectedOffer,
  type ProtocolWorkspace,
  type RepairsQuantumWorkspace,
  type TransitionWorkflowCommand,
} from '../api.js';
import { Dialog } from '../components/Dialog.js';
import { ClientHouseholdPanel } from '../components/matter/ClientHouseholdPanel.js';
import { CommunicationsPanel } from '../components/matter/CommunicationsPanel.js';
import { DefectsRepairsPanel } from '../components/matter/DefectsRepairsPanel.js';
import { EvidenceInvestigationPanel } from '../components/matter/EvidenceInvestigationPanel.js';
import { MatterHeader } from '../components/matter/MatterHeader.js';
import { NegotiationSettlementPanel } from '../components/matter/NegotiationSettlementPanel.js';
import { MatterSectionRail } from '../components/matter/MatterSectionRail.js';
import { OperationalOverview } from '../components/matter/OperationalOverview.js';
import { ProceedingsPanel } from '../components/matter/ProceedingsPanel.js';
import { PropertyTenancyPanel } from '../components/matter/PropertyTenancyPanel.js';
import { ProtocolExpertsPanel } from '../components/matter/ProtocolExpertsPanel.js';
import { RepairsQuantumPanel } from '../components/matter/RepairsQuantumPanel.js';

interface MatterPageProps {
  matterId: string;
  onBack: () => void;
}

function formatDate(value: string, includeTime = false) {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(new Date(value));
}

function formatBytes(bytes: number) {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export function MatterPage({ matterId, onBack }: MatterPageProps) {
  const [summary, setSummary] = useState<Matter360Data>();
  const [aggregate, setAggregate] = useState<MatterAggregate>();
  const [summaryError, setSummaryError] = useState('');
  const [aggregateError, setAggregateError] = useState('');
  const [intakeProfile, setIntakeProfile] = useState<MatterIntakeProfile | null>();
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileRetryVersion, setProfileRetryVersion] = useState(0);
  const [evidenceWorkspace, setEvidenceWorkspace] = useState<EvidenceWorkspace>();
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState('');
  const [protocolWorkspace, setProtocolWorkspace] = useState<ProtocolWorkspace>();
  const [protocolLoading, setProtocolLoading] = useState(false);
  const [protocolError, setProtocolError] = useState('');
  const [quantumWorkspace, setQuantumWorkspace] = useState<RepairsQuantumWorkspace>();
  const [quantumLoading, setQuantumLoading] = useState(false);
  const [quantumError, setQuantumError] = useState('');
  const [communicationsWorkspace, setCommunicationsWorkspace] = useState<CommunicationWorkspace>();
  const [communicationsLoading, setCommunicationsLoading] = useState(false);
  const [communicationsError, setCommunicationsError] = useState('');
  const [negotiationWorkspace, setNegotiationWorkspace] = useState<NegotiationWorkspace>();
  const [negotiationLoading, setNegotiationLoading] = useState(false);
  const [negotiationError, setNegotiationError] = useState('');
  const [proceedingsWorkspace, setProceedingsWorkspace] = useState<ProceedingsWorkspace>();
  const [proceedingsLoading, setProceedingsLoading] = useState(false);
  const [proceedingsError, setProceedingsError] = useState('');
  const [mutationError, setMutationError] = useState('');
  const [section, setSection] = useState<MatterSection>('overview');
  const [partyOpen, setPartyOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [documentOpen, setDocumentOpen] = useState(false);
  const [updatingTask, setUpdatingTask] = useState('');

  const loadSummary = useCallback(async (signal?: AbortSignal) => {
    try {
      setSummaryError('');
      setSummary(
        await request<Matter360Data>(`/api/matters/${matterId}/summary`, {
          signal,
        }),
      );
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setSummaryError(
        reason instanceof Error ? reason.message : 'Matter unavailable.',
      );
    }
  }, [matterId]);

  const loadAggregate = useCallback(async (signal?: AbortSignal) => {
    try {
      setAggregateError('');
      setAggregate(
        await request<MatterAggregate>(`/api/matters/${matterId}`, { signal }),
      );
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setAggregateError(
        reason instanceof Error
          ? reason.message
          : 'Matter records are unavailable.',
      );
    }
  }, [matterId]);

  const loadAll = useCallback(async (signal?: AbortSignal) => {
    await Promise.all([loadSummary(signal), loadAggregate(signal)]);
  }, [loadAggregate, loadSummary]);

  useEffect(() => {
    const controller = new AbortController();
    setSummary(undefined);
    setAggregate(undefined);
    setSummaryError('');
    setAggregateError('');
    setIntakeProfile(undefined);
    setProfileLoading(false);
    setProfileError('');
    setProfileRetryVersion(0);
    setEvidenceWorkspace(undefined);
    setEvidenceLoading(false);
    setEvidenceError('');
    setProtocolWorkspace(undefined);
    setProtocolLoading(false);
    setProtocolError('');
    setQuantumWorkspace(undefined);
    setQuantumLoading(false);
    setQuantumError('');
    setCommunicationsWorkspace(undefined);
    setCommunicationsLoading(false);
    setCommunicationsError('');
    setNegotiationWorkspace(undefined);
    setNegotiationLoading(false);
    setNegotiationError('');
    setProceedingsWorkspace(undefined);
    setProceedingsLoading(false);
    setProceedingsError('');
    setMutationError('');
    setSection('overview');
    void loadAll(controller.signal);
    return () => controller.abort();
  }, [loadAll]);

  const profileSectionActive =
    section === 'client_household' || section === 'property_tenancy';

  useEffect(() => {
    if (!profileSectionActive || intakeProfile !== undefined || profileError) return;
    const controller = new AbortController();
    setProfileLoading(true);
    request<{ profile: MatterIntakeProfile }>(
      `/api/matters/${matterId}/intake-profile`,
      { signal: controller.signal },
    )
      .then((response) => setIntakeProfile(response.profile))
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        if (reason instanceof ApiError && reason.status === 404) {
          setIntakeProfile(null);
          return;
        }
        setProfileError('The converted intake profile is unavailable.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setProfileLoading(false);
      });
    return () => controller.abort();
  }, [intakeProfile, matterId, profileError, profileRetryVersion, profileSectionActive]);

  const retryProfile = () => {
    setIntakeProfile(undefined);
    setProfileLoading(false);
    setProfileError('');
    setProfileRetryVersion((version) => version + 1);
  };

  const evidenceSectionActive =
    section === 'defects_repairs' || section === 'evidence';

  const loadEvidenceWorkspace = useCallback(async (signal?: AbortSignal) => {
    setEvidenceLoading(true);
    setEvidenceError('');
    try {
      setEvidenceWorkspace(
        await request<EvidenceWorkspace>(
          `/api/matters/${matterId}/evidence-investigation`,
          { signal },
        ),
      );
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setEvidenceError(
        reason instanceof Error
          ? reason.message
          : 'The evidence investigation is unavailable.',
      );
    } finally {
      if (!signal?.aborted) setEvidenceLoading(false);
    }
  }, [matterId]);

  useEffect(() => {
    if (!evidenceSectionActive || evidenceWorkspace || evidenceError) return;
    const controller = new AbortController();
    void loadEvidenceWorkspace(controller.signal);
    return () => controller.abort();
  }, [evidenceError, evidenceSectionActive, evidenceWorkspace, loadEvidenceWorkspace]);

  const loadProtocolWorkspace = useCallback(async (signal?: AbortSignal) => {
    setProtocolLoading(true);
    setProtocolError('');
    try {
      setProtocolWorkspace(await request<ProtocolWorkspace>(
        `/api/matters/${matterId}/protocol-experts`, { signal },
      ));
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setProtocolError(reason instanceof Error ? reason.message : 'The protocol workspace is unavailable.');
    } finally {
      if (!signal?.aborted) setProtocolLoading(false);
    }
  }, [matterId]);

  useEffect(() => {
    if (section !== 'protocol_experts' || protocolWorkspace || protocolError) return;
    const controller = new AbortController();
    void loadProtocolWorkspace(controller.signal);
    return () => controller.abort();
  }, [loadProtocolWorkspace, protocolError, protocolWorkspace, section]);

  const loadQuantumWorkspace = useCallback(async (signal?: AbortSignal) => {
    setQuantumLoading(true);
    setQuantumError('');
    try {
      setQuantumWorkspace(await request<RepairsQuantumWorkspace>(
        `/api/matters/${matterId}/repairs-quantum`, { signal },
      ));
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setQuantumError(reason instanceof Error ? reason.message : 'The repairs and quantum workspace is unavailable.');
    } finally {
      if (!signal?.aborted) setQuantumLoading(false);
    }
  }, [matterId]);

  useEffect(() => {
    if (section !== 'damages_offers' || quantumWorkspace || quantumError) return;
    const controller = new AbortController();
    void loadQuantumWorkspace(controller.signal);
    return () => controller.abort();
  }, [loadQuantumWorkspace, quantumError, quantumWorkspace, section]);

  const loadCommunicationsWorkspace = useCallback(async (signal?: AbortSignal) => {
    setCommunicationsLoading(true);
    setCommunicationsError('');
    try {
      setCommunicationsWorkspace(await request<CommunicationWorkspace>(
        `/api/matters/${matterId}/communications`, { signal },
      ));
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setCommunicationsError(reason instanceof Error ? reason.message : 'The communications workspace is unavailable.');
    } finally {
      if (!signal?.aborted) setCommunicationsLoading(false);
    }
  }, [matterId]);

  useEffect(() => {
    if (section !== 'communications' || communicationsWorkspace || communicationsError) return;
    const controller = new AbortController();
    void loadCommunicationsWorkspace(controller.signal);
    return () => controller.abort();
  }, [communicationsError, communicationsWorkspace, loadCommunicationsWorkspace, section]);

  const loadNegotiationWorkspace = useCallback(async (signal?: AbortSignal) => {
    setNegotiationLoading(true);
    setNegotiationError('');
    try {
      setNegotiationWorkspace(await request<NegotiationWorkspace>(
        `/api/matters/${matterId}/negotiation-settlement`, { signal },
      ));
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setNegotiationError(reason instanceof Error ? reason.message : 'The negotiation workspace is unavailable.');
    } finally {
      if (!signal?.aborted) setNegotiationLoading(false);
    }
  }, [matterId]);

  useEffect(() => {
    if (section !== 'negotiation_settlement' || negotiationWorkspace || negotiationError) return;
    const controller = new AbortController();
    void loadNegotiationWorkspace(controller.signal);
    return () => controller.abort();
  }, [loadNegotiationWorkspace, negotiationError, negotiationWorkspace, section]);

  const loadProtectedNegotiation = useCallback(() => request<NegotiationWorkspace>(
    `/api/matters/${matterId}/negotiation-settlement/protected`,
  ), [matterId]);

  const loadProceedingsWorkspace = useCallback(async (signal?: AbortSignal) => {
    setProceedingsLoading(true);
    setProceedingsError('');
    try {
      setProceedingsWorkspace(await request<ProceedingsWorkspace>(
        `/api/matters/${matterId}/proceedings`, { signal },
      ));
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setProceedingsError(reason instanceof Error ? reason.message : 'The proceedings workspace is unavailable.');
    } finally {
      if (!signal?.aborted) setProceedingsLoading(false);
    }
  }, [matterId]);

  useEffect(() => {
    if (section !== 'proceedings' || proceedingsWorkspace || proceedingsError) return;
    const controller = new AbortController();
    void loadProceedingsWorkspace(controller.signal);
    return () => controller.abort();
  }, [loadProceedingsWorkspace, proceedingsError, proceedingsWorkspace, section]);

  const loadProtectedOffers = useCallback(async () => {
    const response = await request<{ offers: ProtectedOffer[] }>(
      `/api/matters/${matterId}/offers/protected`,
    );
    return response.offers;
  }, [matterId]);

  const completeTask = async (taskId: string) => {
    setUpdatingTask(taskId);
    try {
      await request(`/api/matters/${matterId}/tasks/${taskId}`, {
        method: 'PATCH',
        body: jsonBody({ status: 'completed' }),
      });
      await loadAll();
    } catch (reason) {
      setMutationError(
        reason instanceof Error ? reason.message : 'Task update failed.',
      );
    } finally {
      setUpdatingTask('');
    }
  };

  const transitionWorkflow = async (command: TransitionWorkflowCommand) => {
    await request(`/api/matters/${matterId}/workflow/transitions`, {
      method: 'POST',
      body: jsonBody(command),
    });
    await loadSummary();
    void loadAggregate();
  };

  if (!summary && !summaryError) {
    return <main className="page matter-loading"><div className="skeleton skeleton--heading" /><div className="surface skeleton skeleton--matter" /></main>;
  }

  if (!summary) {
    return (
      <main className="page page-state">
        <FileText size={34} /><h1>Matter unavailable</h1><p>{summaryError}</p>
        <div className="button-row"><button className="button button--secondary" type="button" onClick={onBack}><ArrowLeft size={16} /> Back</button><button className="button button--primary" type="button" onClick={() => void loadAll()}><RefreshCw size={16} /> Retry</button></div>
      </main>
    );
  }

  const openTasks = aggregate
    ? aggregate.tasks.filter(
        (task) => !['completed', 'cancelled'].includes(task.status),
      )
    : summary.nextActions;
  const sectionCounts: Partial<Record<MatterSection, number>> = aggregate
    ? {
        client_household: aggregate.parties.length,
        documents: aggregate.documents.length,
        tasks_calendar: openTasks.length,
        chronology: aggregate.timeline.length,
        audit: aggregate.audit.length,
        defects_repairs: evidenceWorkspace?.defects.length,
        evidence: evidenceWorkspace?.evidenceItems.length,
        protocol_experts: protocolWorkspace?.experts.length,
        damages_offers:
          (quantumWorkspace?.workSchedules[0]?.items.length ?? 0) +
          (quantumWorkspace?.lossSchedules[0]?.items.length ?? 0),
        communications: communicationsWorkspace?.counts.total,
        negotiation_settlement:
          (negotiationWorkspace?.actions.length ?? 0) +
          (negotiationWorkspace?.settlements.length ?? 0),
        proceedings: proceedingsWorkspace ?
          proceedingsWorkspace.directions.length + proceedingsWorkspace.hearings.length : undefined,
      }
    : { tasks_calendar: summary.nextActions.length };

  return (
    <main className="page page--matter">
      <button className="back-link" type="button" onClick={onBack}><ArrowLeft size={16} /> Back to matters</button>
      <MatterHeader data={summary} />

      <div className="matter-workspace">
        <MatterSectionRail
          activeSection={section}
          onSelect={setSection}
          counts={sectionCounts}
        />
        <div className="matter-workspace__content">
          {mutationError ? <div className="inline-notice inline-notice--error" role="alert">{mutationError}</div> : null}
          {aggregateError && section !== 'overview' && section !== 'property_tenancy' ? <div className="inline-notice inline-notice--error" role="alert">{aggregateError}</div> : null}

      {section === 'overview' ? (
        <>
          <OperationalOverview
            data={summary}
            onTransition={transitionWorkflow}
            onViewTasks={() => setSection('tasks_calendar')}
          />
          {aggregate ? (
            <div className="operational-overview__support">
              <section className="surface matter-metrics">
                <div><span className="metric-icon"><UsersRound size={18} /></span><strong>{aggregate.parties.length}</strong><small>People & organisations</small></div>
                <div><span className="metric-icon"><Paperclip size={18} /></span><strong>{aggregate.documents.length}</strong><small>Preserved documents</small></div>
                <div><span className="metric-icon"><Activity size={18} /></span><strong>{aggregate.timeline.length}</strong><small>Chronology events</small></div>
              </section>
              <section className="surface recent-activity">
                <header className="section-header"><div><span className="eyebrow">Chronology</span><h2>Recent activity</h2></div><button type="button" onClick={() => setSection('chronology')}>Full chronology</button></header>
                <Timeline events={aggregate.timeline.slice(0, 4)} />
              </section>
            </div>
          ) : null}
        </>
      ) : null}

      {section === 'client_household' ? (
        <ClientHouseholdPanel
          profile={intakeProfile}
          loading={profileLoading}
          error={profileError}
          parties={aggregate?.parties ?? []}
          canWrite={aggregate?.permissions.canWrite ?? false}
          onAddParty={() => setPartyOpen(true)}
          onRetry={retryProfile}
        />
      ) : null}

      {section === 'property_tenancy' ? (
        <PropertyTenancyPanel
          profile={intakeProfile}
          loading={profileLoading}
          error={profileError}
          onRetry={retryProfile}
        />
      ) : null}

      {evidenceSectionActive && evidenceLoading && !evidenceWorkspace ? (
        <section className="surface tab-surface" aria-busy="true">
          <div className="skeleton skeleton--heading" />
          <div className="skeleton skeleton--matter" />
        </section>
      ) : null}

      {evidenceSectionActive && evidenceError && !evidenceWorkspace ? (
        <section className="surface tab-surface page-state">
          <ShieldCheck size={30} />
          <h2>Evidence investigation unavailable</h2>
          <p>{evidenceError}</p>
          <button className="button button--secondary" type="button" onClick={() => void loadEvidenceWorkspace()}><RefreshCw size={15} /> Retry</button>
        </section>
      ) : null}

      {section === 'defects_repairs' && evidenceWorkspace ? (
        <DefectsRepairsPanel
          matterId={matterId}
          workspace={evidenceWorkspace}
          onRefresh={() => loadEvidenceWorkspace()}
        />
      ) : null}

      {section === 'evidence' && evidenceWorkspace ? (
        <EvidenceInvestigationPanel
          matterId={matterId}
          workspace={evidenceWorkspace}
          onRefresh={() => loadEvidenceWorkspace()}
          onNavigateDocuments={() => setSection('documents')}
        />
      ) : null}

      {section === 'protocol_experts' && protocolLoading && !protocolWorkspace ? (
        <section className="surface tab-surface" aria-busy="true"><div className="skeleton skeleton--heading" /><div className="skeleton skeleton--matter" /></section>
      ) : null}

      {section === 'protocol_experts' && protocolError && !protocolWorkspace ? (
        <section className="surface tab-surface page-state"><Scale size={30} /><h2>Protocol workspace unavailable</h2><p>{protocolError}</p><button className="button button--secondary" type="button" onClick={() => void loadProtocolWorkspace()}><RefreshCw size={15} /> Retry</button></section>
      ) : null}

      {section === 'protocol_experts' && protocolWorkspace ? (
        <ProtocolExpertsPanel matterId={matterId} workspace={protocolWorkspace} onRefresh={() => loadProtocolWorkspace()} />
      ) : null}

      {section === 'damages_offers' && quantumLoading && !quantumWorkspace ? (
        <section className="surface tab-surface" aria-busy="true"><div className="skeleton skeleton--heading" /><div className="skeleton skeleton--matter" /></section>
      ) : null}

      {section === 'damages_offers' && quantumError && !quantumWorkspace ? (
        <section className="surface tab-surface page-state"><Scale size={30} /><h2>Repairs and quantum unavailable</h2><p>{quantumError}</p><button className="button button--secondary" type="button" onClick={() => void loadQuantumWorkspace()}><RefreshCw size={15} /> Retry</button></section>
      ) : null}

      {section === 'damages_offers' && quantumWorkspace ? (
        <RepairsQuantumPanel matterId={matterId} workspace={quantumWorkspace} onRefresh={() => loadQuantumWorkspace()} loadProtectedOffers={loadProtectedOffers} />
      ) : null}

      {section === 'communications' && communicationsLoading && !communicationsWorkspace ? (
        <section className="surface tab-surface" aria-busy="true"><div className="skeleton skeleton--heading" /><div className="skeleton skeleton--matter" /></section>
      ) : null}

      {section === 'communications' && communicationsError && !communicationsWorkspace ? (
        <section className="surface tab-surface page-state"><MessageSquareText size={30} /><h2>Communications unavailable</h2><p>{communicationsError}</p><button className="button button--secondary" type="button" onClick={() => void loadCommunicationsWorkspace()}><RefreshCw size={15} /> Retry</button></section>
      ) : null}

      {section === 'communications' && communicationsWorkspace ? (
        <CommunicationsPanel matterId={matterId} workspace={communicationsWorkspace} documents={aggregate?.documents ?? []} onRefresh={() => loadCommunicationsWorkspace()} />
      ) : null}

      {section === 'negotiation_settlement' && negotiationLoading && !negotiationWorkspace ? (
        <section className="surface tab-surface" aria-busy="true"><div className="skeleton skeleton--heading" /><div className="skeleton skeleton--matter" /></section>
      ) : null}

      {section === 'negotiation_settlement' && negotiationError && !negotiationWorkspace ? (
        <section className="surface tab-surface page-state"><Scale size={30} /><h2>Negotiation workspace unavailable</h2><p>{negotiationError}</p><button className="button button--secondary" type="button" onClick={() => void loadNegotiationWorkspace()}><RefreshCw size={15} /> Retry</button></section>
      ) : null}

      {section === 'negotiation_settlement' && negotiationWorkspace ? (
        <NegotiationSettlementPanel matterId={matterId} workspace={negotiationWorkspace} onRefresh={() => loadNegotiationWorkspace()} loadProtected={loadProtectedNegotiation} />
      ) : null}

      {section === 'proceedings' && proceedingsLoading && !proceedingsWorkspace ? (
        <section className="surface tab-surface" aria-busy="true"><div className="skeleton skeleton--heading" /><div className="skeleton skeleton--matter" /></section>
      ) : null}

      {section === 'proceedings' && proceedingsError && !proceedingsWorkspace ? (
        <section className="surface tab-surface page-state"><Scale size={30} /><h2>Proceedings workspace unavailable</h2><p>{proceedingsError}</p><button className="button button--secondary" type="button" onClick={() => void loadProceedingsWorkspace()}><RefreshCw size={15} /> Retry</button></section>
      ) : null}

      {section === 'proceedings' && proceedingsWorkspace ? (
        <ProceedingsPanel matterId={matterId} workspace={proceedingsWorkspace} onRefresh={() => loadProceedingsWorkspace()} />
      ) : null}

      {aggregate && section === 'documents' ? (
        <section className="surface tab-surface">
          <header className="section-header section-header--page"><div><span className="eyebrow">Evidence register</span><h2>Documents</h2></div>{aggregate.permissions.canWrite ? <button className="button button--primary button--small" type="button" onClick={() => setDocumentOpen(true)}><Upload size={16} /> Upload document</button> : null}</header>
          <div className="document-security"><ShieldCheck size={17} /><span>Every stored version is immutable and SHA-256 verified.</span></div>
          {aggregate.documents.length ? <div className="document-list">{aggregate.documents.map((document) => (
            <article className="document-row" key={document.id}>
              <span className="document-icon"><FileCheck2 size={20} /></span>
              <div className="document-row__main"><strong>{document.title}</strong><small>{document.category} · {document.latestVersion?.originalName}</small></div>
              <div className="document-row__meta"><span>v{document.latestVersion?.version}</span><span>{formatBytes(document.latestVersion?.sizeBytes ?? 0)}</span><code title={document.latestVersion?.sha256}>{document.latestVersion?.sha256.slice(0, 10)}…</code></div>
              <a className="icon-button" href={`/api/matters/${matterId}/documents/${document.id}/download`} aria-label={`Download ${document.title}`}><Download size={17} /></a>
            </article>
          ))}</div> : <Empty icon={<FileText />} title="No documents yet" text="Upload a document to create the first immutable version." />}
        </section>
      ) : null}

      {aggregate && section === 'tasks_calendar' ? (
        <section className="surface tab-surface">
          <header className="section-header section-header--page"><div><span className="eyebrow">Controlled work</span><h2>Tasks & deadlines</h2></div>{aggregate.permissions.canWrite ? <button className="button button--primary button--small" type="button" onClick={() => setTaskOpen(true)}><Plus size={16} /> Add deadline</button> : null}</header>
          {aggregate.tasks.length ? <div className="task-list">{aggregate.tasks.map((task) => (
            <article className={`task-row ${task.status === 'completed' ? 'task-row--complete' : ''}`} key={task.id}>
              <span className={`task-check ${task.status === 'completed' ? 'is-complete' : ''}`}>{task.status === 'completed' ? <Check size={15} /> : null}</span>
              <div className="task-row__main"><strong>{task.title}</strong><p>{task.notes || 'No notes'}</p><small><UserRound size={13} /> {task.assignee.name}</small></div>
              <div className="task-row__due"><span className={`priority-pill priority-pill--${task.priority}`}>{task.priority}</span><strong>{formatDate(task.dueAt)}</strong><small>{task.status.replace('_', ' ')}</small></div>
              {aggregate.permissions.canWrite && !['completed', 'cancelled'].includes(task.status) ? <button className="button button--ghost button--small" type="button" disabled={updatingTask === task.id} onClick={() => void completeTask(task.id)}><Check size={15} /> {updatingTask === task.id ? 'Saving…' : 'Complete'}</button> : null}
            </article>
          ))}</div> : <Empty icon={<ClipboardCheck />} title="No tasks or deadlines" text="Create a controlled action and assign it to a member of the firm." />}
        </section>
      ) : null}

      {aggregate && section === 'chronology' ? <section className="surface tab-surface"><header className="section-header section-header--page"><div><span className="eyebrow">Matter chronology</span><h2>Activity timeline</h2></div><span className="count-badge">{aggregate.timeline.length}</span></header><Timeline events={aggregate.timeline} /></section> : null}

      {aggregate && section === 'audit' ? (
        <section className="surface tab-surface">
          <header className="section-header section-header--page"><div><span className="eyebrow">Append-only evidence</span><h2>Audit trail</h2></div><span className="audit-seal"><Fingerprint size={16} /> Protected</span></header>
          {aggregate.audit.length ? <div className="audit-list">{aggregate.audit.map((event) => <article key={event.id}><span className="audit-action">{event.action}</span><div><strong>{event.actorName}</strong><small>{event.entityType} · {event.entityId.slice(0, 8)}</small></div><time>{formatDate(event.createdAt, true)}</time><code>{event.requestId.slice(0, 12)}</code></article>)}</div> : <Empty icon={<Fingerprint />} title="No audited mutations yet" text="Changes made in SwiftClaim appear here and cannot be edited or deleted." />}
        </section>
      ) : null}

        </div>
      </div>

      {aggregate ? <>
        <AddPartyDialog open={partyOpen} matterId={matterId} onClose={() => setPartyOpen(false)} onSaved={loadAll} />
        <AddTaskDialog open={taskOpen} matterId={matterId} team={aggregate.team} onClose={() => setTaskOpen(false)} onSaved={loadAll} />
        <UploadDocumentDialog open={documentOpen} matterId={matterId} onClose={() => setDocumentOpen(false)} onSaved={loadAll} />
      </> : null}
    </main>
  );
}

function Timeline({ events }: { events: MatterAggregate['timeline'] }) {
  return events.length ? <div className="timeline">{events.map((event) => <article key={event.id}><span className="timeline-dot" /><div><strong>{event.title}</strong><p>{event.detail}</p><small>{event.actorName} · {formatDate(event.occurredAt, true)}</small></div></article>)}</div> : <Empty icon={<Activity />} title="No timeline events" text="Matter activity will appear here." />;
}

function Empty({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <div className="empty-state">{icon}<strong>{title}</strong><p>{text}</p></div>;
}

function MutationForm({ children, error, submitting, onClose, submitLabel }: { children: React.ReactNode; error: string; submitting: boolean; onClose: () => void; submitLabel: string }) {
  return <>{children}{error ? <div className="form-alert form-field--wide" role="alert">{error}</div> : null}<div className="form-actions form-field--wide"><button className="button button--secondary" type="button" onClick={onClose}>Cancel</button><button className="button button--primary" type="submit" disabled={submitting}>{submitting ? 'Saving…' : submitLabel}</button></div></>;
}

function AddPartyDialog({ open, matterId, onClose, onSaved }: { open: boolean; matterId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [error, setError] = useState(''); const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSubmitting(true); setError(''); const form = new FormData(event.currentTarget); try { await request(`/api/matters/${matterId}/parties`, { method: 'POST', body: jsonBody(Object.fromEntries(form)) }); onClose(); await onSaved(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Party creation failed.'); } finally { setSubmitting(false); } };
  return <Dialog open={open} title="Add a matter party" description="Record a client, opponent, expert or other participant." onClose={onClose}><form className="form-grid" onSubmit={submit}><label className="form-field"><span>Role</span><select name="kind" defaultValue="expert"><option value="client">Client</option><option value="opponent">Opponent</option><option value="solicitor">Solicitor</option><option value="barrister">Barrister</option><option value="expert">Expert</option><option value="witness">Witness</option><option value="court">Court</option><option value="insurer">Insurer</option><option value="other">Other</option></select></label><label className="form-field"><span>Name</span><input name="name" required /></label><label className="form-field form-field--wide"><span>Organisation</span><input name="organisation" /></label><label className="form-field"><span>Email</span><input name="email" type="email" /></label><label className="form-field"><span>Phone</span><input name="phone" /></label><label className="form-field form-field--wide"><span>Address</span><textarea name="address" rows={2} /></label><MutationForm error={error} submitting={submitting} onClose={onClose} submitLabel="Add party">{null}</MutationForm></form></Dialog>;
}

function AddTaskDialog({ open, matterId, team, onClose, onSaved }: { open: boolean; matterId: string; team: MatterAggregate['team']; onClose: () => void; onSaved: () => Promise<void> }) {
  const [error, setError] = useState(''); const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSubmitting(true); setError(''); const form = new FormData(event.currentTarget); const dueLocal = String(form.get('dueAt')); try { await request(`/api/matters/${matterId}/tasks`, { method: 'POST', body: jsonBody({ title: form.get('title'), notes: form.get('notes'), dueAt: new Date(dueLocal).toISOString(), priority: form.get('priority'), assigneeUserId: form.get('assigneeUserId') }) }); onClose(); await onSaved(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Deadline creation failed.'); } finally { setSubmitting(false); } };
  return <Dialog open={open} title="Add a task or deadline" description="Assign controlled work to a member of the firm." onClose={onClose}><form className="form-grid" onSubmit={submit}><label className="form-field form-field--wide"><span>Title</span><input name="title" required /></label><label className="form-field"><span>Due</span><input name="dueAt" type="datetime-local" defaultValue="2026-07-20T16:00" required /></label><label className="form-field"><span>Priority</span><select name="priority" defaultValue="normal"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label><label className="form-field form-field--wide"><span>Assignee</span><select name="assigneeUserId" defaultValue={team[0]?.id}>{team.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.role}</option>)}</select></label><label className="form-field form-field--wide"><span>Notes</span><textarea name="notes" rows={3} /></label><MutationForm error={error} submitting={submitting} onClose={onClose} submitLabel="Add deadline">{null}</MutationForm></form></Dialog>;
}

function UploadDocumentDialog({ open, matterId, onClose, onSaved }: { open: boolean; matterId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [error, setError] = useState(''); const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSubmitting(true); setError(''); const form = new FormData(event.currentTarget); try { await request(`/api/matters/${matterId}/documents`, { method: 'POST', body: form }); onClose(); await onSaved(); } catch (reason) { setError(reason instanceof ApiError ? reason.message : 'Document upload failed.'); } finally { setSubmitting(false); } };
  return <Dialog open={open} title="Preserve a document" description="Upload one file up to 25 MiB. SwiftClaim stores an immutable version and SHA-256 digest." onClose={onClose}><form className="form-grid" onSubmit={submit}><label className="form-field form-field--wide"><span>Document title</span><input name="title" required /></label><label className="form-field form-field--wide"><span>Category</span><input name="category" placeholder="Correspondence, evidence, pleading…" required /></label><label className="file-drop form-field--wide"><Upload size={22} /><span><strong>Choose a file</strong><small>Maximum 25 MiB</small></span><input name="file" type="file" required /></label><MutationForm error={error} submitting={submitting} onClose={onClose} submitLabel="Upload & preserve">{null}</MutationForm></form></Dialog>;
}
