import type {
  ActivateFinanceRateVersionInput,
  AddFinanceRateVersionInput,
  ApproveFinanceJournalInput,
  ApproveFinanceTimeInput,
  CreateFinanceDisbursementInput,
  CreateFinanceEstimateVersionInput,
  CreateFinanceRateCardInput,
  DecideFinanceActivitySuggestionInput,
  PostFinanceJournalInput,
  PrepareFinanceJournalInput,
  RecordFinanceDisbursementEventInput,
  RecordFinanceWarningEventInput,
  ReverseFinanceJournalInput,
  ReverseFinanceTimeInput,
  StartFinanceTimerInput,
  StopFinanceTimerInput,
  SubmitFinanceTimeInput,
} from '../../shared/contracts.js';
import type { SessionUser } from '../policy.js';
import type { AuditContext } from '../store.js';
import { FinanceStore } from './store.js';

export class FinanceService {
  constructor(private readonly store: FinanceStore) {}

  getWorkspace(user: SessionUser, matterId: string) {
    return this.store.getWorkspace(user, matterId);
  }

  getRateCard(user: SessionUser, rateCardId: string) {
    return this.store.getRateCard(user, rateCardId);
  }

  listRateCards(user: SessionUser) {
    return this.store.listRateCards(user);
  }

  canAccessEvidenceVersion(user: SessionUser, matterId: string, versionId: string) {
    return this.store.canAccessEvidenceVersion(user, matterId, versionId);
  }

  createRateCard(user: SessionUser, input: CreateFinanceRateCardInput, audit: AuditContext) {
    return this.store.createRateCard(user, input, audit);
  }

  addRateVersion(user: SessionUser, rateCardId: string, input: AddFinanceRateVersionInput, audit: AuditContext) {
    return this.store.addRateVersion(user, rateCardId, input, audit);
  }

  activateRateVersion(user: SessionUser, rateCardId: string, input: ActivateFinanceRateVersionInput, audit: AuditContext) {
    return this.store.activateRateVersion(user, rateCardId, input, audit);
  }

  createSuggestion(
    user: SessionUser,
    matterId: string,
    input: Parameters<FinanceStore['createSuggestion']>[2],
    audit: AuditContext,
  ) {
    return this.store.createSuggestion(user, matterId, input, audit);
  }

  decideSuggestion(
    user: SessionUser,
    matterId: string,
    suggestionId: string,
    input: DecideFinanceActivitySuggestionInput,
    audit: AuditContext,
  ) {
    return this.store.decideSuggestion(user, matterId, suggestionId, input, audit);
  }

  startTimer(user: SessionUser, matterId: string, input: StartFinanceTimerInput, audit: AuditContext) {
    return this.store.startTimer(user, matterId, input, audit);
  }

  stopTimer(
    user: SessionUser,
    matterId: string,
    timerId: string,
    input: StopFinanceTimerInput,
    audit: AuditContext,
  ) {
    return this.store.stopTimer(user, matterId, timerId, input, audit);
  }

  submitTime(user: SessionUser, matterId: string, input: SubmitFinanceTimeInput, audit: AuditContext) {
    return this.store.submitTime(user, matterId, input, audit);
  }

  approveTime(
    user: SessionUser,
    matterId: string,
    timeEntryId: string,
    input: ApproveFinanceTimeInput,
    audit: AuditContext,
  ) {
    return this.store.approveTime(user, matterId, timeEntryId, input, audit);
  }

  reverseTime(
    user: SessionUser,
    matterId: string,
    timeEntryId: string,
    input: ReverseFinanceTimeInput,
    audit: AuditContext,
  ) {
    return this.store.reverseTime(user, matterId, timeEntryId, input, audit);
  }

  addEstimateVersion(
    user: SessionUser,
    matterId: string,
    input: CreateFinanceEstimateVersionInput,
    audit: AuditContext,
  ) {
    return this.store.addEstimateVersion(user, matterId, input, audit);
  }

  recordWarningEvent(
    user: SessionUser,
    matterId: string,
    warningId: string,
    input: RecordFinanceWarningEventInput,
    audit: AuditContext,
  ) {
    return this.store.recordWarningEvent(user, matterId, warningId, input, audit);
  }

  createDisbursement(
    user: SessionUser,
    matterId: string,
    input: CreateFinanceDisbursementInput,
    audit: AuditContext,
  ) {
    return this.store.createDisbursement(user, matterId, input, audit);
  }

  recordDisbursementEvent(
    user: SessionUser,
    matterId: string,
    disbursementId: string,
    input: RecordFinanceDisbursementEventInput,
    audit: AuditContext,
  ) {
    return this.store.recordDisbursementEvent(user, matterId, disbursementId, input, audit);
  }

  prepareJournal(user: SessionUser, matterId: string, input: PrepareFinanceJournalInput, audit: AuditContext) {
    return this.store.prepareJournal(user, matterId, input, audit);
  }

  approveJournal(
    user: SessionUser,
    matterId: string,
    journalId: string,
    input: ApproveFinanceJournalInput,
    audit: AuditContext,
  ) {
    return this.store.approveJournal(user, matterId, journalId, input, audit);
  }

  postJournal(
    user: SessionUser,
    matterId: string,
    journalId: string,
    input: PostFinanceJournalInput,
    audit: AuditContext,
  ) {
    return this.store.postJournal(user, matterId, journalId, input, audit);
  }

  reverseJournal(
    user: SessionUser,
    matterId: string,
    journalId: string,
    input: ReverseFinanceJournalInput,
    audit: AuditContext,
  ) {
    return this.store.reverseJournal(user, matterId, journalId, input, audit);
  }
}
