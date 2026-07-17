'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApexLogoMark } from '@/components/apex/ApexLogoMark';
import { LEGAL_DISCLAIMER_VERSION } from '@/types';

interface LegalDisclaimerModalProps {
  onAccept: () => void | Promise<void>;
  loading?: boolean;
}

export function LegalDisclaimerModal({ onAccept, loading }: LegalDisclaimerModalProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const checkScrollPosition = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const noScrollNeeded = el.scrollHeight <= el.clientHeight + 16;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 16;
    setScrolledToBottom(noScrollNeeded || atBottom);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    checkScrollPosition();
    const resizeObserver = new ResizeObserver(checkScrollPosition);
    resizeObserver.observe(el);
    el.addEventListener('scroll', checkScrollPosition, { passive: true });
    return () => {
      resizeObserver.disconnect();
      el.removeEventListener('scroll', checkScrollPosition);
    };
  }, [checkScrollPosition]);

  const canAccept = scrolledToBottom && acknowledged;

  return (
    <div className="benz-modal-overlay z-[100] p-4">
      <div className="benz-modal-panel sm:max-w-lg w-full max-h-[92dvh] flex flex-col">
        <div className="p-6 pb-4 shrink-0">
          <div className="flex items-center gap-3.5 mb-4">
            <ApexLogoMark size="md" title="Apex" />
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Technician Legal Acknowledgment</h2>
              <p className="text-xs text-benz-secondary mt-0.5">
                Required before use • Mercedes-Benz Authorized Dealer • v{LEGAL_DISCLAIMER_VERSION}
              </p>
            </div>
          </div>
        </div>

        <div
          ref={scrollRef}
          className="px-6 overflow-y-auto flex-1 text-sm text-benz-silver space-y-4 leading-relaxed border-y border-benz-border/40"
        >
          <p>
            You are accessing Merlinus, an artificial intelligence-assisted documentation tool made available to
            authorized Mercedes-Benz franchise dealership service technicians. Merlinus is intended solely as a{' '}
            <strong className="text-benz-primary">decision-support and drafting assistant</strong>. It does not
            replace your professional judgment, manufacturer warranty policy, or dealership procedures.
          </p>

          <p>
            <strong className="text-benz-primary">Artificial intelligence limitations.</strong> AI-generated warranty
            narratives, audit scores, and coaching feedback are produced from the information you provide and from
            patterns learned from historical documentation. Outputs may be incomplete, imprecise, or unsuitable for
            submission without your independent verification. Mercedes-Benz AG, your franchised dealer, and the
            developers of Merlinus make no warranty that any AI output is accurate, complete, or acceptable for warranty
            reimbursement.
          </p>

          <p>
            <strong className="text-benz-primary">Your sole responsibility.</strong> As the servicing technician, you
            remain{' '}
            <strong className="text-benz-primary">
              solely and fully responsible for the accuracy, completeness, and truthfulness
            </strong>{' '}
            of every warranty claim, repair order narrative, diagnostic statement, labor operation, and part
            documentation you submit through dealership systems (including CDK). No AI tool may absolve you of this
            obligation.
          </p>

          <p>
            <strong className="text-benz-primary">Mandatory personal review.</strong> Before certifying, saving, copying,
            or submitting any warranty story, you must personally read, edit, and verify every sentence. You must confirm
            that all stated facts reflect work you performed or directly supervised; that diagnostic conclusions are
            supported by evidence; and that no fabricated, exaggerated, or misleading information is included.
          </p>

          <p>
            <strong className="text-benz-primary">Legal and compliance exposure.</strong> By using Merlinus and submitting
            repair documentation, you acknowledge that{' '}
            <strong className="text-benz-primary">you assume full legal and professional responsibility</strong> for each
            claim. False, fraudulent, or materially inaccurate warranty submissions may result in claim denial, chargeback,
            disciplinary action, termination of employment, civil liability, and criminal prosecution under applicable
            federal and state law.
          </p>

          <p>
            <strong className="text-benz-primary">Truthful documentation pledge.</strong> You agree to submit only repair
            documentation that is truthful, accurate, and consistent with Mercedes-Benz warranty policy, Star Diagnosis
            records, and the actual condition and repair of the vehicle. You will not use Merlinus to generate or submit
            claims you know or reasonably should know to be unsupported.
          </p>

          <p className="text-xs text-benz-secondary pb-4">
            This acknowledgment is saved to your technician profile (version {LEGAL_DISCLAIMER_VERSION}) and is
            required once per account. If you do not agree, close this application and do not use Merlinus.
          </p>
        </div>

        <div className="p-6 pt-4 shrink-0 space-y-4">
          {!scrolledToBottom && (
            <p className="text-xs text-benz-secondary text-center">Scroll to the end of the agreement to continue.</p>
          )}

          <label className="flex items-start gap-3 cursor-pointer select-none touch-target">
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={!scrolledToBottom}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-benz-border accent-benz-blue shrink-0"
            />
            <span className="text-sm text-benz-silver leading-snug">
              I have read and understand this acknowledgment. I accept sole responsibility for all warranty documentation
              I submit and agree to use Merlinus only as an AI assistant while personally verifying every claim.
            </span>
          </label>

          <button
            type="button"
            onClick={() => void onAccept()}
            disabled={!canAccept || loading}
            className="primary-btn w-full h-12 text-sm font-semibold touch-target disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Saving…' : 'I Accept'}
          </button>
        </div>
      </div>
    </div>
  );
}