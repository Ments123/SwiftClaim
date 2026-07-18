import type {
  AddDisclosureCandidateInput,
  ApproveDisclosureRedactionInput,
  CreateDisclosureAiSuggestionInput,
  CreateInspectionRequestInput,
  GenerateDisclosureListInput,
  OpenDisclosureReviewInput,
  RecordDisclosureDecisionInput,
  RecordDisclosurePrivilegeReviewInput,
  RecordInspectionEventInput,
} from '../../shared/contracts.js';

export type DisclosureDecision = RecordDisclosureDecisionInput['decision'];
export type DisclosurePrivilegeCategory = RecordDisclosurePrivilegeReviewInput['category'];
export type DisclosurePrivilegeOutcome = RecordDisclosurePrivilegeReviewInput['outcome'];
export type {
  AddDisclosureCandidateInput,
  ApproveDisclosureRedactionInput,
  CreateDisclosureAiSuggestionInput,
  CreateInspectionRequestInput,
  GenerateDisclosureListInput,
  OpenDisclosureReviewInput,
  RecordDisclosureDecisionInput,
  RecordDisclosurePrivilegeReviewInput,
  RecordInspectionEventInput,
};
