'use client';

interface ApexOwnerDealershipBarProps {
  dealershipName: string;
  /** e.g. "Service Manager", "Technician", "Dealership Owner" */
  viewAsLabel?: string;
  /** Button label — group owners return to group, platform to national. */
  exitLabel?: string;
  loading?: boolean;
  onExit: () => void;
}

/** Sticky scope indicator when an owner has entered dealership context. */
export function ApexOwnerDealershipBar({
  dealershipName,
  viewAsLabel,
  exitLabel = 'Return to National Owner',
  loading = false,
  onExit,
}: ApexOwnerDealershipBarProps) {
  return (
    <div className="apex-owner-scope-bar" data-platform="apex" role="status">
      <div className="apex-owner-scope-bar-inner">
        <div className="apex-owner-scope-copy">
          <span className="apex-owner-scope-label">
            {viewAsLabel ? `Viewing as ${viewAsLabel}` : 'Dealership scope'}
          </span>
          <span className="apex-owner-scope-name">{dealershipName}</span>
          {viewAsLabel ? (
            <span className="apex-owner-scope-hint">
              National Owner identity preserved · actions audited
            </span>
          ) : null}
        </div>
        <button
          type="button"
          className="apex-btn-secondary apex-owner-exit-btn touch-target"
          disabled={loading}
          aria-busy={loading}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (loading) return;
            onExit();
          }}
        >
          {loading ? 'Returning…' : exitLabel}
        </button>
      </div>
    </div>
  );
}
