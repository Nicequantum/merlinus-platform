/**
 * Customer Pay story templates — base narratives for non-warranty / menu work.
 *
 * Compliance: Customer Pay repairs do not require MI 2.0 quality scoring or
 * warranty-grade audit promptVersion tracking. Manual template apply uses these
 * stories directly. Scan enrichment may apply light Grok variation via
 * generateDynamicCustomerPayNarrative while preserving template facts and tone.
 *
 * History: B Service / A Service / LOF originally lived in storyTemplateSeed
 * (category: customer) in merlinus-v1. Commit 244b30f moved Customer Pay to this
 * file but only shipped the expanded brake/battery/etc. set — the three scheduled-
 * service seeds were dropped. Restored from merlinus-v1 git parent of 244b30f
 * (2026-06-23) and adapted to preWrittenStory format.
 *
 * Auction / Offline dedicated templates were never present in recoverable git
 * history (merlinus-platform or merlinus-v1).
 */

export type TemplateTypeLabel = 'Warranty' | 'CustomerPay';

export interface CustomerPayTemplate {
  title: string;
  description: string;
  preWrittenStory: string;
  /**
   * Extra phrases that map RO scan text to this template (in addition to title).
   * Used by matchCustomerPayTemplateFromScanText.
   */
  matchAliases?: string[];
}

