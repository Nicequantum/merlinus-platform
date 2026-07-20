/**
 * Dynamic dealership context for multi-tenant voice agents.
 * Injected into Sophia prompts as [DEALERSHIP_CONTEXT].
 */

export type DealershipHoursBlock = {
  label: string;
  hours: string;
};

export type DealershipContext = {
  /** Public dealership display name */
  dealershipName: string;
  /** Optional brand line, e.g. Mercedes-Benz */
  brand?: string;
  /** Main voice line E.164 */
  mainPhoneE164?: string;
  /** Human-readable phone for speech */
  mainPhoneSpoken?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  /** Short directions / landmark guidance */
  directions?: string;
  website?: string;
  timezone?: string;
  hours: DealershipHoursBlock[];
  /** Departments the agent may mention */
  departments?: string[];
  serviceNotes?: string;
  salesNotes?: string;
  partsNotes?: string;
  loanerNotes?: string;
  roadsidePolicy?: string;
  warrantyNotes?: string;
  /** When true, agent may transfer to a live person via Twilio dial */
  humanTransferEnabled?: boolean;
  /** E.164 for warm human transfer (service desk, etc.) */
  humanTransferNumberE164?: string;
  /** Extra free-form facts for this rooftop */
  extraFacts?: string[];
  /** Receptionist persona display name */
  agentDisplayName?: string;
};

/** Staging rooftop — Mercedes-Benz Staging / +1 (401) 645-4563 */
export const STAGING_MERCEDES_BENZ_CONTEXT: DealershipContext = {
  dealershipName: 'Mercedes-Benz Staging',
  brand: 'Mercedes-Benz',
  mainPhoneE164: '+14016454563',
  mainPhoneSpoken: 'four zero one, six four five, four five six three',
  addressLine1: '100 Staging Drive',
  city: 'Staging City',
  state: 'RI',
  postalCode: '02800',
  directions:
    'We are located near the main service entrance with clear Mercedes-Benz signage. Guest parking is available in front of the showroom.',
  website: 'https://clarityautoapex.com',
  timezone: 'America/New_York',
  hours: [
    { label: 'Sales', hours: 'Monday through Friday nine to seven, Saturday nine to five, closed Sunday' },
    {
      label: 'Service',
      hours: 'Monday through Friday seven thirty to six, Saturday eight to one, closed Sunday',
    },
    {
      label: 'Parts',
      hours: 'Monday through Friday seven thirty to five thirty, Saturday eight to twelve, closed Sunday',
    },
  ],
  departments: ['Reception', 'Service', 'Parts', 'Sales', 'Loaner / courtesy vehicles'],
  serviceNotes:
    'Service appointments are confirmed by our advisors. Same-day availability is never guaranteed on the phone — capture preferred days and a callback number.',
  salesNotes:
    'Sales inquiries: capture interest (new/certified/pre-owned), model preference, and best callback time. Never invent inventory, MSRP, or incentives.',
  partsNotes:
    'Parts: capture part description or number, VIN when possible, and vehicle year/model. Staff will quote availability.',
  loanerNotes:
    'Loaners are subject to availability and dealership policy. Always check availability with tools before promising a vehicle.',
  roadsidePolicy:
    'For roadside emergencies with a Mercedes-Benz, encourage Mercedes-Benz Roadside Assistance through the vehicle owner materials or the manufacturer app. For immediate danger, advise calling emergency services first.',
  warrantyNotes:
    'Warranty coverage depends on the vehicle, mileage, and program. Never guarantee coverage; offer to create a service follow-up so an advisor can review.',
  humanTransferEnabled: true,
  agentDisplayName: 'Sophia',
  extraFacts: [
    'This is the multi-tenant staging dealership used to validate the Apex voice agent.',
    'Speak with a calm luxury tone appropriate for Mercedes-Benz customers.',
  ],
};

/**
 * Build context for a rooftop. Prefer DB name + optional module config overlay later.
 * Staging DID is hard-mapped for reliable demos.
 */
