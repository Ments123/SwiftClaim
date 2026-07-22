import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { migrations, runMigrations } from './migrations/index.js';
import type { Migration } from './migrations/types.js';

function memoryDatabase() {
  return new DatabaseSync(':memory:');
}

describe('runMigrations', () => {
  it('exposes the canonical migrations in version order', () => {
    expect(
      migrations.map(({ version, name }) => ({ version, name })),
    ).toEqual([
      { version: 1, name: 'secure matter spine' },
      { version: 2, name: 'workflow foundation' },
      { version: 3, name: 'intake and onboarding' },
      { version: 4, name: 'defects notice and evidence' },
      { version: 5, name: 'protocol and experts' },
      { version: 6, name: 'repairs quantum and offers' },
      { version: 7, name: 'governed communications' },
      { version: 8, name: 'negotiation and settlement authority' },
      { version: 9, name: 'governed proceedings' },
      { version: 10, name: 'governed pleadings and response control' },
      { version: 11, name: 'governed disclosure and evidence' },
      { version: 12, name: 'governed finance foundation' },
      { version: 13, name: 'governed billing and cashroom' },
    ]);
    expect(migrations.every(({ checksum }) => checksum.length === 64)).toBe(
      true,
    );
  });

  it('creates tenant-safe immutable billing and cashroom infrastructure', () => {
    const database = memoryDatabase();
    runMigrations(database, migrations, '2026-07-21T12:00:00.000Z');
    const tableNames = (database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>)
      .map(({ name }) => name);
    expect(tableNames).toEqual(expect.arrayContaining([
      'finance_vat_profiles', 'finance_vat_rates', 'finance_bill_series',
      'finance_bills', 'finance_bill_versions', 'finance_bill_lines', 'finance_bill_events',
      'finance_bill_source_allocations', 'finance_bill_documents',
      'finance_credit_notes', 'finance_credit_note_lines', 'finance_credit_note_events',
      'finance_bank_accounts', 'finance_bank_statement_batches', 'finance_bank_statement_lines',
      'finance_receipts', 'finance_receipt_events', 'finance_receipt_allocations',
      'finance_payment_requisitions', 'finance_payment_events',
      'finance_client_office_transfers', 'finance_transfer_events',
      'finance_reconciliations', 'finance_reconciliation_items',
      'finance_reconciliation_events', 'finance_reconciliation_signoffs',
      'finance_exceptions', 'finance_export_manifests',
    ]));

    const triggerNames = (database.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'finance_%'").all() as Array<{ name: string }>)
      .map(({ name }) => name);
    expect(triggerNames).toEqual(expect.arrayContaining([
      'finance_bill_lines_no_update', 'finance_bill_lines_no_delete',
      'finance_bill_events_no_update', 'finance_bill_events_no_delete',
      'finance_statement_lines_no_update', 'finance_statement_lines_no_delete',
      'finance_receipt_allocations_no_update', 'finance_receipt_allocations_no_delete',
      'finance_reconciliation_signoffs_no_update', 'finance_reconciliation_signoffs_no_delete',
    ]));

    const billSeriesSql = String((database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='finance_bill_series'").get() as { sql: string }).sql);
    expect(billSeriesSql).toMatch(/next_number.*CHECK\(next_number > 0/s);
    const billSql = String((database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='finance_bills'").get() as { sql: string }).sql);
    expect(billSql).toMatch(/UNIQUE\(firm_id,series_id,bill_number\)/);
    expect(billSql).toMatch(/FOREIGN KEY \(client_party_id,firm_id,matter_id\)/);
    const statementBatchSql = String((database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='finance_bank_statement_batches'").get() as { sql: string }).sql);
    expect(statementBatchSql).toMatch(/UNIQUE\(firm_id,bank_account_id,raw_checksum\)/);

    for (const eventTable of [
      'finance_bill_events', 'finance_credit_note_events', 'finance_receipt_events',
      'finance_payment_events', 'finance_transfer_events', 'finance_reconciliation_events',
    ]) {
      const columns = (database.prepare(`PRAGMA table_info(${eventTable})`).all() as Array<{ name: string }>).map(({ name }) => name);
      expect(columns, `${eventTable} needs deterministic causal ordering`).toContain('sequence');
    }
  });

  it('creates tenant-safe immutable finance and journal infrastructure', () => {
    const database = memoryDatabase();
    runMigrations(database, migrations, '2026-07-19T12:00:00.000Z');
    const tableNames = (database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(({ name }) => name);
    expect(tableNames).toEqual(expect.arrayContaining([
      'finance_activity_suggestions', 'finance_activity_suggestion_decisions',
      'finance_timer_sessions', 'finance_timer_events', 'finance_rate_cards',
      'finance_rate_versions', 'finance_rate_version_events', 'finance_rate_entries', 'finance_time_entries',
      'finance_time_approvals', 'finance_time_entry_events', 'finance_estimates', 'finance_estimate_versions',
      'finance_estimate_thresholds', 'finance_warning_events', 'finance_disbursements',
      'finance_disbursement_events', 'finance_accounts', 'finance_accounting_periods',
      'finance_journals', 'finance_journal_lines', 'finance_journal_events',
      'finance_command_receipts', 'finance_firm_events', 'finance_integration_outbox',
    ]));
    const triggerNames = (database.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'finance_%'").all() as Array<{ name: string }>).map(({ name }) => name);
    expect(triggerNames).toEqual(expect.arrayContaining([
      'finance_rate_versions_no_update', 'finance_time_entry_events_no_delete',
      'finance_rate_version_events_no_delete',
      'finance_time_approvals_no_update', 'finance_firm_events_no_delete',
      'finance_accounts_no_update', 'finance_accounts_no_delete',
      'finance_journals_no_delete', 'finance_journal_lines_no_update',
      'finance_journal_events_no_delete', 'finance_command_receipts_no_update',
    ]));
    const lineSql = String((database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'finance_journal_lines'").get() as { sql: string }).sql);
    expect(lineSql).toMatch(/debit_minor > 0.*credit_minor = 0|credit_minor > 0.*debit_minor = 0/s);
    for (const table of [
      'finance_activity_suggestions', 'finance_rate_entries', 'finance_time_entries',
      'finance_estimate_versions', 'finance_estimate_warnings',
      'finance_disbursements', 'finance_journal_lines',
    ]) {
      const tableSql = String((database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { sql: string }).sql);
      expect(tableSql, `${table} must reject values outside JavaScript's exact integer range`).toContain('9007199254740991');
    }
    const receiptSql = String((database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'finance_command_receipts'").get() as { sql: string }).sql);
    expect(receiptSql).toMatch(/scope_kind.*firm.*matter/s);
    expect(receiptSql).toMatch(/matter_id TEXT(?! NOT NULL)/);
    const suggestionColumns = (database.prepare('PRAGMA table_info(finance_activity_suggestions)').all() as Array<{ name: string }>).map(({ name }) => name);
    expect(suggestionColumns).toContain('observed_at');
    const timeColumns = (database.prepare('PRAGMA table_info(finance_time_entries)').all() as Array<{ name: string }>).map(({ name }) => name);
    expect(timeColumns).not.toContain('status');
    const disbursementColumns = (database.prepare('PRAGMA table_info(finance_disbursements)').all() as Array<{ name: string }>).map(({ name }) => name);
    expect(disbursementColumns).not.toContain('version');
    for (const eventTable of [
      'finance_timer_events', 'finance_rate_version_events', 'finance_time_entry_events',
      'finance_warning_events', 'finance_disbursement_events', 'finance_journal_events',
    ]) {
      const columns = (database.prepare(`PRAGMA table_info(${eventTable})`).all() as Array<{ name: string }>).map(({ name }) => name);
      expect(columns, `${eventTable} needs deterministic causal ordering`).toContain('sequence');
    }
  });

  it('creates tenant-safe immutable disclosure records', () => {
    const database = memoryDatabase();
    runMigrations(database, migrations, '2026-07-18T18:00:00.000Z');
    const names = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all().map((row) => String((row as { name: unknown }).name));
    expect(names).toEqual(expect.arrayContaining([
      'disclosure_reviews', 'disclosure_review_events', 'disclosure_documents',
      'disclosure_ai_suggestions', 'disclosure_decisions', 'disclosure_privilege_reviews',
      'disclosure_redactions', 'disclosure_lists', 'disclosure_list_entries',
      'inspection_requests', 'inspection_request_items', 'inspection_events',
      'disclosure_command_receipts',
    ]));
  });

  it('creates immutable tenant-safe pleading response records', () => {
    const database = memoryDatabase();
    runMigrations(database, migrations, '2026-07-18T14:00:00.000Z');

    const tableNames = (database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>).map(({ name }) => name);
    expect(tableNames).toEqual(expect.arrayContaining([
      'claim_response_tracks',
      'claim_response_track_events',
      'statements_of_case',
      'statement_of_case_versions',
      'statement_of_case_events',
      'statement_amendment_authorities',
      'pleading_deadline_projections',
      'default_judgment_reviews',
      'default_judgment_review_items',
      'default_judgment_review_events',
      'pleadings_command_receipts',
    ]));

    const triggerNames = (database
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger'
        AND (name LIKE 'statement_of_case_%' OR name LIKE 'statement_amendment_%' OR name LIKE 'pleading_%'
          OR name LIKE 'claim_response_%' OR name LIKE 'default_judgment_%')`)
      .all() as Array<{ name: string }>).map(({ name }) => name);
    expect(triggerNames).toEqual(expect.arrayContaining([
      'statement_of_case_events_no_delete',
      'statement_of_case_versions_no_update',
      'statement_amendment_authorities_no_update',
      'pleading_deadline_projections_no_delete',
      'claim_response_track_events_no_update',
      'default_judgment_review_items_no_delete',
      'default_judgment_review_events_no_delete',
    ]));
  });

  it('creates tenant-safe proceedings tables with immutable legal events', () => {
    const database = memoryDatabase();
    runMigrations(database, migrations, '2026-07-16T14:00:00.000Z');

    const tableNames = (database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>).map(({ name }) => name);
    expect(tableNames).toEqual(expect.arrayContaining([
      'court_proceedings',
      'proceeding_authority_versions',
      'court_proceeding_events',
      'court_documents',
      'court_filings',
      'court_filing_documents',
      'court_filing_events',
      'court_service_records',
      'court_service_events',
      'court_applications',
      'court_application_events',
      'court_orders',
      'court_directions',
      'court_direction_events',
      'court_hearings',
      'court_hearing_events',
      'proceedings_command_receipts',
    ]));

    const triggerNames = (database
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger'
        AND (name LIKE 'court_%' OR name LIKE 'proceeding_%')`)
      .all() as Array<{ name: string }>).map(({ name }) => name);
    expect(triggerNames).toEqual(expect.arrayContaining([
      'proceeding_authority_versions_no_update',
      'court_proceeding_events_no_delete',
      'court_filing_events_no_update',
      'court_service_events_no_delete',
      'court_orders_no_update',
      'court_direction_events_no_delete',
      'court_hearing_events_no_update',
      'proceedings_command_receipts_no_delete',
    ]));
  });

  it('creates negotiation and settlement tables with immutable authority records', () => {
    const database = memoryDatabase();
    runMigrations(database, migrations, '2026-07-16T12:00:00.000Z');

    const tableNames = (database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>).map(({ name }) => name);
    expect(tableNames).toEqual(expect.arrayContaining([
      'negotiation_reviews',
      'client_instructions',
      'settlement_authority_versions',
      'negotiation_actions',
      'negotiation_action_versions',
      'negotiation_approval_events',
      'negotiation_external_acts',
      'settlements',
      'settlement_term_versions',
      'settlement_obligations',
      'settlement_obligation_events',
      'negotiation_command_receipts',
    ]));

    const triggerNames = (database
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'trigger'
           AND (name LIKE 'negotiation_%'
             OR name LIKE 'client_instruction%'
             OR name LIKE 'settlement_%')`,
      )
      .all() as Array<{ name: string }>).map(({ name }) => name);
    expect(triggerNames).toEqual(expect.arrayContaining([
      'negotiation_reviews_no_update',
      'client_instructions_no_delete',
      'settlement_authority_versions_no_update',
      'negotiation_action_versions_no_delete',
      'negotiation_approval_events_no_update',
      'negotiation_external_acts_no_delete',
      'settlement_term_versions_no_update',
      'settlement_obligation_events_no_delete',
      'negotiation_command_receipts_no_update',
    ]));
  });

  it('creates governed communication tables with immutable event guards', () => {
    const database = memoryDatabase();
    runMigrations(database, migrations, '2026-07-16T09:00:00.000Z');

    const tableNames = (database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>).map(({ name }) => name);
    expect(tableNames).toEqual(expect.arrayContaining([
      'communication_conversations',
      'communication_participants',
      'communication_entries',
      'communication_attachments',
      'communication_drafts',
      'communication_draft_versions',
      'communication_approval_events',
      'communication_dispatches',
      'communication_provider_events',
      'communication_call_sessions',
      'communication_service_assertions',
      'communication_command_receipts',
    ]));

    const triggerNames = (database
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'trigger' AND name LIKE 'communication_%'`,
      )
      .all() as Array<{ name: string }>).map(({ name }) => name);
    expect(triggerNames).toEqual(expect.arrayContaining([
      'communication_entries_no_update',
      'communication_entries_no_delete',
      'communication_draft_versions_no_update',
      'communication_approval_events_no_delete',
      'communication_provider_events_no_update',
      'communication_attachments_no_delete',
      'communication_service_assertions_no_update',
    ]));
  });

  it('creates repairs quantum and offer tables with immutable legal records', () => {
    const database = memoryDatabase();
    runMigrations(database, migrations, '2026-07-15T09:00:00.000Z');

    const tableNames = new Set(
      (database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>).map(({ name }) => name),
    );
    expect([...tableNames]).toEqual(
      expect.arrayContaining([
        'work_schedules',
        'work_items',
        'work_item_defects',
        'work_item_evidence_links',
        'repair_events',
        'loss_schedules',
        'loss_items',
        'loss_item_evidence_links',
        'general_damages_reviews',
        'offers',
        'part_36_terms',
        'offer_events',
        'quantum_command_receipts',
      ]),
    );

    const triggerNames = new Set(
      (database
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'trigger'
             AND (name LIKE 'work_%' OR name LIKE 'repair_%'
               OR name LIKE 'loss_%' OR name LIKE 'general_damages_%'
               OR name LIKE 'offer_%' OR name LIKE 'part_36_%')`,
        )
        .all() as Array<{ name: string }>).map(({ name }) => name),
    );
    expect([...triggerNames]).toEqual(
      expect.arrayContaining([
        'work_schedules_approved_no_update',
        'work_items_approved_no_update',
        'repair_events_no_update',
        'loss_schedules_approved_no_update',
        'loss_items_approved_no_update',
        'work_item_evidence_links_no_delete',
        'repair_event_evidence_links_no_delete',
        'loss_item_evidence_links_no_delete',
        'general_damages_reviews_no_update',
        'offer_events_no_update',
      ]),
    );
  });

  it('creates the governed protocol and expert tables with immutable guards', () => {
    const database = memoryDatabase();
    runMigrations(database, migrations, '2026-07-14T14:00:00.000Z');

    const tableNames = new Set(
      (database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>).map(({ name }) => name),
    );
    expect([...tableNames]).toEqual(expect.arrayContaining([
      'protocol_cases',
      'letters_of_claim',
      'letter_of_claim_versions',
      'protocol_service_events',
      'landlord_responses',
      'landlord_response_defects',
      'expert_engagements',
      'expert_conflict_checks',
      'expert_instruction_versions',
      'expert_milestone_events',
      'expert_report_records',
      'expert_questions',
      'expert_question_answers',
    ]));

    const triggerNames = (database
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'trigger'
           AND (name LIKE 'protocol_%' OR name LIKE 'expert_%'
             OR name LIKE 'letter_%' OR name LIKE 'landlord_%')`,
      )
      .all() as Array<{ name: string }>).map(({ name }) => name);
    expect(triggerNames).toEqual(expect.arrayContaining([
      'letter_of_claim_versions_no_update',
      'protocol_service_events_no_delete',
      'landlord_responses_no_update',
      'expert_report_records_no_delete',
      'expert_question_answers_no_update',
    ]));
  });

  it('applies migrations once in version order and records checksums', () => {
    const database = memoryDatabase();
    const migrations: Migration[] = [
      {
        version: 1,
        name: 'one',
        checksum: 'one-hash',
        sql: 'CREATE TABLE one (id TEXT);',
      },
      {
        version: 2,
        name: 'two',
        checksum: 'two-hash',
        sql: 'CREATE TABLE two (id TEXT);',
      },
    ];

    runMigrations(database, migrations, '2026-07-13T12:00:00.000Z');
    runMigrations(database, migrations, '2026-07-13T13:00:00.000Z');

    expect(
      database
        .prepare(
          'SELECT version, name, checksum FROM schema_migrations ORDER BY version',
        )
        .all(),
    ).toEqual([
      { version: 1, name: 'one', checksum: 'one-hash' },
      { version: 2, name: 'two', checksum: 'two-hash' },
    ]);
  });

  it('rolls back a failed migration without recording it', () => {
    const database = memoryDatabase();

    expect(() =>
      runMigrations(
        database,
        [
          {
            version: 1,
            name: 'broken',
            checksum: 'broken-hash',
            sql: 'CREATE TABLE ok (id TEXT); INVALID SQL;',
          },
        ],
        '2026-07-13T12:00:00.000Z',
      ),
    ).toThrow();

    const table = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ok'",
      )
      .get();
    expect(table).toBeUndefined();
  });

  it('rejects a checksum mismatch for an applied migration', () => {
    const database = memoryDatabase();
    runMigrations(
      database,
      [
        {
          version: 1,
          name: 'one',
          checksum: 'original',
          sql: 'CREATE TABLE one (id TEXT);',
        },
      ],
      '2026-07-13T12:00:00.000Z',
    );

    expect(() =>
      runMigrations(
        database,
        [
          {
            version: 1,
            name: 'one',
            checksum: 'changed',
            sql: 'CREATE TABLE one (id TEXT);',
          },
        ],
        '2026-07-13T13:00:00.000Z',
      ),
    ).toThrow('Migration 1 checksum mismatch');
  });

  it('upgrades metadata columns from the legacy Step 1 migration table', () => {
    const database = memoryDatabase();
    database.exec(`CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    ) STRICT;`);
    database
      .prepare(
        'INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)',
      )
      .run('2026-07-13T11:00:00.000Z');

    runMigrations(
      database,
      [
        {
          version: 1,
          name: 'secure matter spine',
          checksum: 'baseline-hash',
          sql: 'CREATE TABLE firms (id TEXT PRIMARY KEY);',
        },
      ],
      '2026-07-13T12:00:00.000Z',
    );

    expect(
      database
        .prepare(
          'SELECT version, name, checksum FROM schema_migrations WHERE version = 1',
        )
        .get(),
    ).toEqual({
      version: 1,
      name: 'secure matter spine',
      checksum: 'baseline-hash',
    });
  });
});
