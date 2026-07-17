'use client';

import { useState } from 'react';
import type { ComponentType } from 'react';
import { ApexOwnerDealershipBar } from '@/components/apex/ApexOwnerDealershipBar';
import { viewAsRoleLabel } from '@/lib/apex/viewAs';
import { exitOwnerDealership } from '@/lib/apexLoginSession';
import { clientLog } from '@/lib/clientLog';
import type { TechnicianSession } from '@/types';
import { toast } from 'sonner';

interface AuthenticatedAppProps {
  session: TechnicianSession;
  onLogout: () => Promise<void>;
  onSessionRefresh: () => Promise<TechnicianSession | null>;
}

interface ApexOwnerDealershipWorkspaceProps {
  session: TechnicianSession;
  onLogout: () => Promise<void>;
  onSessionRefresh: () => Promise<TechnicianSession | null>;
  AuthenticatedApp: ComponentType<AuthenticatedAppProps>;
}

function isOwnerHomeAfterExit(session: TechnicianSession): boolean {
  const scope = session.scopeMode ?? 'national';
  return session.role === 'owner' && (scope === 'national' || scope === 'group');
}

export function ApexOwnerDealershipWorkspace({
  session,
  onLogout,
  onSessionRefresh,
  AuthenticatedApp,
}: ApexOwnerDealershipWorkspaceProps) {
  const [exiting, setExiting] = useState(false);
  const rooftopName = session.dealershipName;
  const lensLabel = viewAsRoleLabel(session);
  const exitLabel = session.activeDealerGroupId
    ? 'Return to Group Owner'
    : 'Return to National Owner';

  const handleExit = async () => {
    setExiting(true);
    try {
      await exitOwnerDealership();
      const latest = await onSessionRefresh();
      if (!latest || !isOwnerHomeAfterExit(latest)) {
        throw new Error('Exit completed but session did not return to owner home scope');
      }
      const home =
        latest.scopeMode === 'group'
          ? latest.dealerGroupName || 'group operations'
          : 'national operations';
      toast.success(`Returned to ${home}`);
    } catch (error: unknown) {
      clientLog.error('owner.dealership_exit_failed', error);
      toast.error(error instanceof Error ? error.message : 'Could not exit dealership');
    } finally {
      setExiting(false);
    }
  };

  return (
    <div data-platform="apex" className="apex-app-root min-h-dvh flex flex-col">
      <ApexOwnerDealershipBar
        dealershipName={rooftopName}
        viewAsLabel={lensLabel || undefined}
        exitLabel={exitLabel}
        loading={exiting}
        onExit={() => void handleExit()}
      />
      <div className="flex-1 min-h-0">
        <AuthenticatedApp
          session={session}
          onLogout={onLogout}
          onSessionRefresh={onSessionRefresh}
        />
      </div>
    </div>
  );
}
