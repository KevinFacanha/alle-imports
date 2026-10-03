import {
  MarketplaceOrderBackfillStatus,
  PrismaClient,
} from '@prisma/client';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function main(): Promise<void> {
  const runIds = process.argv.slice(2);
  if (runIds.some((runId) => !UUID_PATTERN.test(runId))) {
    throw new Error('Every argument must be a run UUID.');
  }

  const database = new PrismaClient();
  try {
    const [runs, products, identities] = await Promise.all([
      database.marketplaceOrderBackfillRun.findMany({
        where: {
          OR: [
            {
              status: {
                in: [
                  MarketplaceOrderBackfillStatus.PENDING,
                  MarketplaceOrderBackfillStatus.RUNNING,
                ],
              },
            },
            ...(runIds.length > 0 ? [{ id: { in: runIds } }] : []),
          ],
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          status: true,
          dateFrom: true,
          dateTo: true,
          heartbeatAt: true,
          lastError: true,
          startedAt: true,
          completedAt: true,
          failedAt: true,
          attempts: true,
          pagesProcessed: true,
          ordersProcessed: true,
          updatedAt: true,
          businessAccount: { select: { code: true } },
        },
      }),
      database.product.count(),
      database.productExternalIdentity.count(),
    ]);
    const now = new Date();
    process.stdout.write(
      `${JSON.stringify(
        {
          inspectedAt: now.toISOString(),
          products,
          identities,
          runs: runs.map((run) => ({
            ...run,
            heartbeatAgeSeconds: run.heartbeatAt
              ? Math.floor((now.getTime() - run.heartbeatAt.getTime()) / 1_000)
              : null,
          })),
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await database.$disconnect();
  }
}

main().catch((error: unknown) => {
  const name =
    error instanceof Error && /^[A-Za-z]+$/.test(error.name)
      ? error.name
      : 'UnknownError';
  process.stderr.write(`Order sync state inspection failed (${name}).\n`);
  process.exitCode = 1;
});
