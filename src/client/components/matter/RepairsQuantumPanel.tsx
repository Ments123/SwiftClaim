import { CheckCircle2, CircleSlash2, Hammer, LockKeyhole, Scale } from 'lucide-react';
import { useState } from 'react';

import { jsonBody, request, type LossScheduleRecord, type ProtectedOffer, type RepairsQuantumWorkspace, type WorkScheduleRecord } from '../../api.js';
import { OffersView } from './OffersView.js';
import { QuantumView } from './QuantumView.js';
import { RepairEventDialog } from './QuantumDialogs.js';
import { RepairsView } from './RepairsView.js';

interface Props {
  matterId: string;
  workspace: RepairsQuantumWorkspace;
  onRefresh: () => Promise<void>;
  loadProtectedOffers: () => Promise<ProtectedOffer[]>;
}

type View = 'repairs' | 'quantum' | 'offers';

export function RepairsQuantumPanel({ matterId, workspace, onRefresh, loadProtectedOffers }: Props) {
  const [view, setView] = useState<View>('repairs');
  const [repairItemId, setRepairItemId] = useState<string | null>(null);
  const [protectedOffers, setProtectedOffers] = useState<ProtectedOffer[] | null>(null);
  const [protectedLoading, setProtectedLoading] = useState(false);
  const [protectedError, setProtectedError] = useState('');
  const currentWorks = workspace.workSchedules.find(({ status }) => status === 'approved') ?? workspace.workSchedules[0];
  const currentLoss = workspace.lossSchedules.find(({ status }) => status === 'approved') ?? workspace.lossSchedules[0];
  const currentReview = workspace.generalDamagesReviews[0];
  const ready = workspace.readiness.controls.filter(({ eligible }) => eligible).length;

  const openProtected = async () => {
    setProtectedLoading(true);
    setProtectedError('');
    try {
      setProtectedOffers(await loadProtectedOffers());
    } catch (reason) {
      setProtectedError(reason instanceof Error ? reason.message : 'Protected offers are unavailable.');
    } finally {
      setProtectedLoading(false);
    }
  };

  const approveWorks = async (schedule: WorkScheduleRecord) => {
    if (!window.confirm('Approve this exact schedule version and retain its warning acknowledgements?')) return;
    const warnings = [...new Set(schedule.items.flatMap(({ projection }) => projection.warnings.map(({ key }) => key)))];
    await request(`/api/matters/${matterId}/work-schedules/${schedule.id}/approve`, { method: 'POST', body: jsonBody({ expectedVersion: schedule.recordVersion, idempotencyKey: crypto.randomUUID(), approvalNote: 'Approved after review in the Repairs and quantum workspace.', acknowledgedWarningKeys: warnings }) });
    await onRefresh();
  };

  const approveLosses = async (schedule: LossScheduleRecord) => {
    if (!window.confirm('Approve this exact loss schedule and its stated evidence gaps?')) return;
    const gaps = schedule.items.filter(({ evidenceStatus, position }) => position !== 'withdrawn' && ['partial', 'missing'].includes(evidenceStatus)).map(({ id }) => id);
    await request(`/api/matters/${matterId}/loss-schedules/${schedule.id}/approve`, { method: 'POST', body: jsonBody({ expectedVersion: schedule.recordVersion, idempotencyKey: crypto.randomUUID(), approvalNote: 'Approved after calculation and evidence review in SwiftClaim.', acknowledgedEvidenceGapItemIds: gaps }) });
    await onRefresh();
  };

  return <section className="repairs-quantum-workspace" aria-labelledby="repairs-quantum-title">
    <header className="repairs-quantum-header"><div><span className="eyebrow">Current position, source by source</span><h2 id="repairs-quantum-title">Repairs & quantum</h2><p>Track works, reproduce every loss figure and keep protected negotiations segregated.</p></div><div className="quantum-readiness-badge">{ready === workspace.readiness.controls.length ? <CheckCircle2 size={17} /> : <CircleSlash2 size={17} />}<span>{ready}/{workspace.readiness.controls.length} controls ready</span></div></header>
    <div className="quantum-position-strip"><div><Hammer size={17} /><span>Work items</span><strong>{currentWorks?.items.length ?? 0}</strong></div><div><Scale size={17} /><span>Loss items</span><strong>{currentLoss?.items.length ?? 0}</strong></div><div><LockKeyhole size={17} /><span>Protected offers</span><strong>{workspace.protectedOfferCount}</strong></div></div>
    <div className="protocol-view-tabs quantum-tabs" role="group" aria-label="Repairs and quantum views"><button type="button" className={view === 'repairs' ? 'is-active' : ''} onClick={() => setView('repairs')}>Repairs</button><button type="button" className={view === 'quantum' ? 'is-active' : ''} onClick={() => setView('quantum')}>Quantum</button><button type="button" className={view === 'offers' ? 'is-active' : ''} onClick={() => setView('offers')}>Offers</button></div>
    <div className="repairs-quantum-content">{view === 'repairs' ? <RepairsView schedule={currentWorks} canWrite={workspace.permissions.canWrite} canApprove={workspace.permissions.canApprove} onRecordEvent={setRepairItemId} onApprove={(schedule) => void approveWorks(schedule)} /> : null}{view === 'quantum' ? <QuantumView schedule={currentLoss} review={currentReview} canApprove={workspace.permissions.canApprove} onApprove={(schedule) => void approveLosses(schedule)} /> : null}{view === 'offers' ? <OffersView openOffers={workspace.openOffers} protectedOffers={protectedOffers} protectedCount={workspace.protectedOfferCount} canReadProtected={workspace.permissions.canReadProtectedOffers} loadingProtected={protectedLoading} protectedError={protectedError} onLoadProtected={() => void openProtected()} /> : null}</div>
    <RepairEventDialog matterId={matterId} workItemId={repairItemId} onClose={() => setRepairItemId(null)} onSaved={onRefresh} />
  </section>;
}
