/**
 * PR-M5a — tools bound to a dealershipId from the inbound line (never from the model).
 */

import 'server-only';

import { encryptSensitiveText } from '@/lib/encryption';
import { getRlsDb } from '@/lib/apex/rlsContext';
import { last8OfVin, phoneLast4 } from '@/lib/department/piiHelpers';
import { isModuleEnabled } from '@/lib/modules/entitlements';
import {
  createLoanerReservation,
  listAvailableLoaners,
} from '@/lib/loaner/service';
import type { ConversationState, VoiceAgentName, VoiceToolResult } from '@/lib/voiceAgent/types';

export const VOICE_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'update_caller_info',
      description: 'Save caller name, phone, VIN, vehicle label, or request subject/summary slots.',
      parameters: {
        type: 'object',
        properties: {
          customerName: { type: 'string' },
          customerPhone: { type: 'string' },
          vin: { type: 'string' },
          vehicleLabel: { type: 'string' },
          subject: { type: 'string' },
          summary: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'route_to_parts',
      description: 'Hand the call to the Parts specialist agent.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'route_to_loaner',
      description: 'Hand the call to the Loaner specialist agent.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'route_to_receptionist',
      description: 'Return the call to the receptionist agent.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_parts_request',
      description:
        'Create a Parts department request in the dealership inbox for staff follow-up.',
      parameters: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          summary: { type: 'string' },
          customerName: { type: 'string' },
          customerPhone: { type: 'string' },
          vin: { type: 'string' },
          vehicleLabel: { type: 'string' },
          partDescription: { type: 'string' },
          partNumber: { type: 'string' },
        },
        required: ['subject'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_available_loaners',
      description: 'List loaner vehicles currently available at this dealership.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_loaner_reservation',
      description: 'Reserve an available loaner unit for the caller.',
      parameters: {
        type: 'object',
        properties: {
          loanerVehicleId: { type: 'string' },
          customerName: { type: 'string' },
          customerPhone: { type: 'string' },
        },
        required: ['loanerVehicleId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'end_call',
      description: 'End the phone call politely after the final spoken message.',
      parameters: {
        type: 'object',
        properties: {
          farewell: { type: 'string' },
        },
      },
    },
  },
];

export type ToolExecutionContext = {
  dealershipId: string;
  callId: string;
  state: ConversationState;
  activeAgent: VoiceAgentName;
};

export type ToolExecutionOutput = {
  result: VoiceToolResult;
  state: ConversationState;
  activeAgent: VoiceAgentName;
  endCall: boolean;
  farewell?: string;
};

export async function executeVoiceTool(
  name: string,
  rawArgs: string,
  ctx: ToolExecutionContext
): Promise<ToolExecutionOutput> {
  let args: Record<string, unknown> = {};
  try {
    args = rawArgs?.trim() ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
  } catch {
    args = {};
  }

  const state: ConversationState = {
    ...ctx.state,
    slots: { ...ctx.state.slots },
    routingPath: [...(ctx.state.routingPath || [])],
  };
  let activeAgent = ctx.activeAgent;
  let endCall = false;
  let farewell: string | undefined;

  const str = (key: string) =>
    typeof args[key] === 'string' ? (args[key] as string).trim() : '';

  if (name === 'update_caller_info') {
    for (const key of [
      'customerName',
      'customerPhone',
      'vin',
      'vehicleLabel',
      'subject',
      'summary',
    ] as const) {
      const v = str(key);
      if (v) state.slots[key] = v;
    }
    return {
      result: { ok: true, message: 'Caller info updated', data: { slots: state.slots } },
      state,
      activeAgent,
      endCall,
    };
  }

  if (name === 'route_to_parts') {
    activeAgent = 'parts';
    if (!state.routingPath.includes('parts')) state.routingPath.push('parts');
    return {
      result: { ok: true, message: 'Routed to Parts specialist' },
      state,
      activeAgent,
      endCall,
    };
  }

  if (name === 'route_to_loaner') {
    const loanerOn = await isModuleEnabled(ctx.dealershipId, 'loaner');
    if (!loanerOn) {
      return {
        result: { ok: false, message: 'Loaner module is not enabled for this dealership' },
        state,
        activeAgent,
        endCall,
      };
    }
    activeAgent = 'loaner';
    if (!state.routingPath.includes('loaner')) state.routingPath.push('loaner');
    return {
      result: { ok: true, message: 'Routed to Loaner specialist' },
      state,
      activeAgent,
      endCall,
    };
  }

  if (name === 'route_to_receptionist') {
    activeAgent = 'receptionist';
    return {
      result: { ok: true, message: 'Returned to receptionist' },
      state,
      activeAgent,
      endCall,
    };
  }

  if (name === 'create_parts_request') {
    const partsOn = await isModuleEnabled(ctx.dealershipId, 'parts');
    if (!partsOn) {
      return {
        result: { ok: false, message: 'Parts module is not enabled' },
        state,
        activeAgent,
        endCall,
      };
    }
    const subject =
      str('subject') || state.slots.subject || 'Parts request from phone';
    const summary = str('summary') || state.slots.summary || '';
    const customerName = str('customerName') || state.slots.customerName || '';
    const customerPhone = str('customerPhone') || state.slots.customerPhone || '';
    const vin = (str('vin') || state.slots.vin || '').toUpperCase();
    const vehicleLabel = str('vehicleLabel') || state.slots.vehicleLabel || '';
    const partDescription = str('partDescription');
    const partNumber = str('partNumber');

    const row = await getRlsDb().departmentRequest.create({
      data: {
        dealershipId: ctx.dealershipId,
        department: 'parts',
        source: 'voice_agent',
        status: 'new',
        priority: 'normal',
        subject: subject.slice(0, 200),
        summaryEncrypted: encryptSensitiveText(summary),
        customerNameEncrypted: encryptSensitiveText(customerName),
        customerPhoneEncrypted: encryptSensitiveText(customerPhone),
        customerPhoneLast4: phoneLast4(customerPhone),
        vinEncrypted: encryptSensitiveText(vin),
        vinLast8: last8OfVin(vin),
        vehicleLabel: vehicleLabel || null,
        voiceCallId: ctx.callId,
        metadataJson: JSON.stringify({ source: 'voice_agent', callId: ctx.callId }),
        partsLines: partDescription
          ? {
              create: [
                {
                  partNumber: partNumber || null,
                  description: partDescription.slice(0, 300),
                  qty: 1,
                  status: 'requested',
                  sortOrder: 0,
                },
              ],
            }
          : undefined,
      },
    });

    state.slots.departmentRequestId = row.id;
    state.slots.subject = subject;
    if (customerName) state.slots.customerName = customerName;
    if (customerPhone) state.slots.customerPhone = customerPhone;

    return {
      result: {
        ok: true,
        message: `Parts request created (id ${row.id.slice(0, 8)})`,
        data: { departmentRequestId: row.id },
      },
      state,
      activeAgent,
      endCall,
    };
  }

  if (name === 'list_available_loaners') {
    const loanerOn = await isModuleEnabled(ctx.dealershipId, 'loaner');
    if (!loanerOn) {
      return {
        result: { ok: false, message: 'Loaner module is not enabled' },
        state,
        activeAgent,
        endCall,
      };
    }
    const vehicles = await listAvailableLoaners(ctx.dealershipId);
    return {
      result: {
        ok: true,
        message:
          vehicles.length === 0
            ? 'No loaners available right now'
            : `${vehicles.length} loaner(s) available`,
        data: {
          vehicles: vehicles.map((v) => ({
            id: v.id,
            unitNumber: v.unitNumber,
            vehicleLabel: v.vehicleLabel,
            color: v.color,
            odometer: v.odometer,
          })),
        },
      },
      state,
      activeAgent,
      endCall,
    };
  }

  if (name === 'create_loaner_reservation') {
    const loanerOn = await isModuleEnabled(ctx.dealershipId, 'loaner');
    if (!loanerOn) {
      return {
        result: { ok: false, message: 'Loaner module is not enabled' },
        state,
        activeAgent,
        endCall,
      };
    }
    const loanerVehicleId = str('loanerVehicleId');
    if (!loanerVehicleId) {
      return {
        result: { ok: false, message: 'loanerVehicleId is required' },
        state,
        activeAgent,
        endCall,
      };
    }
    try {
      const assignment = await createLoanerReservation({
        dealershipId: ctx.dealershipId,
        loanerVehicleId,
        customerName: str('customerName') || state.slots.customerName,
        customerPhone: str('customerPhone') || state.slots.customerPhone,
        mode: 'reserve',
        notes: `Voice call ${ctx.callId}`,
      });
      state.slots.loanerAssignmentId = assignment.id;
      return {
        result: {
          ok: true,
          message: `Reserved unit ${assignment.unitNumber}`,
          data: { assignmentId: assignment.id, unitNumber: assignment.unitNumber },
        },
        state,
        activeAgent,
        endCall,
      };
    } catch (error) {
      const code = error instanceof Error ? error.message : 'error';
      return {
        result: { ok: false, message: `Could not reserve loaner (${code})` },
        state,
        activeAgent,
        endCall,
      };
    }
  }

  if (name === 'end_call') {
    endCall = true;
    farewell = str('farewell') || 'Thank you for calling. Goodbye.';
    return {
      result: { ok: true, message: 'Ending call' },
      state,
      activeAgent,
      endCall,
      farewell,
    };
  }

  return {
    result: { ok: false, message: `Unknown tool: ${name}` },
    state,
    activeAgent,
    endCall,
  };
}
