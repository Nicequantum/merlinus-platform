'use client';

/**
 * Shared empty state when a product module is disabled for the rooftop.
 * Points staff to Manager Dashboard → Modules (not env break-glass first).
 */

interface ModuleDisabledNoticeProps {
  /** Human label shown in the title, e.g. "Parts" or "Loaner Car Management". */
  title: string;
  /** Product module id for optional local break-glass hint. */
  moduleId: string;
  /** Optional extra guidance under the main paragraph. */
  hint?: string;
}

export function ModuleDisabledNotice({ title, moduleId, hint }: ModuleDisabledNoticeProps) {
  return (
    <div className="benz-card p-6 text-sm text-benz-secondary" role="status">
      <p className="font-semibold text-benz-primary mb-2">{title} is disabled</p>
      <p>
        Ask a manager to enable this module for your rooftop under{' '}
        <strong>Manager Dashboard → Modules</strong>.
        {hint ? <> {hint}</> : null}
      </p>
      <p className="text-[11px] mt-3 text-benz-secondary/80 leading-relaxed">
        Local break-glass:{' '}
        <code className="text-xs">MODULES_FORCE_ENABLE={moduleId}</code>
      </p>
    </div>
  );
}
