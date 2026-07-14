import type {
  CreateAccessEventInput,
  CreateDefectInput,
  CreateEvidenceItemInput,
  CreateNoticeInput,
  UpdateDefectInput,
} from '../../shared/contracts.js';

export interface EvidenceMutationContext {
  actorUserId: string;
  occurredAt: string;
  requestId: string;
  ipAddress: string;
}

export interface DefectStatusEvent {
  id: string;
  fromStatus: Defect['status'] | null;
  toStatus: Defect['status'];
  reason: string;
  actorUserId: string;
  occurredAt: string;
}

export interface Defect {
  id: string;
  version: number;
  location: string;
  category: CreateDefectInput['category'];
  title: string;
  description: string;
  severity: CreateDefectInput['severity'];
  status: UpdateDefectInput['status'];
  firstObservedOn: string | null;
  healthImpact: string;
  hazardTags: string[];
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  evidenceIds: string[];
  statusEvents: DefectStatusEvent[];
}

export interface NoticeRecord {
  id: string;
  occurredAt: string;
  channel: CreateNoticeInput['channel'];
  recipientType: CreateNoticeInput['recipientType'];
  recipientName: string;
  summary: string;
  proofStatus: CreateNoticeInput['proofStatus'];
  responseStatus: CreateNoticeInput['responseStatus'];
  responseSummary: string;
  supersedesNoticeId: string | null;
  createdBy: string;
  createdAt: string;
  evidenceIds: string[];
}

export interface AccessEventRecord {
  id: string;
  eventType: CreateAccessEventInput['eventType'];
  appointmentAt: string | null;
  notes: string;
  supersedesAccessEventId: string | null;
  createdBy: string;
  createdAt: string;
  evidenceIds: string[];
}

export interface EvidenceDocumentVersion {
  id: string;
  documentId: string;
  documentTitle: string;
  category: string;
  version: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

export interface EvidenceItem {
  id: string;
  kind: CreateEvidenceItemInput['kind'];
  title: string;
  description: string;
  occurredOn: string | null;
  provenanceSource: CreateEvidenceItemInput['provenanceSource'];
  provenanceDetail: string;
  documentVersion: EvidenceDocumentVersion;
  defectIds: string[];
  noticeIds: string[];
  accessEventIds: string[];
  createdBy: string;
  createdAt: string;
}

export interface EvidenceReadinessControl {
  key:
    | 'defect_schedule_recorded'
    | 'notice_evidence_recorded'
    | 'photographs_recorded';
  eligible: boolean;
  explanation: string;
}

export interface EvidenceReadiness {
  controls: EvidenceReadinessControl[];
}

export interface EvidenceRisk {
  key: string;
  type:
    | 'serious_open_defect'
    | 'defect_without_evidence'
    | 'notice_proof_gap'
    | 'notice_evidence_missing'
    | 'failed_access'
    | 'photographs_missing'
    | 'ineligible_control';
  level: 'medium' | 'high' | 'critical';
  title: string;
  detail: string;
  entityId: string | null;
}

export interface EvidenceWorkspace {
  matterId: string;
  permissions: { canWrite: boolean };
  defects: Defect[];
  notices: NoticeRecord[];
  accessEvents: AccessEventRecord[];
  evidenceItems: EvidenceItem[];
  availableDocumentVersions: EvidenceDocumentVersion[];
  readiness: EvidenceReadiness;
  risks: EvidenceRisk[];
}