export const CUSTOMER_PAY_TEMPLATES: CustomerPayTemplate[] = [
  // ─── Scheduled services (restored from merlinus-v1 storyTemplateSeed) ───────
  {
    title: 'B Service',
    description:
      'Mercedes-Benz Service B interval: oil/filter, multipoint inspection, fluid checks, service indicator reset.',
    matchAliases: [
      'b service',
      'service b',
      'service-b',
      'svc b',
      'b svc',
      'scheduled service b',
      'maintenance b',
      'mb service b',
    ],
    preWrittenStory:
      'Performed Service B per Mercedes-Benz maintenance booklet. Replaced engine oil and oil filter, reset the service indicator, and completed the maintenance inspection per the workshop manual. Checked and topped fluids as required, inspected brakes, tires, belts, hoses, lights, and wipers, verified tire pressures, and road tested the vehicle. Returned the vehicle to the customer with service documentation and next service due recommendation.',
  },
  {
    title: 'A Service',
    description:
      'Mercedes-Benz Service A interval: oil/filter, inspection, fluid and tire checks, service indicator reset.',
    matchAliases: [
      'a service',
      'service a',
      'service-a',
      'svc a',
      'a svc',
      'scheduled service a',
      'maintenance a',
      'mb service a',
    ],
    preWrittenStory:
      'Performed Service A per Mercedes-Benz maintenance booklet. Replaced engine oil and oil filter, reset the service indicator, and completed the maintenance inspection. Checked fluids and tire pressures, inspected brakes and tires, and verified proper operation on a road test. Vehicle returned to the customer.',
  },
  {
    title: 'Lube, Oil & Filter Service',
    description: 'Standard lube, oil, and filter service with leak check.',
    matchAliases: [
      'lube oil filter',
      'lof',
      'oil change',
      'oil and filter',
      'oil filter service',
      'engine oil service',
      'lof service',
    ],
    preWrittenStory:
      'Performed lube, oil, and filter service. Drained engine oil, replaced the oil filter, and installed approved engine oil to specification. Checked and topped fluids as needed, reset the service reminder if applicable, and verified no leaks. Road tested — no issues noted.',
  },

  // ─── Common Customer Pay menu / a-la-carte work ─────────────────────────────
  {
    title: 'Front Brake Job',
    description: 'Complete front brake rotor and pad replacement with hardware service.',
    preWrittenStory:
      'Performed a complete front brake service. Removed and replaced both brake rotors and brake pads. Installed new brake pad wear sensors. Thoroughly cleaned and lubricated all caliper slide pins and hardware. Reassembled using new brake hardware. Conducted a post-service test drive to properly bed in the new brakes and verify smooth operation.',
  },
  {
    title: 'Rear Brake Job',
    description: 'Complete rear brake rotor and pad replacement with hardware service.',
    preWrittenStory:
      'Performed a complete rear brake service. Removed and replaced both brake rotors and brake pads. Installed new brake pad wear sensors. Thoroughly cleaned and lubricated all caliper slide pins and hardware. Reassembled using new brake hardware. Conducted a post-service test drive to properly bed in the new brakes and verify smooth operation.',
  },
  {
    title: 'Mercedes-Benz Brake Fluid Flush',
    description: 'Four-wheel brake fluid exchange using genuine Mercedes-Benz fluid.',
    preWrittenStory:
      'Performed a complete four-wheel brake fluid service using genuine Mercedes-Benz brake fluid. Flushed all four brake calipers and lines. Bled the brake system thoroughly to remove all old fluid and air. Refilled and bled the system with fresh Mercedes-Benz brake fluid to manufacturer specifications. Verified proper brake pedal feel and function.',
  },
  {
    title: 'Standard Brake Fluid Flush',
    description: 'Four-wheel brake fluid exchange with high-quality replacement fluid.',
    preWrittenStory:
      'Performed a complete four-wheel brake fluid service. Flushed all four brake calipers and brake lines. Thoroughly bled the system to remove old contaminated fluid and air. Refilled with new high-quality brake fluid and performed a final bleed to ensure proper system operation and firm brake pedal feel.',
  },
  {
    title: 'Spark Plug Replacement',
    description: 'Full spark plug replacement with coil service and Xentry reset.',
    preWrittenStory:
      'Performed a complete spark plug replacement service. Removed and replaced all spark plugs with new OEM-specification plugs, torqued to manufacturer specifications. Applied dielectric grease to all ignition coil boots prior to reinstallation. Reinstalled ignition coils and all removed hardware. Connected a battery maintainer and used Xentry to clear any stored codes, reset adaptations, and save all learned values.',
  },
  {
    title: 'Engine Air Filter Replacement',
    description: 'Engine air filter element replacement and housing inspection.',
    preWrittenStory:
      'Performed engine air filter replacement service. Removed and replaced the engine air filter element(s) with new genuine filter media. Inspected the air filter housing and cleaned out any debris. Properly seated the new filter(s) and securely reassembled the air filter housing. Verified all clamps and seals are properly fastened for optimal engine performance and filtration.',
  },
  {
    title: 'Rear Wiper Arm Replacement',
    description: 'Rear wiper arm replacement due to corrosion or seized pivot.',
    preWrittenStory:
      'Performed rear wiper arm replacement. Removed the damaged rear wiper arm, which had seized and cracked at the motor pivot due to corrosion. Installed a new rear wiper arm, properly aligned and torqued the retaining nut to specification. Verified smooth and correct operation of the rear wiper across the full range of motion. Tested both intermittent and high-speed settings to ensure proper function.',
  },
  {
    title: 'Rear Differential Fluid Change',
    description: 'Rear differential gear oil drain and fill service.',
    preWrittenStory:
      'Performed rear differential fluid service. Raised the vehicle on a lift and removed the rear differential fill and drain plugs. Drained the old differential fluid completely. Reinstalled the drain plug with a new crush washer and filled the differential with new manufacturer-specified gear oil to the correct level. Verified no leaks and properly reinstalled the fill plug.',
  },
  {
    title: 'Front Differential Fluid Change',
    description: 'Front differential gear oil drain and fill service.',
    preWrittenStory:
      'Performed front differential fluid service. Raised the vehicle on a lift and removed the front differential fill and drain plugs. Completely drained the old fluid. Reinstalled the drain plug with a new crush washer and filled the differential with new manufacturer-specified gear oil to the correct level. Verified no leaks and properly reinstalled the fill plug.',
  },
  {
    title: '12-Volt Main Battery Replacement',
    description: 'Main 12-volt battery replacement with Xentry registration.',
    preWrittenStory:
      'Performed 12-volt main battery replacement. Customer reported multiple electrical warnings and "Consumer Items Offline" message. Conducted a battery load test which confirmed the main battery had failed. Replaced the main 12-volt battery with a new unit. Performed battery registration using Xentry and cleared all related fault codes. Verified proper system voltage and operation of all electrical systems.',
  },
  {
    title: 'Auxiliary Battery Replacement',
    description: 'Auxiliary battery replacement with Xentry registration.',
    preWrittenStory:
      'Performed auxiliary battery replacement. Customer reported "Consumer Items Offline" warning message. Diagnosed and confirmed the auxiliary battery had failed. Replaced the auxiliary battery with a new unit. Performed battery registration using Xentry and cleared all related fault codes. Verified proper charging and operation of all auxiliary electrical systems.',
  },
  {
    title: 'Transmission Service',
    description: 'Transmission fluid and filter service with Xentry level check.',
    preWrittenStory:
      'Performed transmission service. Drained the old transmission fluid and replaced the internal filter. Refilled with new Mercedes-Benz approved transmission fluid. Connected Xentry and used the ultrasonic sensor to check and set the transmission fluid to the correct level at operating temperature. Performed a transmission adaptation reset and test drove the vehicle to verify smooth shifting and proper operation.',
  },
  {
    title: 'Flat Tire Repair',
    description: 'Puncture repair or tire dismount, patch/plug, and rebalance.',
    preWrittenStory:
      'Performed flat tire repair service. Located the puncture in the tire tread and removed the foreign object. Dismounted the tire, installed an approved patch/plug repair per manufacturer guidelines, and rebalanced the wheel assembly. Reinstalled the tire, torqued the lug bolts to specification, and verified proper tire pressure. Conducted a brief road test to confirm no vibration or pull.',
  },
  {
    title: 'Tire Replacement',
    description: 'Single or multiple tire replacement with mount, balance, and torque.',
    preWrittenStory:
      'Performed tire replacement service. Removed the worn tire(s) and installed new tire(s) of matching specification. Mounted and balanced each wheel assembly, reinstalled on the vehicle, and torqued all lug bolts to manufacturer specification. Set tire pressures to the recommended placard values and verified no TPMS warnings after a brief road test.',
  },
  {
    title: 'Headlight Bulb Replacement',
    description: 'Headlamp bulb replacement with aim check.',
    preWrittenStory:
      'Performed headlight bulb replacement. Removed and replaced the failed headlamp bulb with a new unit of correct specification. Reinstalled all trim and fasteners, verified proper bulb seating and connector retention, and checked headlamp operation on low and high beam. Adjusted aim as needed to ensure proper road illumination.',
  },
  {
    title: 'Taillight Bulb Replacement',
    description: 'Tail lamp or brake light bulb replacement.',
    preWrittenStory:
      'Performed taillight bulb replacement. Accessed the tail lamp assembly and replaced the failed bulb with a new unit of correct specification. Reassembled the lamp housing and verified brake light, tail light, and turn signal operation. Confirmed no related warning messages on the instrument cluster.',
  },
  {
    title: 'Interior Dome Light Replacement',
    description: 'Overhead courtesy or dome lamp bulb replacement.',
    preWrittenStory:
      'Performed interior dome light bulb replacement. Removed the overhead lens or assembly and replaced the failed courtesy lamp bulb with a new unit. Reinstalled the lens securely and verified proper illumination on door-open and manual switch settings. Confirmed no flicker or intermittent operation.',
  },
  {
    title: 'Fuse Replacement — Power Outlet',
    description: 'Fuse replacement restoring cigarette lighter or 12-volt power outlet.',
    preWrittenStory:
      'Performed fuse replacement for the cigarette lighter / 12-volt power outlet circuit. Located the failed fuse in the fuse panel, replaced it with a new fuse of correct amperage, and tested the power outlet for proper voltage and retention of accessories. Verified related circuits were unaffected and no warning messages remained.',
  },
  {
    title: 'Washer Fluid Top-Off',
    description: 'Windshield washer fluid fill and spray pattern check.',
    preWrittenStory:
      'Performed windshield washer fluid top-off service. Filled the washer reservoir with approved washer fluid to the correct level. Operated the front and rear washer systems to verify proper spray pattern, pump operation, and wiper sweep. Confirmed no leaks at the reservoir or fluid lines.',
  },
  {
    title: 'Coolant Top-Off',
    description: 'Engine coolant level correction and leak visual inspection.',
    preWrittenStory:
      'Performed engine coolant top-off service. Verified the cooling system was cool, inspected for obvious external leaks, and added manufacturer-approved coolant to bring the level to the correct mark in the expansion tank. Reinstalled the cap securely and confirmed proper coolant color and level after a brief idle cycle.',
  },
  {
    title: 'Battery Test',
    description: '12-volt battery load test with printout and recommendation.',
    preWrittenStory:
      'Performed 12-volt battery test service. Connected electronic battery tester and conducted a load test on the main battery. Reviewed state-of-health and cranking performance results with the customer. Reinstalled all covers and verified normal system voltage with the engine running. Documented findings and recommendations.',
  },
  {
    title: 'Wiper Blade Replacement',
    description: 'Front or rear wiper blade/insert replacement.',
    preWrittenStory:
      'Performed wiper blade replacement service. Removed the worn wiper blade inserts or complete blade assemblies and installed new wiper blades. Verified correct attachment and full sweep across the windshield without chatter or streaking. Operated the washer system to confirm clear wiping performance.',
  },
  {
    title: 'Cabin Air Filter Replacement',
    description: 'HVAC cabin/pollen filter element replacement.',
    preWrittenStory:
      'Performed cabin air filter replacement service. Accessed the cabin filter housing, removed the old filter element, and cleaned debris from the housing. Installed a new cabin filter and reassembled all panels and clips. Verified proper HVAC airflow and no abnormal odor from the ventilation system.',
  },
];

export function isCustomerPayTemplateType(templateType: string | null | undefined): boolean {
  return templateType === 'CustomerPay';
}

export function templateRowIsCustomerPay(row: {
  isCustomerPay: boolean;
  templateType?: string;
  category?: string;
}): boolean {
  return row.isCustomerPay === true;
}