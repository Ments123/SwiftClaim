import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z, type ZodType } from 'zod';

import {
  allocateFinanceReceiptSchema,
  approveFinanceBillSchema,
  approveFinanceClientOfficeTransferSchema,
  approveFinanceClientPaymentSchema,
  completeFinanceReconciliationSchema,
  importFinanceBankStatementSchema,
  issueFinanceBillSchema,
  postFinanceClientOfficeTransferSchema,
  prepareFinanceBillSchema,
  prepareFinanceClientOfficeTransferSchema,
  prepareFinanceClientPaymentSchema,
  recordFinanceBillDeliverySchema,
  recordFinanceClientPaymentSchema,
  recordFinanceReceiptSchema,
  reverseFinanceReceiptAllocationSchema,
  submitFinanceBillSchema,
} from '../../shared/contracts.js';
import type { SessionUser } from '../policy.js';
import type { AuditContext } from '../store.js';
import { deleteStoredFile, openStoredFile, storeUploadedFile, type StoredFile } from '../storage.js';
import {
  BillingCashroomStore,
  BillingCashroomStoreError,
  type DecideReconciliationMatchInput,
  type IssueCreditNoteInput,
  type PrepareCreditNoteInput,
  type PrepareReconciliationInput,
  type SignoffReconciliationInput,
} from './billing-cashroom-store.js';
import { FinanceCalculationError } from './calculations.js';

export interface BillingCashroomRoutesOptions {
  store: BillingCashroomStore;
  storagePath: string;
  requireUser: (request: FastifyRequest) => SessionUser;
  auditContext: (request: FastifyRequest) => AuditContext;
}

class InvalidBillingCashroomCommand extends Error {
  constructor(readonly fields: Record<string, string[] | undefined>) {
    super('Check the billing or cashroom command fields and try again.');
    this.name = 'InvalidBillingCashroomCommand';
  }
}

function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new InvalidBillingCashroomCommand(result.error.flatten().fieldErrors);
  return result.data;
}

function failure(error: unknown, reply: FastifyReply) {
  if (error instanceof InvalidBillingCashroomCommand) return reply.status(400).send({
    error: { code: 'BILLING_CASHROOM_INVALID', message: error.message, fields: error.fields },
  });
  if (error instanceof FinanceCalculationError) return reply.status(400).send({
    error: { code: error.code, message: error.message },
  });
  if (!(error instanceof BillingCashroomStoreError)) throw error;
  if (error.code === 'NOT_FOUND' || error.code === 'INVALID_LINK') return reply.status(404).send({
    error: { code: 'NOT_FOUND', message: 'Financial record not found.' },
  });
  if (error.code === 'FORBIDDEN') return reply.status(403).send({
    error: { code: 'FORBIDDEN', message: 'The financial action is not permitted.' },
  });
  return reply.status(409).send({ error: { code: error.code, message: error.message } });
}

const key = z.string().trim().min(8).max(200);
const uuid = z.string().uuid();
const dateTime = z.string().datetime({ offset: true });
const money = z.number().int().safe();
const prepareCreditNoteSchema: ZodType<PrepareCreditNoteInput> = z.object({
  idempotencyKey: key,
  reason: z.string().trim().min(10).max(2_000),
  lines: z.array(z.object({ billLineId: uuid, netMinor: money.positive(), vatMinor: money.nonnegative() }).strict()).min(1).max(1_000),
  explicitHumanConfirmation: z.literal(true),
}).strict();
const issueCreditNoteSchema: ZodType<IssueCreditNoteInput> = z.object({
  expectedVersion: z.number().int().positive(), idempotencyKey: key, issuedAt: dateTime, explicitHumanApproval: z.literal(true),
}).strict();
const reconciliationItemSchema = z.object({
  itemKind: z.enum(['statement_match', 'outstanding_lodgement', 'unpresented_payment', 'adjustment']),
  statementLineId: uuid.nullable(), journalId: uuid.nullable(), amountMinor: money,
  evidenceDocumentVersionId: uuid.nullable(), explanation: z.string().trim().min(5).max(2_000),
}).strict();
const prepareReconciliationSchema: ZodType<PrepareReconciliationInput> = z.object({
  idempotencyKey: key, bankAccountId: uuid, statementBatchId: uuid,
  ledgerClearedBalanceMinor: money, outstandingLodgementsMinor: money.nonnegative(),
  unpresentedPaymentsMinor: money.nonnegative(), documentedAdjustmentsMinor: money,
  items: z.array(reconciliationItemSchema).max(100_000), note: z.string().trim().min(10).max(2_000),
  explicitHumanConfirmation: z.literal(true),
}).strict();
const decideMatchSchema: ZodType<DecideReconciliationMatchInput> = z.object({
  expectedVersion: z.number().int().positive(), idempotencyKey: key, statementLineId: uuid,
  decision: z.enum(['confirm', 'split', 'reject']),
  matches: z.array(z.object({ journalId: uuid, amountMinor: money.refine((value) => value !== 0) }).strict()).max(100),
  explanation: z.string().trim().min(5).max(2_000), explicitHumanConfirmation: z.literal(true),
}).strict();
const signoffSchema: ZodType<SignoffReconciliationInput> = z.object({
  expectedVersion: z.number().int().positive(), idempotencyKey: key, signedOffAt: dateTime,
  note: z.string().trim().min(10).max(2_000), explicitHumanApproval: z.literal(true),
}).strict();
const statementEvidenceMetadataSchema = z.object({
  idempotencyKey: key, matterId: uuid, title: z.string().trim().min(5).max(300),
}).strict();

