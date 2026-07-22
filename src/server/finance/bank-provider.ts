import { createHash } from 'node:crypto';

export type NormalisedBankLine = {
  lineNumber: number;
  providerLineId: string | null;
  transactionDate: string;
  valueDate: string | null;
  amountMinor: number;
  reference: string;
  payerPayee: string;
  rawLineHash: string;
};

export interface BankActivityProvider {
  readonly source: 'manual' | 'csv' | 'provider';
  normalise(rawEvidence: string): NormalisedBankLine[];
}

export function maskBankAccountIdentifier(identifier: string): string {
  const digits = identifier.replace(/\D/g, '');
  if (digits.length < 4) throw new Error('A bank account identifier must contain at least four digits.');
  return `****${digits.slice(-4)}`;
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      values.push(value.trim()); value = '';
    } else value += character;
  }
  if (quoted) throw new Error('The CSV contains an unterminated quoted field.');
  values.push(value.trim());
  return values;
}

export class ManualCsvBankProvider implements BankActivityProvider {
  readonly source = 'csv' as const;

  normalise(rawEvidence: string): NormalisedBankLine[] {
    const rawLines = rawEvidence.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    while (rawLines.at(-1) === '') rawLines.pop();
    if (rawLines.length < 2) throw new Error('The CSV must contain a header and at least one statement line.');
    const expected = ['transaction_date', 'value_date', 'amount_minor', 'reference', 'payer_payee', 'provider_line_id'];
    const header = parseCsvLine(rawLines[0]!).map((value) => value.toLowerCase());
    if (header.length !== expected.length || header.some((value, index) => value !== expected[index])) {
      throw new Error(`The CSV header must be exactly: ${expected.join(',')}.`);
    }
    return rawLines.slice(1).map((rawLine, index) => {
      const values = parseCsvLine(rawLine);
      if (values.length !== expected.length) throw new Error(`CSV line ${index + 2} has the wrong number of fields.`);
      const amountMinor = Number(values[2]);
      if (!Number.isSafeInteger(amountMinor) || amountMinor === 0) throw new Error(`CSV line ${index + 2} has an invalid integer amount.`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(values[0]!)) throw new Error(`CSV line ${index + 2} has an invalid transaction date.`);
      if (values[1] && !/^\d{4}-\d{2}-\d{2}$/.test(values[1]!)) throw new Error(`CSV line ${index + 2} has an invalid value date.`);
      if (!values[3] || !values[4]) throw new Error(`CSV line ${index + 2} requires reference and payer/payee evidence.`);
      return {
        lineNumber: index + 2, transactionDate: values[0]!, valueDate: values[1] || null,
        amountMinor, reference: values[3]!, payerPayee: values[4]!, providerLineId: values[5] || null,
        rawLineHash: createHash('sha256').update(rawLine).digest('hex'),
      };
    });
  }
}
