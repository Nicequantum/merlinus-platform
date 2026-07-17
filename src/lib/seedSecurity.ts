import 'server-only';

import { verifyPassword } from './auth';
import { prisma } from './db';
import { getCanonicalSeedPassword, PRIMARY_MANAGER_D7, PRIMARY_TECH_D7 } from './seedDatabase';

function getSeedD7Numbers(): { managerD7: string; techD7: string } {
  return {
    managerD7: (process.env.ADMIN_SEED_D7?.trim() || PRIMARY_MANAGER_D7).toUpperCase(),
    techD7: (process.env.TECH_SEED_D7?.trim() || PRIMARY_TECH_D7).toUpperCase(),
  };
}

export interface SeedSecurityStatus {
  usingDefaultSeedPasswords: boolean;
  warnings: string[];
  accountsUsingDefaults: string[];
}

export async function checkSeedPasswordSecurity(): Promise<SeedSecurityStatus> {
  const { managerD7, techD7 } = getSeedD7Numbers();
  const accounts = await prisma.technician.findMany({
    where: { d7Number: { in: [managerD7, techD7] } },
    select: { d7Number: true, passwordHash: true, role: true },
  });

  const accountsUsingDefaults: string[] = [];
  const warnings: string[] = [];

  let canonicalSeedPassword = '';
  try {
    canonicalSeedPassword = getCanonicalSeedPassword();
  } catch {
    return {
      usingDefaultSeedPasswords: false,
      warnings: [],
      accountsUsingDefaults: [],
    };
  }

  for (const account of accounts) {
    const matchesCanonicalSeed = await verifyPassword(canonicalSeedPassword, account.passwordHash);
    if (!matchesCanonicalSeed) continue;

    if (account.d7Number) {
      accountsUsingDefaults.push(account.d7Number);
    }
    if (account.d7Number === managerD7) {
      warnings.push(
        'Manager account password still matches the canonical seed password — change it before production use.'
      );
    } else if (account.d7Number === techD7) {
      warnings.push(
        'Technician account password still matches the canonical seed password — change it before production use.'
      );
    }
  }

  return {
    usingDefaultSeedPasswords: accountsUsingDefaults.length > 0,
    warnings: [...new Set(warnings)],
    accountsUsingDefaults: [...new Set(accountsUsingDefaults)],
  };
}