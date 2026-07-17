import 'server-only';

import { dealerIdWriteFields, withOptionalDealerId } from '@/lib/apex/dealerScope';
import {
  encryptOptionalSensitiveText,
  encryptSensitiveText,
} from '@/lib/encryption';
import { getRlsDb } from '@/lib/apex/rlsContext';
import { buildTemplateTags } from '@/lib/templateTags';
import { GLOBAL_DEALERSHIP_ID, mapKnowledgeBase, mapTemplate } from '@/lib/templateLibrary';

export interface SaveTemplateFromStoryInput {
  title: string;
  category: 'customer' | 'warranty';
  finalText: string;
  generatedText: string;
  dealershipId: string;
  /** APEX NATIONAL PLATFORM — optional franchise tenant stamp on writes. */
  dealerId?: string | null;
  createdById: string;
  lineDescription?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  codes?: string[];
}

export async function saveTemplateFromStory(input: SaveTemplateFromStoryInput) {
  const tags = buildTemplateTags(input);
  const tagsJson = JSON.stringify(tags);
  const now = new Date();

  const dealerFields = dealerIdWriteFields(input.dealerId);

  const template = await getRlsDb().template.upsert({
    where: {
      dealershipId_title: {
        dealershipId: input.dealershipId,
        title: input.title,
      },
    },
    update: {
      category: input.category,
      contentEncrypted: encryptSensitiveText(input.finalText),
      isCustomerPay: input.category === 'customer',
      templateType: input.category === 'customer' ? 'CustomerPay' : 'Warranty',
      source: 'user',
      updatedAt: now,
      ...dealerFields,
    },
    create: {
      title: input.title,
      category: input.category,
      contentEncrypted: encryptSensitiveText(input.finalText),
      isCustomerPay: input.category === 'customer',
      templateType: input.category === 'customer' ? 'CustomerPay' : 'Warranty',
      source: 'user',
      dealershipId: input.dealershipId,
      createdById: input.createdById,
      ...dealerFields,
    },
  });

  // M4: Customer Pay templates live in the template table only — not the warranty KB.
  let knowledgeBase = null;
  if (input.category !== 'customer') {
  knowledgeBase = await getRlsDb().knowledgeBase.upsert({
    where: {
      dealershipId_title: {
        dealershipId: input.dealershipId,
        title: input.title,
      },
    },
    update: {
      category: input.category,
      generatedTextEncrypted: encryptOptionalSensitiveText(input.generatedText),
      fullOriginalTextEncrypted: encryptSensitiveText(input.finalText),
      cleanTemplateEncrypted: encryptSensitiveText(input.finalText),
      tags: tagsJson,
      source: 'user',
      updatedAt: now,
      ...dealerFields,
    },
    create: {
      title: input.title,
      category: input.category,
      generatedTextEncrypted: encryptOptionalSensitiveText(input.generatedText),
      fullOriginalTextEncrypted: encryptSensitiveText(input.finalText),
      cleanTemplateEncrypted: encryptSensitiveText(input.finalText),
      tags: tagsJson,
      source: 'user',
      dealershipId: input.dealershipId,
      ...dealerFields,
    },
  });
  }

  return {
    template: mapTemplate(template),
    knowledgeBase: knowledgeBase ? mapKnowledgeBase(knowledgeBase) : null,
    tags,
  };
}

/** Global seeds + dealership user saves; optional dealerId scopes user rows only. */
export function templatesForDealershipWhere(
  dealershipId: string,
  dealerId?: string | null
) {
  return {
    OR: [
      { dealershipId: GLOBAL_DEALERSHIP_ID },
      withOptionalDealerId({ dealershipId, source: 'user' as const }, dealerId),
    ],
  };
}

export function knowledgeBaseForDealershipWhere(
  dealershipId: string,
  dealerId?: string | null
) {
  return {
    OR: [
      { dealershipId: GLOBAL_DEALERSHIP_ID },
      withOptionalDealerId({ dealershipId, source: 'user' as const }, dealerId),
    ],
  };
}

export function templateAccessWhere(
  dealershipId: string,
  templateId: string,
  dealerId?: string | null
) {
  return {
    id: templateId,
    ...templatesForDealershipWhere(dealershipId, dealerId),
  };
}