type Params = Record<'matterId' | 'billId' | 'creditNoteId' | 'receiptId' | 'allocationId' |
  'paymentId' | 'transferId' | 'batchId' | 'reconciliationId' | 'clientPartyId' | 'kind' |
  'recordId' | 'versionId', string>;

export const billingCashroomRoutes: FastifyPluginAsync<BillingCashroomRoutesOptions> = async (app, options) => {
  const user = (request: FastifyRequest) => options.requireUser(request);
  const audit = (request: FastifyRequest) => options.auditContext(request);
  const command = <T>(schema: ZodType<T>, request: FastifyRequest) => parse(schema, request.body);

  app.get('/api/finance/billing/matters/:matterId/workspace', async (request, reply) => {
    try {
      return { workspace: options.store.getMatterBillingWorkspace(user(request), (request.params as Params).matterId) };
    } catch (error) { return failure(error, reply); }
  });

  app.get('/api/finance/billing/matters/:matterId/bills/:billId', async (request, reply) => {
    try {
      const { matterId, billId } = request.params as Params;
      const bill = options.store.getBill(user(request), matterId, billId);
      if (!bill) throw new BillingCashroomStoreError('NOT_FOUND', 'The bill was not found.');
      return { bill };
    } catch (error) { return failure(error, reply); }
  });
  app.post('/api/finance/billing/matters/:matterId/bills', async (request, reply) => {
    try {
      const { matterId } = request.params as Params;
      return reply.status(201).send({ bill: options.store.prepareBill(user(request), matterId,
        command(prepareFinanceBillSchema, request), audit(request)) });
    } catch (error) { return failure(error, reply); }
  });
  for (const [suffix, schema, action] of [
    ['submit', submitFinanceBillSchema, 'submitBill'],
    ['approve', approveFinanceBillSchema, 'approveBill'],
    ['issue', issueFinanceBillSchema, 'issueBill'],
    ['deliver', recordFinanceBillDeliverySchema, 'recordBillDelivery'],
  ] as const) app.post(`/api/finance/billing/matters/:matterId/bills/:billId/${suffix}`, async (request, reply) => {
    try {
      const { matterId, billId } = request.params as Params;
      const result = options.store[action](user(request), matterId, billId,
        parse(schema as ZodType<unknown>, request.body) as never, audit(request));
      return reply.status(201).send({ bill: result });
    } catch (error) { return failure(error, reply); }
  });
  app.post('/api/finance/billing/matters/:matterId/bills/:billId/credit-notes', async (request, reply) => {
    try {
      const { matterId, billId } = request.params as Params;
      return reply.status(201).send({ creditNote: options.store.prepareCreditNote(user(request), matterId, billId,
        command(prepareCreditNoteSchema, request), audit(request)) });
    } catch (error) { return failure(error, reply); }
  });
  app.get('/api/finance/billing/matters/:matterId/credit-notes/:creditNoteId', async (request, reply) => {
    try {
      const { matterId, creditNoteId } = request.params as Params;
      const creditNote = options.store.getCreditNote(user(request), matterId, creditNoteId);
      if (!creditNote) throw new BillingCashroomStoreError('NOT_FOUND', 'The credit note was not found.');
      return { creditNote };
    } catch (error) { return failure(error, reply); }
  });
  app.post('/api/finance/billing/matters/:matterId/credit-notes/:creditNoteId/issue', async (request, reply) => {
    try {
      const { matterId, creditNoteId } = request.params as Params;
      return reply.status(201).send({ creditNote: options.store.issueCreditNote(user(request), matterId, creditNoteId,
        command(issueCreditNoteSchema, request), audit(request)) });
    } catch (error) { return failure(error, reply); }
  });

  app.post('/api/finance/cashroom/statements/evidence', async (request, reply) => {
    let stored: StoredFile | undefined;
    try {
      user(request);
      if (!request.isMultipart()) throw new InvalidBillingCashroomCommand({ file: ['Upload multipart statement evidence.'] });
      const fields: Record<string, string> = {};
      let originalName = '';
      let mimeType = 'application/octet-stream';
      for await (const part of request.parts()) {
        if (part.type === 'file') {
          if (stored) throw new InvalidBillingCashroomCommand({ file: ['Upload exactly one statement file.'] });
          originalName = part.filename;
          mimeType = part.mimetype;
          stored = await storeUploadedFile(options.storagePath, part.file);
        } else fields[part.fieldname] = String(part.value);
      }
      const metadata = parse(statementEvidenceMetadataSchema, fields);
      if (!stored) throw new InvalidBillingCashroomCommand({ file: ['Choose a statement file to upload.'] });
      if (originalName.length > 255) throw new InvalidBillingCashroomCommand({ file: ['The file name is too long.'] });
      const evidence = options.store.retainStatementEvidence(user(request), {
        ...metadata, originalName, mimeType, ...stored,
      }, audit(request));
      if (evidence.storageKey !== stored.storageKey) deleteStoredFile(options.storagePath, stored.storageKey);
      stored = undefined;
      const { storageKey: _storageKey, ...publicEvidence } = evidence;
      return reply.status(201).send({ evidence: publicEvidence });
    } catch (error) {
      if (stored) deleteStoredFile(options.storagePath, stored.storageKey);
      return failure(error, reply);
    }
  });

  app.post('/api/finance/cashroom/statements', async (request, reply) => {
    try { return reply.status(201).send({ statement: options.store.importBankStatement(user(request),
      command(importFinanceBankStatementSchema, request), audit(request)) });
    } catch (error) { return failure(error, reply); }
  });
  app.get('/api/finance/cashroom/statements/:batchId', async (request, reply) => {
    try {
      const statement = options.store.getBankStatementBatch(user(request), (request.params as Params).batchId);
      if (!statement) throw new BillingCashroomStoreError('NOT_FOUND', 'The statement was not found.');
      return { statement };
    } catch (error) { return failure(error, reply); }
  });
  app.post('/api/finance/cashroom/receipts', async (request, reply) => {
    try { return reply.status(201).send({ receipt: options.store.recordReceipt(user(request),
      command(recordFinanceReceiptSchema, request), audit(request)) });
    } catch (error) { return failure(error, reply); }
  });
  app.get('/api/finance/cashroom/receipts/:receiptId', async (request, reply) => {
    try {
      const receipt = options.store.getReceipt(user(request), (request.params as Params).receiptId);
      if (!receipt) throw new BillingCashroomStoreError('NOT_FOUND', 'The receipt was not found.');
      return { receipt };
    } catch (error) { return failure(error, reply); }
  });
  app.post('/api/finance/cashroom/receipts/:receiptId/allocations', async (request, reply) => {
    try { return reply.status(201).send({ receipt: options.store.allocateReceipt(user(request),
      (request.params as Params).receiptId, command(allocateFinanceReceiptSchema, request), audit(request)) });
    } catch (error) { return failure(error, reply); }
  });
  app.post('/api/finance/cashroom/receipts/:receiptId/allocations/reverse', async (request, reply) => {
    try { return reply.status(201).send({ receipt: options.store.reverseReceiptAllocation(user(request),
      (request.params as Params).receiptId, command(reverseFinanceReceiptAllocationSchema, request), audit(request)) });
    } catch (error) { return failure(error, reply); }
  });
  app.get('/api/finance/cashroom/matters/:matterId/clients/:clientPartyId/money', async (request, reply) => {
    try {
      const { matterId, clientPartyId } = request.params as Params;
      return { money: options.store.getMatterMoney(user(request), matterId, clientPartyId) };
    } catch (error) { return failure(error, reply); }
  });

  app.post('/api/finance/cashroom/matters/:matterId/payments', async (request, reply) => {
    try { return reply.status(201).send({ payment: options.store.prepareClientPayment(user(request),
      (request.params as Params).matterId, command(prepareFinanceClientPaymentSchema, request), audit(request)) });
    } catch (error) { return failure(error, reply); }
  });
  app.get('/api/finance/cashroom/matters/:matterId/payments/:paymentId', async (request, reply) => {
    try {
      const { matterId, paymentId } = request.params as Params;
      const payment = options.store.getClientPayment(user(request), matterId, paymentId);
      if (!payment) throw new BillingCashroomStoreError('NOT_FOUND', 'The payment was not found.');
      return { payment };
    } catch (error) { return failure(error, reply); }
  });
  for (const [suffix, schema, action] of [
    ['approve', approveFinanceClientPaymentSchema, 'approveClientPayment'],
    ['record', recordFinanceClientPaymentSchema, 'recordClientPayment'],
  ] as const) app.post(`/api/finance/cashroom/matters/:matterId/payments/:paymentId/${suffix}`, async (request, reply) => {
    try {
      const { matterId, paymentId } = request.params as Params;
      const result = options.store[action](user(request), matterId, paymentId,
        parse(schema as ZodType<unknown>, request.body) as never, audit(request));
      return reply.status(201).send({ payment: result });
    } catch (error) { return failure(error, reply); }
  });
  app.post('/api/finance/cashroom/matters/:matterId/transfers', async (request, reply) => {
    try { return reply.status(201).send({ transfer: options.store.prepareClientOfficeTransfer(user(request),
      (request.params as Params).matterId, command(prepareFinanceClientOfficeTransferSchema, request), audit(request)) });
    } catch (error) { return failure(error, reply); }
  });
  app.get('/api/finance/cashroom/matters/:matterId/transfers/:transferId', async (request, reply) => {
    try {
      const { matterId, transferId } = request.params as Params;
      const transfer = options.store.getClientOfficeTransfer(user(request), matterId, transferId);
      if (!transfer) throw new BillingCashroomStoreError('NOT_FOUND', 'The transfer was not found.');
      return { transfer };
    } catch (error) { return failure(error, reply); }
  });
  for (const [suffix, schema, action] of [
    ['approve', approveFinanceClientOfficeTransferSchema, 'approveClientOfficeTransfer'],
    ['post', postFinanceClientOfficeTransferSchema, 'postClientOfficeTransfer'],
  ] as const) app.post(`/api/finance/cashroom/matters/:matterId/transfers/:transferId/${suffix}`, async (request, reply) => {
    try {
      const { matterId, transferId } = request.params as Params;
      const result = options.store[action](user(request), matterId, transferId,
        parse(schema as ZodType<unknown>, request.body) as never, audit(request));
      return reply.status(201).send({ transfer: result });
    } catch (error) { return failure(error, reply); }
  });

  app.post('/api/finance/cashroom/reconciliations', async (request, reply) => {
    try { return reply.status(201).send({ reconciliation: options.store.prepareReconciliation(user(request),
      command(prepareReconciliationSchema, request), audit(request)) });
    } catch (error) { return failure(error, reply); }
  });
  app.get('/api/finance/cashroom/reconciliations/:reconciliationId', async (request, reply) => {
    try {
      const reconciliation = options.store.getReconciliation(user(request), (request.params as Params).reconciliationId);
      if (!reconciliation) throw new BillingCashroomStoreError('NOT_FOUND', 'The reconciliation was not found.');
      return { reconciliation };
    } catch (error) { return failure(error, reply); }
  });
  for (const [suffix, schema, action] of [
    ['matches', decideMatchSchema, 'decideReconciliationMatch'],
    ['complete', completeFinanceReconciliationSchema, 'completeReconciliation'],
    ['signoff', signoffSchema, 'signoffReconciliation'],
  ] as const) app.post(`/api/finance/cashroom/reconciliations/:reconciliationId/${suffix}`, async (request, reply) => {
    try {
      const reconciliationId = (request.params as Params).reconciliationId;
      const result = options.store[action](user(request), reconciliationId,
        parse(schema as ZodType<unknown>, request.body) as never, audit(request));
      return reply.status(201).send({ reconciliation: result });
    } catch (error) { return failure(error, reply); }
  });

  app.get('/api/finance/cashroom/exports/:kind', async (request, reply) => {
    try {
      const kind = (request.params as Params).kind;
      if (!['bills', 'cashbook', 'reconciliations'].includes(kind)) throw new BillingCashroomStoreError('NOT_FOUND', 'The export was not found.');
      const csv = options.store.exportRegister(user(request), kind as 'bills' | 'cashbook' | 'reconciliations');
      return reply.type('text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${kind}.csv"`).send(csv);
    } catch (error) { return failure(error, reply); }
  });

  app.get('/api/finance/documents/:kind/:recordId/versions/:versionId/download', async (request, reply) => {
    try {
      const { kind, recordId, versionId } = request.params as Params;
      const matterId = (request.query as { matterId?: string }).matterId;
      if (!['bill','credit_note','receipt','payment','statement','reconciliation'].includes(kind))
        throw new BillingCashroomStoreError('NOT_FOUND', 'The financial document was not found.');
      const file = options.store.getFinancialDocumentFile(user(request), {
        kind: kind as 'bill' | 'credit_note' | 'receipt' | 'payment' | 'statement' | 'reconciliation',
        recordId, documentVersionId: versionId, matterId,
      });
      if (!file) throw new BillingCashroomStoreError('NOT_FOUND', 'The financial document was not found.');
      const safeName = file.originalName.replace(/["\\\r\n]/g, '_');
      reply.type(file.mimeType).header('content-length', String(file.sizeBytes))
        .header('x-content-type-options', 'nosniff')
        .header('content-disposition', `attachment; filename="${safeName}"`);
      return reply.send(openStoredFile(options.storagePath, file.storageKey));
    } catch (error) { return failure(error, reply); }
  });
};