export function resolveDealershipContext(input: {
  dealershipId: string;
  dealershipName: string;
  toE164?: string | null;
  configJson?: string | null;
}): DealershipContext {
  const to = (input.toE164 || '').replace(/\D/g, '');
  if (to.endsWith('4016454563') || to === '14016454563') {
    return {
      ...STAGING_MERCEDES_BENZ_CONTEXT,
      dealershipName: input.dealershipName || STAGING_MERCEDES_BENZ_CONTEXT.dealershipName,
    };
  }

  // Optional overlay from DealershipModule.configJson when present
  let overlay: Partial<DealershipContext> = {};
  if (input.configJson?.trim()) {
    try {
      const parsed = JSON.parse(input.configJson) as { voiceContext?: Partial<DealershipContext> };
      if (parsed.voiceContext && typeof parsed.voiceContext === 'object') {
        overlay = parsed.voiceContext;
      }
    } catch {
      // ignore
    }
  }

  const name = overlay.dealershipName || input.dealershipName || 'our dealership';
  return {
    dealershipName: name,
    brand: overlay.brand || 'Mercedes-Benz',
    mainPhoneE164: overlay.mainPhoneE164,
    mainPhoneSpoken: overlay.mainPhoneSpoken,
    addressLine1: overlay.addressLine1,
    addressLine2: overlay.addressLine2,
    city: overlay.city,
    state: overlay.state,
    postalCode: overlay.postalCode,
    directions: overlay.directions,
    website: overlay.website,
    timezone: overlay.timezone || 'America/New_York',
    hours: overlay.hours?.length
      ? overlay.hours
      : [
          {
            label: 'Dealership',
            hours: 'Please ask a team member for current department hours if not listed in your visit materials.',
          },
        ],
    departments: overlay.departments || ['Service', 'Parts', 'Sales'],
    serviceNotes: overlay.serviceNotes,
    salesNotes: overlay.salesNotes,
    partsNotes: overlay.partsNotes,
    loanerNotes: overlay.loanerNotes,
    roadsidePolicy:
      overlay.roadsidePolicy ||
      'For roadside emergencies, advise Mercedes-Benz Roadside Assistance or emergency services if there is danger.',
    warrantyNotes:
      overlay.warrantyNotes ||
      'Do not guarantee warranty coverage; create a service follow-up for an advisor review.',
    humanTransferEnabled: overlay.humanTransferEnabled ?? false,
    humanTransferNumberE164: overlay.humanTransferNumberE164,
    agentDisplayName: overlay.agentDisplayName || 'Sophia',
    extraFacts: overlay.extraFacts || [],
  };
}

/** Serialize context for the model system prompt block. */
export function formatDealershipContextBlock(ctx: DealershipContext): string {
  const lines: string[] = [
    `Dealership name: ${ctx.dealershipName}`,
    ctx.brand ? `Brand: ${ctx.brand}` : '',
    ctx.mainPhoneE164 ? `Main phone (E.164): ${ctx.mainPhoneE164}` : '',
    ctx.mainPhoneSpoken ? `Main phone (spoken): ${ctx.mainPhoneSpoken}` : '',
    [ctx.addressLine1, ctx.addressLine2, ctx.city, ctx.state, ctx.postalCode].filter(Boolean).length
      ? `Address: ${[ctx.addressLine1, ctx.addressLine2, ctx.city, ctx.state, ctx.postalCode]
          .filter(Boolean)
          .join(', ')}`
      : '',
    ctx.directions ? `Directions: ${ctx.directions}` : '',
    ctx.website ? `Website: ${ctx.website}` : '',
    ctx.timezone ? `Timezone: ${ctx.timezone}` : '',
    'Hours:',
    ...ctx.hours.map((h) => `  - ${h.label}: ${h.hours}`),
    ctx.departments?.length ? `Departments: ${ctx.departments.join(', ')}` : '',
    ctx.serviceNotes ? `Service notes: ${ctx.serviceNotes}` : '',
    ctx.salesNotes ? `Sales notes: ${ctx.salesNotes}` : '',
    ctx.partsNotes ? `Parts notes: ${ctx.partsNotes}` : '',
    ctx.loanerNotes ? `Loaner notes: ${ctx.loanerNotes}` : '',
    ctx.roadsidePolicy ? `Roadside: ${ctx.roadsidePolicy}` : '',
    ctx.warrantyNotes ? `Warranty: ${ctx.warrantyNotes}` : '',
    ctx.humanTransferEnabled
      ? `Human transfer: enabled${
          ctx.humanTransferNumberE164 ? ` → ${ctx.humanTransferNumberE164}` : ''
        }`
      : 'Human transfer: create staff follow-up tickets instead of live dial when transfer number is not configured',
    ...(ctx.extraFacts || []).map((f) => `Fact: ${f}`),
  ];
  return lines.filter(Boolean).join('\n');
}

export function buildSophiaWelcome(ctx: DealershipContext): string {
  const agent = ctx.agentDisplayName || 'Sophia';
  const name = ctx.dealershipName;
  return `Thank you for calling ${name}. This is ${agent}, your virtual receptionist. How may I help you today — service, parts, sales, or something else?`;
}
