export {
  formatAdvisorContextForPrompt,
  loadAdvisorPromptContext,
  loadAdvisorPromptContextForRepairOrder,
  type AdvisorProfileData,
  type AdvisorPromptContext,
} from './buildPromptContext';
export {
  captureAdvisorIntelligence,
  type AdvisorExtractionSource,
  type CaptureAdvisorIntelligenceInput,
  type CaptureAdvisorIntelligenceResult,
} from './captureObservations';
export {
  fingerprintAdvisorName,
  normalizeAdvisorDisplayName,
  isPlausibleAdvisorName,
  complaintLineLabel,
  inferVehicleFamily,
} from './nameUtils';
export { recomputeAdvisorProfile } from './recomputeProfile';
export {
  resolveServiceAdvisor,
  type ResolvedServiceAdvisor,
  type ResolveServiceAdvisorOptions,
} from './resolveAdvisor';