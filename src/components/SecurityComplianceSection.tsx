import { Check, Shield } from 'lucide-react';
import { CONSENT_VERSION } from '@/types';

interface SecurityComplianceSectionProps {
  consentAt: string | null;
}

const SECURITY_CATEGORIES: Array<{ title: string; items: string[] }> = [
  {
    title: 'Data Encryption',
    items: [
      'Customer PII and repair content encrypted at rest using AES-256-GCM',
      'Phase 3 PII migration: dual-storage active (plaintext + encrypted columns until Phase 4 cutover)',
    ],
  },
  {
    title: 'Access Control',
    items: [
      'Session-based authentication with 8-hour expiry',
      'Diagnostic images protected with strict authorization checks on upload and update',
      'Images stored in Vercel Blob with session-based private access',
      'Optimistic concurrency control to prevent data corruption',
    ],
  },
  {
    title: 'AI Safety',
    items: [
      'Grok API key secured server-side — never exposed in browser',
      'Enterprise Grok Business account with Data Processing Agreement (DPA) in place',
    ],
  },
  {
    title: 'Infrastructure Security',
    items: [
      'Production-grade distributed rate limiting using Vercel KV',
      'Pre-deployment validation gates (environment, secrets, AI timeouts, PII checks)',
      'Complete separation of in-app UI from PWA/home screen assets',
      'Regular security hardening updates and monitoring via Sentry',
    ],
  },
  {
    title: 'Compliance & Auditing',
    items: [
      'Full audit logging of all warranty story modifications',
      'Audit-safe warranty prompt — no fabricated data',
    ],
  },
];

export function SecurityComplianceSection({ consentAt }: SecurityComplianceSectionProps) {
  return (
    <div className="benz-card p-5 mb-5">
      <div className="flex items-center gap-2.5 mb-3">
        <Shield size={18} className="text-benz-green" />
        <div className="font-semibold text-sm tracking-tight">Security & Compliance</div>
      </div>

      <p className="text-xs text-benz-secondary leading-relaxed mb-5">
        Merlin is built for Mercedes-Benz dealership warranty operations with enterprise-grade data
        protection, controlled AI access, and audit-ready documentation for management review.
      </p>

      <div className="space-y-5">
        {SECURITY_CATEGORIES.map((category) => (
          <div key={category.title}>
            <div className="benz-section-title mb-2.5">{category.title}</div>
            <ul className="text-xs text-benz-secondary space-y-2 leading-relaxed">
              {category.items.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <Check size={14} className="text-benz-green shrink-0 mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-5 pt-4 border-t border-benz-border text-xs text-benz-muted">
        Consent accepted:{' '}
        {consentAt ? new Date(consentAt).toLocaleDateString() : 'Pending'} (v{CONSENT_VERSION})
      </div>
    </div>
  );
}