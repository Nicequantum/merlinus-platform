/** Multi-brand story generation — pack contracts. */

export type StoryBrandId = 'mercedes' | 'generic';

export interface VeteranPersona {
  id: string;
  years: number;
  voice: string;
}

export interface StoryBrandQualityPrompts {
  scoreSystemPrompt: string;
  scoreRetrySystemPrompt: string;
  reviewSystemPrompt: string;
  /** Short label for score/review user messages (e.g. "MI 2.0" | "warranty audit"). */
  auditLabel: string;
}

export interface StoryBrandPack {
  id: StoryBrandId;
  /** Bump when this pack’s prompts change (audit fingerprint). */
  packVersion: string;
  displayLabel: string;
  systemPrompt: string;
  workflowSteps: readonly string[];
  workflowSummary: string;
  personas: readonly VeteranPersona[];
  /** Label for diagnostic photo source in user messages. */
  diagnosticsSourceLabel: string;
  /** Closing instruction for generate user message. */
  generateClosingInstruction: (lineNumber: number, personaId: string) => string;
  quality: StoryBrandQualityPrompts;
  /**
   * Terms that must not appear in this pack’s generate system/persona text.
   * Used by unit tests (e.g. generic must not say XENTRY).
   */
  forbiddenTerms?: readonly string[];
}

export const TRUTH_POLICY_ID = 'tech_notes_diagnostics_only' as const;
