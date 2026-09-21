import { PrismaClient } from '@prisma/client';

const database = new PrismaClient();

try {
  const rows = await database.olistAuthorization.findMany({
    select: {
      olistAccountId: true,
      tokenType: true,
      scope: true,
      expiresAt: true,
      refreshExpiresAt: true,
      createdAt: true,
      updatedAt: true,
      olistAccount: {
        select: { name: true, active: true },
      },
    },
  });
  console.log(JSON.stringify({ now: new Date(), rows }, null, 2));
} finally {
  await database.$disconnect();
}
