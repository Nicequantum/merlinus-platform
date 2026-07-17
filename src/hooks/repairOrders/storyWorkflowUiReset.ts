import type { MutableRefObject } from 'react';

export interface StoryWorkflowUiRefs {
  generateStorySeqRef: MutableRefObject<number>;
  scoreStorySeqRef: MutableRefObject<number>;
  reviewStorySeqRef: MutableRefObject<number>;
  storyGenerationInFlightRef: MutableRefObject<boolean>;
  storyScoringInFlightRef: MutableRefObject<boolean>;
  storyReviewInFlightRef: MutableRefObject<boolean>;
}

export interface StoryWorkflowUiSetters {
  setIsGenerating: (value: boolean) => void;
  setGeneratingLineId: (value: string | null) => void;
  setIsScoring: (value: boolean) => void;
  setScoringLineId: (value: string | null) => void;
  setIsReviewing: (value: boolean) => void;
  setReviewingLineId: (value: string | null) => void;
}

/** Clears in-flight story generation/scoring/review UI state when switching or deleting ROs. */
export function resetStoryWorkflowUiState(
  refs: StoryWorkflowUiRefs,
  setters: StoryWorkflowUiSetters
): void {
  refs.generateStorySeqRef.current += 1;
  refs.scoreStorySeqRef.current += 1;
  refs.reviewStorySeqRef.current += 1;
  refs.storyGenerationInFlightRef.current = false;
  refs.storyScoringInFlightRef.current = false;
  refs.storyReviewInFlightRef.current = false;
  setters.setIsGenerating(false);
  setters.setGeneratingLineId(null);
  setters.setIsScoring(false);
  setters.setScoringLineId(null);
  setters.setIsReviewing(false);
  setters.setReviewingLineId(null);
}