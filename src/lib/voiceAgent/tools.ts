/**
 * PR-M5a/b — tools bound to dealershipId from the inbound line (never from the model).
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
import {
  ensureMetrics,
  recordHandoff,
  recordToolResult,
  recordWorkItem,
} from '@/lib/voiceAgent/metrics';
import type {
  ConversationState,
  VoiceAgentName,
  VoiceToolResult,
} from '@/lib/voiceAgent/types';
import { isVoiceAgentName } from '@/lib/voiceAgent/types';

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
          customerEmail: { type: 'string' },
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
      name: 'transfer_with_context',
      description:
        'Prepare a richer handoff: store a short brief and optional reason for the next specialist before routing.',
      parameters: {
        type: 'object',
        properties: {
          brief: { type: 'string', description: '1-2 sentence context for the next agent' },
          reason: { type: 'string' },
          targetAgent: {
            type: 'string',
            enum: ['parts', 'sales', 'service', 'loaner', 'receptionist'],
          },
        },
        required: ['brief'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'route_to_parts',
      description: 'Hand the call to the Parts specialist agent.',
      parameters: { type: 'object', properties: { reason: { type: 'string' } } },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'route_to_sales',
      description: 'Hand the call to the Sales specialist agent.',
      parameters: { type: 'object', properties: { reason: { type: 'string' } } },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'route_to_service',
      description: 'Hand the call to the Service specialist agent.',
      parameters: { type: 'object', properties: { reason: { type: 'string' } } },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'route_to_loaner',
      description: 'Hand the call to the Loaner specialist agent.',
      parameters: { type: 'object', properties: { reason: { type: 'string' } } },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'route_to_receptionist',
      description: 'Return the call to the receptionist agent.',
      parameters: { type: 'object', properties: { reason: { type: 'string' } } },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_parts_request',
      description: 'Create a Parts department request for staff follow-up.',
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
      name: 'create_sales_request',
      description: 'Create a Sales department request for staff follow-up.',
      parameters: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          summary: { type: 'string' },
          customerName: { type: 'string' },
          customerPhone: { type: 'string' },
          vehicleLabel: { type: 'string' },
        },
        required: ['subject'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_service_request',
      description: 'Create a Service department request for appointment/staff follow-up.',
      parameters: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          summary: { type: 'string' },
          customerName: { type: 'string' },
          customerPhone: { type: 'string' },
          vin: { type: 'string' },
          vehicleLabel: { type: 'string' },
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
          outcome: {
            type: 'string',
            enum: ['resolved_by_agent', 'staff_followup', 'transferred_human', 'abandoned'],
          },
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
  transferredHuman?: boolean;
};

function pushRoute(
  state: ConversationState,
  from: VoiceAgentName,
  to: VoiceAgentName,
  reason?: string,
  brief?: string
): void {
  if (state.routingPath[state.routingPath.length - 1] !== to) {
    state.routingPath.push(to);
  }
  if (!state.handoffs) state.handoffs = [];
  state.handoffs.push({
    from,
    to,
    at: new Date().toISOString(),
    reason,
    brief: brief || state.slots.handoffBrief,
  });
  recordHandoff(state);
}

async function createDepartmentTicket(
  ctx: ToolExecutionContext,
  state: ConversationState,
  department: 'parts' | 'sales' | 'service',
  args: Record<string, unknown>
): Promise<ToolExecutionOutput> {
  const moduleId =
    department === 'parts' ? 'parts' : department === 'sales' ? null : null;
  // Sales/service use DepartmentRequest spine without separate modules in M5b —
  // only parts is module-gated for ticket creation; sales/service tickets always allowed when voice is on.
  if (moduleId) {
    const on = await isModuleEnabled(ctx.dealershipId, moduleId);
    if (!on) {
      return {
        result: { ok: false, message: `${department} module is not enabled` },
        state,
        activeAgent: ctx.activeAgent,
        endCall: false,
      };
    }
  }

  const str = (key: string) =>
    typeof args[key] === 'string' ? (args[key] as string).trim() : '';

  const subject =
    str('subject') ||
    state.slots.subject ||
    `${department[0]!.toUpperCase()}${department.slice(1)} request from phone`;
  const summary = str('summary') || state.slots.summary || state.slots.handoffBrief || '';
  const customerName = str('customerName') || state.slots.customerName || '';
  const customerPhone = str('customerPhone') || state.slots.customerPhone || '';
  const vin = (str('vin') || state.slots.vin || '').toUpperCase();
  const vehicleLabel = str('vehicleLabel') || state.slots.vehicleLabel || '';
  const partDescription = str('partDescription');
  const partNumber = str('partNumber');

  const row = await getRlsDb().departmentRequest.create({
    data: {
      dealershipId: ctx.dealershipId,
      department,
      source: 'voice_agent',
      status: 'new',
      priority: 'normal',
      subject: subject.slice(0, 200),
      summaryEncrypted: encryptSensitiveText(summary),
      customerNameEncrypted: encryptSensitiveText(customerName),
      customerPhoneEncrypted: encryptSensitiveText(customerPhone),
      customerPhoneLast4: phoneLast4(customerPhone),
      customerEmailEncrypted: encryptSensitiveText(state.slots.customerEmail || ''),
      vinEncrypted: encryptSensitiveText(vin),
      vinLast8: last8OfVin(vin),
      vehicleLabel: vehicleLabel || null,
      voiceCallId: ctx.callId,
      metadataJson: JSON.stringify({
        source: 'voice_agent',
        callId: ctx.callId,
        agent: ctx.activeAgent,
        handoffBrief: state.slots.handoffBrief || null,
      }),
      partsLines:
        department === 'parts' && partDescription
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
  recordWorkItem(state);

  return {
    result: {
      ok: true,
      message: `${department} request created`,
      data: { departmentRequestId: row.id, department },
    },
    state,
    activeAgent: ctx.activeAgent,
    endCall: false,
  };
}

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
    handoffs: [...(ctx.state.handoffs || [])],
    metrics: ensureMetrics(ctx.state),
  };
  let activeAgent = ctx.activeAgent;
  let endCall = false;
  let farewell: string | undefined;
  let transferredHuman = false;

  const str = (key: string) =>
    typeof args[key] === 'string' ? (args[key] as string).trim() : '';

  const finish = (result: VoiceToolResult, extra?: Partial<ToolExecutionOutput>) => {
    recordToolResult(state, result.ok);
    return {
      result,
      state,
      activeAgent,
      endCall,
      farewell,
      transferredHuman,
      ...extra,
    };
  };

  if (name === 'update_caller_info') {
    for (const key of [
      'customerName',
      'customerPhone',
      'customerEmail',
      'vin',
      'vehicleLabel',
      'subject',
      'summary',
    ] as const) {
      const v = str(key);
      if (v) state.slots[key] = v;
    }
    return finish({ ok: true, message: 'Caller info updated', data: { slots: state.slots } });
  }

  if (name === 'transfer_with_context') {
    const brief = str('brief');
    if (brief) state.slots.handoffBrief = brief;
    const target = str('targetAgent');
    if (target && isVoiceAgentName(target) && target !== activeAgent) {
      // Optional auto-route when target provided
      const from = activeAgent;
      if (target === 'loaner') {
        const loanerOn = await isModuleEnabled(ctx.dealershipId, 'loaner');
        if (!loanerOn) {
          return finish({ ok: false, message: 'Loaner module is not enabled' });
        }
      }
      if (target === 'parts') {
        const partsOn = await isModuleEnabled(ctx.dealershipId, 'parts');
        if (!partsOn) {
          return finish({ ok: false, message: 'Parts module is not enabled' });
        }
      }
      activeAgent = target;
      pushRoute(state, from, target, str('reason') || undefined, brief || undefined);
      return finish({
        ok: true,
        message: `Context saved and routed to ${target}`,
        data: { activeAgent, brief },
      });
    }
    return finish({
      ok: true,
      message: 'Handoff brief saved — call route_to_* next',
      data: { handoffBrief: state.slots.handoffBrief },
    });
  }

  const routeTo = async (to: VoiceAgentName, label: string) => {
    if (to === 'loaner') {
      const loanerOn = await isModuleEnabled(ctx.dealershipId, 'loaner');
      if (!loanerOn) return finish({ ok: false, message: 'Loaner module is not enabled' });
    }
    if (to === 'parts') {
      const partsOn = await isModuleEnabled(ctx.dealershipId, 'parts');
      if (!partsOn) return finish({ ok: false, message: 'Parts module is not enabled' });
    }
    const from = activeAgent;
    activeAgent = to;
    pushRoute(state, from, to, str('reason') || undefined);
    return finish({ ok: true, message: `Routed to ${label}` });
  };

  if (name === 'route_to_parts') return routeTo('parts', 'Parts specialist');
  if (name === 'route_to_sales') return routeTo('sales', 'Sales specialist');
  if (name === 'route_to_service') return routeTo('service', 'Service specialist');
  if (name === 'route_to_loaner') return routeTo('loaner', 'Loaner specialist');
  if (name === 'route_to_receptionist') return routeTo('receptionist', 'receptionist');

  if (name === 'create_parts_request') {
    return createDepartmentTicket(ctx, state, 'parts', args);
  }
  if (name === 'create_sales_request') {
    return createDepartmentTicket(ctx, state, 'sales', args);
  }
  if (name === 'create_service_request') {
    return createDepartmentTicket(ctx, state, 'service', args);
  }

  if (name === 'list_available_loaners') {
    const loanerOn = await isModuleEnabled(ctx.dealershipId, 'loaner');
    if (!loanerOn) return finish({ ok: false, message: 'Loaner module is not enabled' });
    const vehicles = await listAvailableLoaners(ctx.dealershipId);
    return finish({
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
    });
  }

  if (name === 'create_loaner_reservation') {
    const loanerOn = await isModuleEnabled(ctx.dealershipId, 'loaner');
    if (!loanerOn) return finish({ ok: false, message: 'Loaner module is not enabled' });
    const loanerVehicleId = str('loanerVehicleId');
    if (!loanerVehicleId) {
      return finish({ ok: false, message: 'loanerVehicleId is required' });
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
      recordWorkItem(state);
      return finish({
        ok: true,
        message: `Reserved unit ${assignment.unitNumber}`,
        data: { assignmentId: assignment.id, unitNumber: assignment.unitNumber },
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : 'error';
      return finish({ ok: false, message: `Could not reserve loaner (${code})` });
    }
  }

  if (name === 'end_call') {
    endCall = true;
    farewell = str('farewell') || 'Thank you for calling. Goodbye.';
    const outcome = str('outcome');
    if (outcome === 'transferred_human') transferredHuman = true;
    if (outcome) {
      ensureMetrics(state).outcome = outcome;
    }
    return finish({ ok: true, message: 'Ending call' }, { endCall, farewell, transferredHuman });
  }

  return finish({ ok: false, message: `Unknown tool: ${name}` });
}
