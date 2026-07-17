/** Shared dealership option shape for Apex login + owner enter flows. */
export interface ApexDealershipOption {
  id: string;
  name: string;
  dealerCode: string | null;
  isPrimary?: boolean;
}

export function filterApexDealerships(
  dealerships: ApexDealershipOption[],
  query: string
): ApexDealershipOption[] {
  const term = query.trim().toLowerCase();
  if (!term) return dealerships;

  return dealerships.filter((dealership) => {
    const name = dealership.name.toLowerCase();
    const code = dealership.dealerCode?.toLowerCase() ?? '';
    return name.includes(term) || code.includes(term);
  });
}

/** Primary rooftops first, then alphabetical by name. */
export function sortApexDealerships(dealerships: ApexDealershipOption[]): ApexDealershipOption[] {
  return [...dealerships].sort((a, b) => {
    if (Boolean(a.isPrimary) !== Boolean(b.isPrimary)) {
      return a.isPrimary ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}