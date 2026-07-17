import type { StoryTemplate } from '@/types';

/** Client-safe helpers — keep separate from server-side templateLibrary (Prisma). */

export function getTemplateInsertText(template: StoryTemplate): string {
  return template.content;
}

/** H14: UI instant-apply path requires explicit isCustomerPay on the template row. */
export function isCustomerPayStoryTemplate(template: StoryTemplate): boolean {
  return template.isCustomerPay === true;
}