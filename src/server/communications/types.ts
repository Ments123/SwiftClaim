import type {
  CommunicationChannel,
  CommunicationConfidentiality,
  CommunicationDirection,
} from '../../shared/contracts.js';

export type { CommunicationChannel, CommunicationConfidentiality, CommunicationDirection };

export type CommunicationTransportState =
  | 'recorded'
  | 'queued'
  | 'attempting'
  | 'provider_accepted'
  | 'delivered'
  | 'failed'
  | 'read'
  | 'cancelled';

export type CommunicationSource = 'manual' | 'provider' | 'import' | 'system';

export interface CommunicationAttachment {
  documentVersionId: string;
  purpose:
    | 'attachment'
    | 'recording'
    | 'transcript'
    | 'call_note'
    | 'delivery_evidence'
    | 'service_evidence'
    | 'other';
  fileName: string;
  sha256: string;
}
