export type TemplateCategory = 'customer' | 'warranty';

import { getKnowledgeBaseOriginal } from '@/data/knowledgeBaseOriginals';

export interface StoryTemplateSeed {
  title: string;
  category: TemplateCategory;
  tags: string[];
  complaint: string;
  cause: string;
  correction: string;
}

function buildCleanTemplate(entry: Pick<StoryTemplateSeed, 'complaint' | 'cause' | 'correction'>): string {
  return `Customer Complaint/Concern:
${entry.complaint}

Cause:
${entry.cause}

Correction:
${entry.correction}`;
}

/** Warranty-only seeds — Customer Pay templates live in `src/prompts/templates/customerPayTemplates.ts`. */
export const STORY_TEMPLATE_SEEDS: StoryTemplateSeed[] = [
  // ─── Warranty Claims ────────────────────────────────────────────────────────
  {
    title: 'Blind Spot Assist Warning',
    category: 'warranty',
    tags: ['blind-spot', 'assist', 'radar', 'warning', 'driver-assistance', 'BAS'],
    complaint: 'Customer states blind spot assist warning/message displays intermittently or remains on while driving.',
    cause:
      'Initial test drive confirmed blind spot assist warning present during lane change simulation. Source voltage verified at battery. Battery charger installed. Connected XENTRY — Quick Test stored faults related to blind spot assist/radar sensor communication. Guided testing confirmed fault in blind spot monitor circuit/sensor. Found blind spot radar sensor/module internal fault or out-of-calibration condition causing false/unavailable status.',
    correction:
      'Replaced faulty blind spot assist radar sensor/module per guided test direction. Cleared faults and performed blind spot system calibration/initialization per WIS. Final Quick Test — no faults present. Disconnected charger and XENTRY. Final verification test drive — blind spot assist operated normally with no warning messages.',
  },
  {
    title: 'MBUX System Failure',
    category: 'warranty',
    tags: ['mbux', 'head-unit', 'infotainment', 'screen', 'freeze', 'reboot'],
    complaint: 'Customer reports MBUX system failure — screen black, rebooting, or functions unavailable.',
    cause:
      'Confirmed MBUX inoperative/unstable on test drive and at key-on. Voltage maintained with battery charger. XENTRY Quick Test showed communication/control faults for head unit or infotainment CAN nodes. Guided testing indicated MBUX head unit internal failure or corrupted software state not recoverable by reset.',
    correction:
      'Performed documented power reset and software reload attempt per WIS. Fault persisted. Replaced MBUX head unit/control unit. Programmed/coded new unit to vehicle. Cleared faults — final Quick Test verified communication. Verification drive confirmed stable MBUX operation (audio, navigation, Bluetooth, backup camera).',
  },
  {
    title: 'Cylinder Head Failure',
    category: 'warranty',
    tags: ['engine', 'cylinder-head', 'coolant', 'overheat', 'misfire', 'M276', 'M264'],
    complaint: 'Customer reports engine running rough, overheating, coolant loss, and/or check engine light on.',
    cause:
      'Test drive confirmed rough running and/or temperature concern. XENTRY Quick Test showed cylinder-specific misfire and cooling system faults. Pressure tested cooling system — leak at cylinder head area. Combustion gas present in coolant. Cylinder head found cracked/warped or head gasket failed causing cross-contamination and misfire.',
    correction:
      'Removed cylinder head per workshop manual. Replaced cylinder head and head gasket set with required bolts. Replaced associated seals, thermostat, and coolant as required. Filled/bleed cooling system. Cleared adaptations where specified. Final Quick Test — no misfire/cooling faults. Road test — normal power, operating temperature stable.',
  },
  {
    title: 'Wind Noise Repair',
    category: 'warranty',
    tags: ['wind-noise', 'b-pillar', 'door-seal', 'weatherstrip', 'NVH', 'rattle'],
    complaint: 'Customer reports wind noise at highway speed, particularly from door/B-pillar/mirror area.',
    cause:
      'Test drive at highway speed reproduced wind noise at identified location. Inspected door seals, mirror gap, and trim alignment — found seal compression set, misaligned trim clip, or door adjustment out of specification causing turbulence.',
    correction:
      'Adjusted door/mirror/trim per body fit standards. Replaced worn door seal or trim clip as needed. Applied foam tape/anti-rattle correction per workshop bulletin where applicable. Verification drive at highway speed — wind noise eliminated or reduced to normal level.',
  },
  {
    title: 'MBUX / CarPlay Update',
    category: 'warranty',
    tags: ['mbux', 'carplay', 'apple', 'software', 'update', 'connectivity'],
    complaint: 'Customer reports Apple CarPlay/Android Auto disconnects, will not connect, or MBUX connectivity issues.',
    cause:
      'Verified connectivity concern. XENTRY showed no hardware faults after Quick Test; software version out of date or corrupted connectivity module configuration. USB port/cable test confirmed port power/data within spec — root cause software/head unit application layer.',
    correction:
      'Applied latest MBUX/communication software update per TIPS/SCN bulletin. Reset user profiles and paired devices as directed. Cleared faults. Verified stable CarPlay/USB/Bluetooth connection on road test and bench check.',
  },
  {
    title: 'Lean Condition / Injector Replacement',
    category: 'warranty',
    tags: ['lean', 'injector', 'fuel', 'P0171', 'P0174', 'misfire', 'direct-injection'],
    complaint: 'Customer reports check engine light on, rough idle, hesitation, or poor fuel economy.',
    cause:
      'Quick Test showed lean mixture codes (P0171/P0174) and/or cylinder misfire. Fuel pressure and injector balance testing identified weak/leaking direct injector causing lean condition.',
    correction:
      'Replaced failed fuel injector(s) and seals. Replaced spark plugs on affected bank if required. Cleared adaptations and performed injector coding/adaptation relearn. Final Quick Test — fuel trims normalized, no misfire. Road test — smooth idle and acceleration.',
  },
  {
    title: 'Auxiliary Coolant Pump Failure',
    category: 'warranty',
    tags: ['coolant-pump', 'auxiliary', 'overheat', 'hybrid', '48v', 'P0C2F'],
    complaint: 'Customer reports overheating message, coolant pump fault, or reduced power after driving.',
    cause:
      'Quick Test stored auxiliary coolant pump circuit faults. Commanded pump — no response/low flow. Pump motor internal failure confirmed.',
    correction:
      'Drained coolant as required. Replaced auxiliary coolant pump and seals/hoses as needed. Refilled and bled cooling system. Final Quick Test — pump operation normal, no faults. Road test — temperatures stable.',
  },
  {
    title: 'Trunk Lid Latch Failure',
    category: 'warranty',
    tags: ['trunk', 'liftgate', 'latch', 'tailgate', 'will-not-close', 'power-trunk'],
    complaint: 'Customer reports trunk/liftgate will not latch, opens while driving, or power trunk inoperative.',
    cause:
      'Inspected latch and striker — latch mechanism binding or microswitch out of adjustment. Quick Test showed trunk/liftgate latch fault. Latch motor/solenoid failed internal switch test.',
    correction:
      'Replaced trunk/liftgate latch assembly. Adjusted striker alignment. Initialized power trunk if equipped. Verified manual and power closing — proper latch indication on instrument cluster.',
  },
  {
    title: '48V Low Temperature Circuit Fault',
    category: 'warranty',
    tags: ['48v', 'mild-hybrid', 'EQ-Boost', 'battery', 'low-temperature', 'BMS'],
    complaint: 'Customer reports 48V system fault, stop/start disabled, or hybrid battery warning.',
    cause:
      'Quick Test showed 48V battery/mild hybrid system faults related to low temperature monitoring circuit. Guided test found wiring/sensor or 48V battery control module reporting implausible temperature.',
    correction:
      'Repaired harness/sensor as indicated or replaced 48V battery module/component per guided test. Cleared faults and performed 48V system relearn. Verification drive — stop/start and boost functions normal.',
  },
  {
    title: 'DC/DC Converter Fault',
    category: 'warranty',
    tags: ['dc-dc', 'converter', '48v', 'charging', 'system-fault', 'electrical'],
    complaint: 'Customer reports vehicle system fault, 12V/48V charging concern, or multiple electrical warnings.',
    cause:
      'Quick Test DC/DC converter output faults. Converter unable to maintain specified 12V supply from 48V system — internal module failure confirmed via guided test.',
    correction:
      'Replaced DC/DC converter module. Performed coding if required. Cleared faults — charging voltages normal on final Quick Test. Road test — no electrical warnings.',
  },
  {
    title: 'Display Freezing / Pixelation',
    category: 'warranty',
    tags: ['display', 'pixelation', 'screen', 'instrument-cluster', 'IC', 'freeze'],
    complaint: 'Customer reports instrument cluster or center display freezing, pixelated, or unresponsive.',
    cause:
      'Observed display artifacting/freeze during operation. Quick Test communication faults for instrument cluster/display control unit. Hardware failure — not corrected by software reset.',
    correction:
      'Replaced affected display/control unit. Coded to vehicle. Final Quick Test — communication normal. Verified all pixels/segments and touch functions on road test.',
  },
  {
    title: 'Ease of Entry Malfunction',
    category: 'warranty',
    tags: ['ease-of-entry', 'airmatic', 'suspension', 'lower', 'raise', 'AIRMATIC'],
    complaint: 'Customer reports ease of entry feature not lowering vehicle or suspension fault message.',
    cause:
      'Quick Test Airmatic/ease-of-entry faults. System pressure or level sensor prevented lower position. Found valve block leak or level sensor/out-of-calibration preventing commanded drop.',
    correction:
      'Repaired/replaced faulty Airmatic component (valve block, strut, level sensor) per guided test. Performed suspension calibration. Ease of entry lowers on key off and raises on drive — verified.',
  },
  {
    title: 'Oil Pump Control Valve (M264)',
    category: 'warranty',
    tags: ['oil-pump', 'M264', 'control-valve', 'oil-pressure', 'engine', 'timing'],
    complaint: 'Customer reports check engine light, oil pressure warning, or engine noise.',
    cause:
      'Quick Test oil pressure control/variable oil pump circuit faults on M264. Oil pressure below target at idle/hot — oil pump control solenoid/valve stuck or pump wear confirmed.',
    correction:
      'Replaced oil pump control valve and/or oil pump assembly per WIS. New seals and pickup tube O-ring as required. Cleared faults, verified oil pressure hot idle and 3000 RPM. Road test — no warnings.',
  },
  {
    title: 'Front Differential Pinion Seal Leak',
    category: 'warranty',
    tags: ['differential', 'pinion-seal', 'leak', '4matic', 'AWD', 'fluid'],
    complaint: 'Customer reports fluid leak under vehicle or differential area wet with oil.',
    cause:
      'Inspected front differential — pinion seal leaking at yoke. Fluid level low on fill plug check. No abnormal differential noise on test drive.',
    correction:
      'Removed driveshaft, replaced pinion seal, torqued pinion nut to spec with new crush sleeve if required. Refilled with approved differential fluid. Road test — no leak, no noise.',
  },
  {
    title: 'Intermittent CEL Software Update',
    category: 'warranty',
    tags: ['cel', 'software', 'update', 'ecu', 'powertrain', 'intermittent'],
    complaint: 'Customer reports check engine light on intermittently with no noticeable drivability change.',
    cause:
      'Quick Test stored powertrain software-related faults or implausible sensor readings corrected in later software. No failed hardware on guided tests.',
    correction:
      'Applied latest engine/ECU software update per TIPS bulletin. Cleared faults. Monitored readiness and fault status on road test — no MIL recurrence.',
  },
  {
    title: 'MBUX Watchdog Fault',
    category: 'warranty',
    tags: ['mbux', 'watchdog', 'reset', 'head-unit', 'software', 'freeze'],
    complaint: 'Customer reports MBUX randomly reboots or displays system watchdog fault.',
    cause:
      'Quick Test infotainment watchdog/reset faults. Software corruption or head unit internal watchdog timer failure. Reset did not permanently resolve.',
    correction:
      'Reloaded software; if fault returned, replaced head unit. Coded and updated to latest version. Final Quick Test — no watchdog faults after extended operation test.',
  },
  {
    title: 'Cold Dash Creak / Rattle',
    category: 'warranty',
    tags: ['rattle', 'creak', 'dash', 'NVH', 'cold', 'trim'],
    complaint: 'Customer reports dashboard creak/rattle over bumps when cold.',
    cause:
      'Cold soak road test reproduced dash creak at IP/passenger side. Found loose trim clip or rubbing contact between dash carrier and trim panel.',
    correction:
      'Added felt tape/shim at contact points, secured trim clips, torqued fasteners to spec. Cold start verification drive — no creak.',
  },
  {
    title: 'Bus Keep-Awake Condition',
    category: 'warranty',
    tags: ['keep-awake', 'CAN', 'bus', 'battery-drain', 'control-unit', 'sleep'],
    complaint: 'Customer reports battery dead overnight or vehicle will not sleep / multiple warnings after sit.',
    cause:
      'Measured network sleep current — vehicle not entering rest mode. Quick Test showed control unit preventing bus sleep (keep-awake). Identified module via guided test/current draw.',
    correction:
      'Repaired wiring fault or replaced control unit preventing sleep. Verified quiescent current below specification after 30-minute shutdown. No keep-awake faults on final Quick Test.',
  },
  {
    title: 'Rear Airmatic Strut Replacement',
    category: 'warranty',
    tags: ['airmatic', 'strut', 'rear', 'suspension', 'leak', 'AIRMATIC'],
    complaint: 'Customer reports vehicle sits low on one corner, suspension fault, or rough ride.',
    cause:
      'Quick Test Airmatic pressure/level faults. Visual inspection — rear strut leaking air. System unable to maintain rear corner height.',
    correction:
      'Replaced failed rear Airmatic strut. Performed suspension fill/bleed and calibration. Heights equalized — road test ride height stable.',
  },
  {
    title: 'RAMSES Telematics Replacement',
    category: 'warranty',
    tags: ['RAMSES', 'telematics', 'communication', 'Mercedes-me', 'TCU', 'antenna'],
    complaint: 'Customer reports Mercedes me connect inoperative, SOS/telematics fault, or communication error.',
    cause:
      'Quick Test RAMSES/telematics communication faults. Antenna/power checks OK — telematics control unit failed internal self-test.',
    correction:
      'Replaced RAMSES/telematics module. Coded and activated services. Final Quick Test — telematics online. Verified signal/connectivity indicators.',
  },
  {
    title: 'Rear Shock Absorber Replacement',
    category: 'warranty',
    tags: ['shock', 'absorber', 'rear', 'suspension', 'bounce', 'leak'],
    complaint: 'Customer reports excessive bounce, rear instability, or fluid leak at rear shock.',
    cause:
      'Road test confirmed rear instability over bumps. Inspection found rear shock leaking/failed — no damping control.',
    correction:
      'Replaced rear shock absorbers (pair). Torqued fasteners to spec. Road test — stable rear damping, no leaks.',
  },
  {
    title: 'Driveline Vibration Repair',
    category: 'warranty',
    tags: ['driveline', 'vibration', 'driveshaft', 'carrier-bearing', 'flex-disc', 'shudder'],
    complaint: 'Customer reports driveline vibration/shudder at highway speed or on acceleration.',
    cause:
      'Test drive reproduced vibration 45–65 MPH. Inspected flex disc, center bearing, and shaft alignment — worn flex disc or out-of-balance joint causing driveline vibration.',
    correction:
      'Replaced flex disc/center bearing/driveshaft section as required. Balanced assembly per spec. Road test — vibration eliminated.',
  },
];

export function toTemplateContent(seed: StoryTemplateSeed): string {
  return buildCleanTemplate(seed);
}

export function toKnowledgeBaseFields(seed: StoryTemplateSeed) {
  const cleanTemplate = buildCleanTemplate(seed);
  const userOriginal = getKnowledgeBaseOriginal(seed.title);
  return {
    title: seed.title,
    category: seed.category,
    fullOriginalText: userOriginal ?? '',
    cleanTemplate,
    tags: JSON.stringify(seed.tags),
  };
}