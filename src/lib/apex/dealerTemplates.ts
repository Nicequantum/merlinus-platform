/**
 * APEX NATIONAL PLATFORM — dealership provision templates.
 *
 * Templates control login strategy, feature defaults, and branding chrome —
 * never display names. Rooftop UI name always comes from provision input
 * (`rooftopName` → Dealership.name). Dealer franchise label always comes from
 * (`dealerName` → Dealer.name).
 *
 * Hierarchy:
 *   base-rooftop-v1          — clean empty starting point (no logo, no brand name)
 *   mercedes-rooftop-v1      — extends base + Mercedes login/features only
 *   generic-rooftop-v1       — extends base + multi-brand username login
 */

export const DEALER_TEMPLATE_IDS = [
  'base-rooftop-v1',
  'mercedes-rooftop-v1',
  'generic-rooftop-v1',
] as const;
export type DealerTemplateId = (typeof DEALER_TEMPLATE_IDS)[number];

/** Brand key for audit + future per-rooftop chrome. `none` = clean base. */
export type BrandKey = 'none' | 'mercedes' | 'generic';
export type StaffLoginStrategy = 'd7' | 'apex_username' | 'email';
export type TemplateLogo = 'none' | 'mercedes';
export type TemplateTheme = 'neutral' | 'mercedes';

export interface TemplateBranding {
  /**
   * Always null — templates must never inject a storefront or pilot name.
   * Provision input is the only source of Dealership.name / Dealer.name.
   */
  hardcodedDisplayName: null;
  /** Logo mark for rooftop chrome. Base/generic stay empty. */
  logo: TemplateLogo;
  /** Visual theme tokens (neutral = no Mercedes pilot styling). */
  theme: TemplateTheme;
}

export interface DealerTemplate {
  id: DealerTemplateId;
  /** Parent template id; null only for the clean base. */
  extends: DealerTemplateId | null;
  brand: BrandKey;
  /** How the service manager authenticates at this rooftop. */
  loginStrategy: StaffLoginStrategy;
  defaultManagerRole: 'manager';
  features: {
    customerPay: boolean;
    voice: boolean;
    /** Mercedes Xentry diagnostic flows. */
    xentry: boolean;
  };
  branding: TemplateBranding;
  seed: {
    /** Never clone Tiverton / Merlinus pilot user templates. */
    copyGlobalTemplates: boolean;
    /** Never clone pilot dealership rows or logos. */
    copyPilotDealership: boolean;
    createPlaceholderAdvisor: boolean;
  };
}

const CLEAN_BRANDING: TemplateBranding = {
  hardcodedDisplayName: null,
  logo: 'none',
  theme: 'neutral',
};

/**
 * True clean base — no dealership name, no logo, no OEM branding.
 * All other rooftop templates inherit from this object.
 */
const BASE_ROOFTOP_V1: DealerTemplate = {
  id: 'base-rooftop-v1',
  extends: null,
  brand: 'none',
  loginStrategy: 'email',
  defaultManagerRole: 'manager',
  features: {
    customerPay: true,
    voice: true,
    xentry: false,
  },
  branding: { ...CLEAN_BRANDING },
  seed: {
    copyGlobalTemplates: false,
    copyPilotDealership: false,
    createPlaceholderAdvisor: false,
  },
};

function extendFromBase(
  id: DealerTemplateId,
  patch: {
    brand: BrandKey;
    loginStrategy: StaffLoginStrategy;
    features?: Partial<DealerTemplate['features']>;
    branding?: Partial<TemplateBranding>;
    seed?: Partial<DealerTemplate['seed']>;
  }
): DealerTemplate {
  return {
    ...BASE_ROOFTOP_V1,
    id,
    extends: 'base-rooftop-v1',
    brand: patch.brand,
    loginStrategy: patch.loginStrategy,
    features: {
      ...BASE_ROOFTOP_V1.features,
      ...patch.features,
    },
    branding: {
      ...BASE_ROOFTOP_V1.branding,
      ...patch.branding,
      // never allow overrides to inject a pilot/storefront name
      hardcodedDisplayName: null,
    },
    seed: {
      ...BASE_ROOFTOP_V1.seed,
      ...patch.seed,
      copyPilotDealership: false, // never clone Merlinus pilot rooftop
    },
  };
}

const TEMPLATES: Record<DealerTemplateId, DealerTemplate> = {
  'base-rooftop-v1': BASE_ROOFTOP_V1,

  /** Mercedes-specific deltas only on top of clean base. */
  'mercedes-rooftop-v1': extendFromBase('mercedes-rooftop-v1', {
    brand: 'mercedes',
    loginStrategy: 'd7',
    features: {
      xentry: true,
    },
    branding: {
      logo: 'mercedes',
      theme: 'mercedes',
    },
  }),

  /** Multi-brand / non-MB rooftops — still inherits clean base (no pilot name/logo). */
  'generic-rooftop-v1': extendFromBase('generic-rooftop-v1', {
    brand: 'generic',
    loginStrategy: 'apex_username',
    features: {
      xentry: false,
    },
    branding: {
      logo: 'none',
      theme: 'neutral',
    },
  }),
};

export function listDealerTemplates(): DealerTemplate[] {
  return Object.values(TEMPLATES);
}

/** Provisionable templates (all registered ids, including clean base). */
export function listProvisionableTemplateIds(): DealerTemplateId[] {
  return [...DEALER_TEMPLATE_IDS];
}

export function getDealerTemplate(id: string): DealerTemplate | null {
  const key = id.trim() as DealerTemplateId;
  return TEMPLATES[key] ?? null;
}

export function isDealerTemplateId(id: string): id is DealerTemplateId {
  return (DEALER_TEMPLATE_IDS as readonly string[]).includes(id.trim());
}

/** Parent chain for a template (nearest parent first). */
export function getTemplateInheritanceChain(id: string): DealerTemplateId[] {
  const template = getDealerTemplate(id);
  if (!template) return [];
  const chain: DealerTemplateId[] = [];
  let current: DealerTemplate | null = template;
  const seen = new Set<string>();
  while (current?.extends) {
    if (seen.has(current.extends)) break;
    seen.add(current.extends);
    chain.push(current.extends);
    current = getDealerTemplate(current.extends);
  }
  return chain;
}

/**
 * Invariant: templates never carry a storefront/pilot display name.
 * Used by tests and provision preflight.
 */
export function assertTemplateHasNoHardcodedIdentity(template: DealerTemplate): void {
  if (template.branding.hardcodedDisplayName !== null) {
    throw new Error(`Template ${template.id} must not hardcode a display name`);
  }
  if (template.seed.copyPilotDealership) {
    throw new Error(`Template ${template.id} must not copy pilot dealership data`);
  }
}
