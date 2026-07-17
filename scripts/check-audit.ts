import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
  console.log(
    JSON.stringify(
      {
        count: logs.length,
        actions: logs.map((l) => l.action),
        entries: logs.map((l) => ({
          action: l.action,
          entityType: l.entityType,
          entityId: l.entityId,
          technicianId: l.technicianId,
        })),
      },
      null,
      2
    )
  );
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});