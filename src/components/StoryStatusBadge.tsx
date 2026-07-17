'use client';

import { FileText, Sparkles } from 'lucide-react';
import { isCustomerPayRepairLine } from '@/lib/customerPayLine';
import type { RepairLine, RepairLineSummary } from '@/types';

type StoryStatusLine = Pick<RepairLine, 'isCustomerPay' | 'warrantyStory'> | RepairLineSummary;

interface StoryStatusBadgeProps {
  lines: StoryStatusLine[];
  compact?: boolean;
}

function lineHasStory(line: StoryStatusLine): boolean {
  if ('hasWarrantyStory' in line) {
    return line.hasWarrantyStory;
  }
  return Boolean(line.warrantyStory?.trim());
}

/** Distinguishes instant Customer Pay stories from AI-generated warranty stories. */
export function StoryStatusBadge({ lines, compact = false }: StoryStatusBadgeProps) {
  const withStory = lines.filter((l) => lineHasStory(l));
  if (withStory.length === 0) return null;

  const cpCount = withStory.filter((l) => isCustomerPayRepairLine(l)).length;
  const aiCount = withStory.length - cpCount;

  if (cpCount > 0 && aiCount === 0) {
    return (
      <span className={`benz-story-badge benz-story-badge-cp ${compact ? 'benz-story-badge-compact' : ''}`}>
        <FileText size={12} aria-hidden />
        {compact ? 'Instant' : `Instant · ${cpCount}`}
      </span>
    );
  }

  if (aiCount > 0 && cpCount === 0) {
    return (
      <span className={`benz-story-badge benz-story-badge-ai ${compact ? 'benz-story-badge-compact' : ''}`}>
        <Sparkles size={12} aria-hidden />
        {compact ? 'AI Story' : `AI Story · ${aiCount}`}
      </span>
    );
  }

  return (
    <span className={`benz-story-badge benz-story-badge-mixed ${compact ? 'benz-story-badge-compact' : ''}`}>
      {cpCount} instant · {aiCount} AI
    </span>
  );
}