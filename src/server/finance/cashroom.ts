export class CashroomProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CashroomProjectionError';
  }
}

export interface MoneyAllocationProjectionInput {
  id: string;
  designation: 'client' | 'office' | 'suspense';
  amountMinor: number;
  cleared: boolean;
  restricted: boolean;
  reversed: boolean;
}

export interface CashbookProjectionInput {
  id: string;
  designation: 'client' | 'office';
  debitMinor: number;
  creditMinor: number;
  cleared: boolean;
}

function add(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value)) throw new CashroomProjectionError('Cashroom projection exceeded the safe integer range.');
  return value;
}

function money(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new CashroomProjectionError('Cashroom money must be a non-negative safe integer.');
  return value;
}

export function projectMatterMoney(allocations: MoneyAllocationProjectionInput[]) {
  let clientHeldMinor = 0;
  let clientClearedMinor = 0;
  let clientRestrictedMinor = 0;
  let clientAvailableMinor = 0;
  let officeHeldMinor = 0;
  let suspenseMinor = 0;
  for (const allocation of allocations) {
    const amount = money(allocation.amountMinor);
    if (allocation.reversed) continue;
    if (allocation.designation === 'client') {
      clientHeldMinor = add(clientHeldMinor, amount);
      if (allocation.cleared) clientClearedMinor = add(clientClearedMinor, amount);
      if (allocation.restricted) clientRestrictedMinor = add(clientRestrictedMinor, amount);
      if (allocation.cleared && !allocation.restricted) clientAvailableMinor = add(clientAvailableMinor, amount);
    } else if (allocation.designation === 'office') {
      officeHeldMinor = add(officeHeldMinor, amount);
    } else {
      suspenseMinor = add(suspenseMinor, amount);
    }
  }
  return { clientHeldMinor, clientClearedMinor, clientRestrictedMinor, clientAvailableMinor,
    officeHeldMinor, suspenseMinor, currency: 'GBP' as const };
}

export function projectCashbook(lines: CashbookProjectionInput[]) {
  let clientLedgerMinor = 0;
  let clientClearedMinor = 0;
  let officeLedgerMinor = 0;
  let officeClearedMinor = 0;
  for (const line of lines) {
    const debit = money(line.debitMinor);
    const credit = money(line.creditMinor);
    if ((debit === 0) === (credit === 0)) throw new CashroomProjectionError('A cashbook line requires exactly one debit or credit amount.');
    const movement = debit - credit;
    if (line.designation === 'client') {
      clientLedgerMinor = add(clientLedgerMinor, movement);
      if (line.cleared) clientClearedMinor = add(clientClearedMinor, movement);
    } else {
      officeLedgerMinor = add(officeLedgerMinor, movement);
      if (line.cleared) officeClearedMinor = add(officeClearedMinor, movement);
    }
  }
  return { clientLedgerMinor, clientClearedMinor, officeLedgerMinor, officeClearedMinor, currency: 'GBP' as const };
}
