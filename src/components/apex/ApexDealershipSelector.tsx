'use client';

import { useMemo, useState } from 'react';
import {
  filterApexDealerships,
  sortApexDealerships,
  type ApexDealershipOption,
} from '@/lib/apexDealershipOptions';

export interface ApexDealershipSelectOptions {
  rememberAsDefault: boolean;
}

interface ApexDealershipSelectorProps {
  dealerships: ApexDealershipOption[];
  loading?: boolean;
  title?: string;
  subtitle?: string;
  showRememberDefault?: boolean;
  rememberDefaultLabel?: string;
  onSelect: (dealershipId: string, options: ApexDealershipSelectOptions) => void;
  onBack?: () => void;
  backLabel?: string;
}

export function ApexDealershipSelector({
  dealerships,
  loading = false,
  title = 'Select dealership',
  subtitle = 'Choose the rooftop you are working in today.',
  showRememberDefault = true,
  rememberDefaultLabel = 'Remember as my default rooftop',
  onSelect,
  onBack,
  backLabel = 'Back',
}: ApexDealershipSelectorProps) {
  const [query, setQuery] = useState('');
  const [rememberAsDefault, setRememberAsDefault] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sorted = useMemo(() => sortApexDealerships(dealerships), [dealerships]);
  const filtered = useMemo(() => filterApexDealerships(sorted, query), [sorted, query]);

  const handleSelect = (dealershipId: string) => {
    if (loading) return;
    setActiveId(dealershipId);
    onSelect(dealershipId, { rememberAsDefault: showRememberDefault && rememberAsDefault });
  };

  return (
    <div className="apex-dealership-selector">
      <div className="apex-dealership-selector-header">
        <p className="apex-label">{title}</p>
        <p className="apex-hint">{subtitle}</p>
      </div>

      <div className="apex-dealership-search-wrap">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or dealer code…"
          className="apex-input apex-dealership-search"
          aria-label="Search dealerships"
          disabled={loading}
        />
        <span className="apex-dealership-search-icon" aria-hidden="true">
          ⌕
        </span>
      </div>

      {showRememberDefault ? (
        <label className="apex-remember-default">
          <input
            type="checkbox"
            checked={rememberAsDefault}
            onChange={(e) => setRememberAsDefault(e.target.checked)}
            disabled={loading}
          />
          <span>{rememberDefaultLabel}</span>
        </label>
      ) : null}

      <div
        className="apex-dealership-list"
        role="listbox"
        aria-label="Dealerships"
        aria-busy={loading}
      >
        {filtered.length === 0 ? (
          <p className="apex-dealership-empty">No dealerships match your search.</p>
        ) : (
          filtered.map((dealership) => {
            const isActive = activeId === dealership.id && loading;
            return (
              <button
                key={dealership.id}
                type="button"
                role="option"
                aria-selected={isActive}
                disabled={loading}
                className={[
                  'apex-dealership-option',
                  'touch-target',
                  isActive ? 'apex-dealership-option--active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => handleSelect(dealership.id)}
              >
                <span className="apex-dealership-option-top">
                  <span className="apex-dealership-name">{dealership.name}</span>
                  {dealership.isPrimary ? (
                    <span className="apex-dealership-primary-badge">Primary</span>
                  ) : null}
                </span>
                <span className="apex-dealership-meta">
                  {dealership.dealerCode ? `Dealer ${dealership.dealerCode}` : 'Dealership rooftop'}
                </span>
              </button>
            );
          })
        )}
      </div>

      {onBack ? (
        <button
          type="button"
          disabled={loading}
          className="apex-btn-secondary w-full touch-target"
          onClick={onBack}
        >
          {backLabel}
        </button>
      ) : null}
    </div>
  );
}