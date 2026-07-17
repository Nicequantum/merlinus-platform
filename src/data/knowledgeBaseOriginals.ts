/**
 * User-provided warranty story originals for KnowledgeBase.fullOriginalText.
 * Only add entries here when the user supplies the complete, exact story text.
 * Do not summarize or rewrite — paste verbatim.
 */
export const KNOWLEDGE_BASE_ORIGINALS: Partial<Record<string, string>> = {
  'Blind Spot Assist Warning':
    'Customer reported a blind spot assist warning message appearing in the instrument cluster on a 2023 Mercedes-Benz S-Class. Verified customer complaint during initial test drive, where the blind spot message was observed. Connected vehicle to a battery charger and initiated XENTRY diagnostics system. Performed initial quick test, revealing multiple communication-related fault codes in various modules. To address the issue, updated the driver assistance module software. As part of this process, simultaneously updated related modules including the multifunction camera, long-range radar, and short-range radars (left and right, front and rear). Cleared all stored fault codes post-update. Calibrated the multifunction camera to ensure proper functionality. Conducted final quick test, confirming no remaining codes. Performed concluding test drive, verifying that the blind spot assist system and all other vehicle systems operate as designed with no issues present.',
};

export function getKnowledgeBaseOriginal(title: string): string | undefined {
  const original = KNOWLEDGE_BASE_ORIGINALS[title];
  return original?.trim() || undefined;
}

export function listLoadedKnowledgeBaseOriginals(): string[] {
  return Object.keys(KNOWLEDGE_BASE_ORIGINALS).filter((title) => KNOWLEDGE_BASE_ORIGINALS[title]?.trim());
}