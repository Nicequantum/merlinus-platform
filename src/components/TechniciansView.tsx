'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  ChevronRight,
  ClipboardList,
  ScrollText,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import { BenzEmptyState } from '@/components/BenzEmptyState';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { TechnicianCertifiedStoryItem, TechnicianDetail, TechnicianListItem } from '@/types';

interface TechniciansViewProps {
  onBack: () => void;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatLongDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function OnboardingSection({ technician }: { technician: TechnicianDetail }) {
  const { onboarding } = technician;
  const hasRecord = Boolean(
    onboarding.consentAt ||
      onboarding.legalDisclaimerAt ||
      onboarding.firstAppLaunchAt
  );

  return (
    <div className="benz-card p-4">
      <div className="flex items-center gap-2 benz-section-title mb-3">
        <ShieldCheck size={14} />
        Onboarding & Consent
      </div>
      {!hasRecord ? (
        <p className="text-xs text-benz-secondary leading-relaxed">
          No onboarding record yet. Consent, legal acknowledgment, and first app launch are saved when
          this technician completes Merlin&apos;s startup flow.
        </p>
      ) : (
        <div className="space-y-2.5">
          <div className="benz-list-row p-3">
            <div className="text-xs text-benz-secondary">Privacy consent</div>
            <div className="text-sm font-medium mt-1">
              {onboarding.consentAt
                ? `${formatDateTime(onboarding.consentAt)}${onboarding.consentVersion ? ` · v${onboarding.consentVersion}` : ''}`
                : 'Not recorded'}
            </div>
          </div>
          <div className="benz-list-row p-3">
            <div className="text-xs text-benz-secondary">Legal disclaimer</div>
            <div className="text-sm font-medium mt-1">
              {onboarding.legalDisclaimerAt
                ? `${formatLongDate(onboarding.legalDisclaimerAt)}${onboarding.legalDisclaimerVersion ? ` · v${onboarding.legalDisclaimerVersion}` : ''}`
                : 'Not recorded'}
            </div>
          </div>
          <div className="benz-list-row p-3">
            <div className="text-xs text-benz-secondary">First app launch</div>
            <div className="text-sm font-medium mt-1">
              {onboarding.firstAppLaunchAt
                ? formatDateTime(onboarding.firstAppLaunchAt)
                : 'Not recorded'}
            </div>
            {onboarding.firstAppLaunchSessionId ? (
              <div className="text-xs text-benz-muted mt-1 truncate">
                Session {onboarding.firstAppLaunchSessionId}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function StoryRow({ story }: { story: TechnicianCertifiedStoryItem }) {
  return (
    <div className="benz-list-row px-3 py-2.5">
      <div className="flex justify-between items-start gap-2 mb-1">
        <span className="text-xs font-semibold text-benz-blue uppercase tracking-wide">
          RO {story.roNumber} · Line {story.lineNumber}
        </span>
        <span className="text-xs text-benz-secondary shrink-0">{formatDate(story.certifiedAt)}</span>
      </div>
      <div className="text-sm leading-snug">Certified by {story.certifiedByName}</div>
      <div className="text-xs text-benz-muted mt-1">Prompt v{story.promptVersion}</div>
    </div>
  );
}

function TechnicianDetailPanel({
  technician,
  stories,
  storiesLoading,
  loadingMore,
  hasMore,
  onLoadMore,
}: {
  technician: TechnicianDetail;
  stories: TechnicianCertifiedStoryItem[];
  storiesLoading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="benz-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-semibold tracking-tight">{technician.name}</div>
            <div className="text-xs text-benz-secondary mt-1">
              {technician.d7Number} · {technician.role}
              {!technician.isActive ? ' · Inactive' : ''}
            </div>
          </div>
          <span className="status-pill bg-benz-accent/15 text-benz-blue border border-benz-accent/30">
            {technician.certifiedStoryCount} stor{technician.certifiedStoryCount === 1 ? 'y' : 'ies'}
          </span>
        </div>
        {technician.lastCertifiedAt ? (
          <div className="text-xs text-benz-muted mt-3">
            Last certified {formatDateTime(technician.lastCertifiedAt)}
          </div>
        ) : null}
      </div>

      <OnboardingSection technician={technician} />

      <div className="benz-card p-4">
        <div className="flex items-center gap-2 benz-section-title mb-3">
          <ScrollText size={14} />
          Certified Warranty Stories
        </div>
        {storiesLoading ? (
          <div className="text-sm text-benz-secondary">Loading story library…</div>
        ) : stories.length === 0 ? (
          <p className="text-xs text-benz-secondary leading-relaxed">
            No certified warranty stories yet. Stories appear here when this technician certifies
            AI-generated warranty work.
          </p>
        ) : (
          <div className="space-y-2">
            {stories.map((story) => (
              <StoryRow key={story.id} story={story} />
            ))}
            {hasMore ? (
              <button
                type="button"
                onClick={onLoadMore}
                disabled={loadingMore}
                className="benz-btn-secondary w-full text-sm mt-2"
              >
                {loadingMore ? 'Loading more…' : 'Load more stories'}
              </button>
            ) : null}
          </div>
        )}
      </div>

      <div className="benz-card p-4 benz-alert-info border">
        <div className="flex items-center gap-2 text-benz-blue text-sm font-medium mb-2">
          <ClipboardList size={16} />
          Per-technician library
        </div>
        <p className="text-xs text-benz-secondary leading-relaxed">
          Each certified story is indexed under its technician with RO number and certification date.
          Data is stored separately from Service Advisor intelligence and the compliance audit hash chain.
        </p>
      </div>
    </div>
  );
}

export function TechniciansView({ onBack }: TechniciansViewProps) {
  const [technicians, setTechnicians] = useState<TechnicianListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TechnicianDetail | null>(null);
  const [stories, setStories] = useState<TechnicianCertifiedStoryItem[]>([]);
  const [storiesCursor, setStoriesCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [storiesLoading, setStoriesLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadTechnicians = useCallback(async () => {
    setLoading(true);
    try {
      const { technicians: list } = await api.listTechnicians();
      setTechnicians(list);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load technicians');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStories = useCallback(async (id: string, cursor?: string) => {
    const isLoadMore = Boolean(cursor);
    if (isLoadMore) {
      setLoadingMore(true);
    } else {
      setStoriesLoading(true);
    }
    try {
      const { stories: page, nextCursor } = await api.listTechnicianStories(id, {
        limit: 50,
        cursor,
      });
      setStories((prev) => (isLoadMore ? [...prev, ...page] : page));
      setStoriesCursor(nextCursor);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load certified stories');
      if (!isLoadMore) {
        setStories([]);
        setStoriesCursor(null);
      }
    } finally {
      if (isLoadMore) {
        setLoadingMore(false);
      } else {
        setStoriesLoading(false);
      }
    }
  }, []);

  const loadDetail = useCallback(
    async (id: string) => {
      setDetailLoading(true);
      try {
        const { technician } = await api.getTechnician(id);
        setDetail(technician);
        await loadStories(id);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to load technician profile');
        setSelectedId(null);
        setDetail(null);
        setStories([]);
        setStoriesCursor(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [loadStories]
  );

  useEffect(() => {
    loadTechnicians();
  }, [loadTechnicians]);

  useEffect(() => {
    if (selectedId) {
      loadDetail(selectedId);
    } else {
      setDetail(null);
      setStories([]);
      setStoriesCursor(null);
    }
  }, [selectedId, loadDetail]);

  const selectedTechnician = technicians.find((t) => t.id === selectedId);

  return (
    <div className="benz-page-compact">
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={() => {
            if (selectedId) {
              setSelectedId(null);
              return;
            }
            onBack();
          }}
          className="benz-icon-btn -ml-1 touch-target text-benz-blue"
          aria-label="Back"
        >
          <ArrowLeft size={22} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="benz-dashboard-eyebrow text-left mb-0.5">Technician Library</div>
          <h1 className="text-xl font-bold tracking-tight truncate">
            {selectedTechnician ? selectedTechnician.name : 'Technicians'}
          </h1>
          <p className="text-xs text-benz-secondary mt-0.5 leading-snug">
            {selectedTechnician
              ? 'Onboarding record & certified warranty stories'
              : 'Profiles and per-technician story libraries'}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="benz-card p-6 text-sm text-benz-secondary">Loading technicians...</div>
      ) : selectedId ? (
        detailLoading || !detail ? (
          <div className="benz-card p-6 text-sm text-benz-secondary">Loading technician profile...</div>
        ) : (
          <TechnicianDetailPanel
            technician={detail}
            stories={stories}
            storiesLoading={storiesLoading}
            loadingMore={loadingMore}
            hasMore={Boolean(storiesCursor)}
            onLoadMore={() => {
              if (selectedId && storiesCursor) {
                void loadStories(selectedId, storiesCursor);
              }
            }}
          />
        )
      ) : technicians.length === 0 ? (
        <BenzEmptyState
          icon={UsersRound}
          title="No technicians found"
          hint="Add technician accounts in Settings. Onboarding records and certified stories appear here as they use Merlin."
        />
      ) : (
        <div className="space-y-2.5">
          {technicians.map((tech) => (
            <button key={tech.id} onClick={() => setSelectedId(tech.id)} className="benz-settings-nav">
              <div className="min-w-0 text-left">
                <div className="font-semibold text-sm truncate">
                  {tech.name}
                  {!tech.isActive ? (
                    <span className="text-benz-muted font-normal"> · inactive</span>
                  ) : null}
                </div>
                <div className="text-xs text-benz-secondary mt-1">
                  {tech.d7Number} · {tech.role} · {tech.certifiedStoryCount} certified stor
                  {tech.certifiedStoryCount === 1 ? 'y' : 'ies'}
                </div>
                <div className="text-xs text-benz-muted">
                  {tech.lastCertifiedAt
                    ? `Last certified ${formatDateTime(tech.lastCertifiedAt)}`
                    : tech.hasOnboardingRecord
                      ? 'Onboarding recorded · no certified stories yet'
                      : 'No activity recorded yet'}
                </div>
              </div>
              <ChevronRight size={18} className="text-benz-secondary shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}