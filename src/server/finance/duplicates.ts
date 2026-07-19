import { createHash } from 'node:crypto';

export interface DisbursementDuplicateRecord {
  id: string;
  supplier: string;
  invoiceReference: string;
  grossMinor: number;
  invoiceDate: string | null;
}

export interface DisbursementDuplicateCandidate {
  supplier: string;
  invoiceReference: string;
  grossMinor: number;
  invoiceDate: string | null;
}

function normaliseSupplier(value: string): string {
  const tokens = value.normalize('NFKD').toLowerCase().replaceAll('&', ' and ')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/)
    .filter((token) => token && !['limited', 'ltd', 'llp', 'plc', 'incorporated', 'inc'].includes(token));
  return tokens.join(' ');
}

function normaliseReference(value: string): string {
  return value.normalize('NFKD').toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

export function findPotentialDisbursementDuplicates(
  existing: DisbursementDuplicateRecord[],
  candidate: DisbursementDuplicateCandidate,
) {
  const supplier = normaliseSupplier(candidate.supplier);
  const reference = normaliseReference(candidate.invoiceReference);
  return existing.flatMap((record) => {
    const supplierMatches = supplier.length > 0 && normaliseSupplier(record.supplier) === supplier;
    const referenceMatches = reference.length > 0 && normaliseReference(record.invoiceReference) === reference;
    const grossMatches = Number.isSafeInteger(candidate.grossMinor)
      && candidate.grossMinor >= 0 && record.grossMinor === candidate.grossMinor;
    const dateMatches = candidate.invoiceDate !== null
      && record.invoiceDate !== null && record.invoiceDate === candidate.invoiceDate;
    if (!supplierMatches || !grossMatches || (!referenceMatches && !dateMatches)) return [];
    const matchedFields = [
      supplierMatches ? 'supplier' : null,
      referenceMatches ? 'invoice_reference' : null,
      grossMatches ? 'gross_minor' : null,
      dateMatches ? 'invoice_date' : null,
    ].filter((field): field is string => field !== null);
    const fingerprint = createHash('sha256').update(JSON.stringify({
      existingDisbursementId: record.id,
      supplier,
      reference,
      grossMinor: candidate.grossMinor,
      invoiceDate: candidate.invoiceDate,
    })).digest('hex');
    return [{
      findingKey: fingerprint,
      existingDisbursementId: record.id,
      confidence: referenceMatches && dateMatches ? 'high' as const : 'medium' as const,
      matchedFields,
      label: 'Possible duplicate — human review required' as const,
      provisional: true as const,
      blocksAutomaticApproval: true as const,
      explanation: 'Supplier and amount matched with an invoice reference or date. A human must confirm whether this is a duplicate.',
    }];
  }).sort((left, right) => left.existingDisbursementId.localeCompare(right.existingDisbursementId));
}
