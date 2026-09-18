import { isAbsolute, resolve } from 'node:path';

import { summarizeFinancialEvidence } from '../modules/finance/application/financial-evidence-summary.js';
import {
  GeFinanceReportError,
  GeFinanceReportProvider,
} from '../modules/integrations/gefinance/gefinance-report.provider.js';

async function main(): Promise<void> {
  const file = argument('file');
  const date = argument('date');
  if (!file || !date) {
    throw new GeFinanceReportError(
      'INVALID_VALUE',
      'Uso: npm run inspect:gefinance-report -- --file=<arquivo.xlsx> --date=YYYY-MM-DD',
    );
  }

  const report = await new GeFinanceReportProvider(
    resolveInputPath(file),
  ).getFinancialEvidence({
    date,
  });
  const summary = summarizeFinancialEvidence(report);

  process.stdout.write(`${JSON.stringify(safeOutput(summary), null, 2)}\n`);
}

function resolveInputPath(file: string): string {
  if (isAbsolute(file)) {
    return file;
  }
  return resolve(process.env.INIT_CWD ?? process.cwd(), file);
}

function safeOutput(
  summary: ReturnType<typeof summarizeFinancialEvidence>,
): Record<string, unknown> {
  const breakdown = (entry: (typeof summary.byChannel)[number]) => ({
    value: entry.value,
    records: entry.records,
    totals: decimalTotals(entry),
    marginRate: entry.marginRate?.toString() ?? null,
    marginPercentage: percentage(entry.marginRate),
  });

  return {
    source: summary.source,
    date: summary.date,
    recordCount: summary.recordCount,
    channels: summary.channels,
    statusBreakdown: summary.statusBreakdown.map(breakdown),
    totals: decimalTotals(summary.totals),
    aggregateMargin: {
      amount: summary.aggregateMargin.amount.toString(),
      baseAmount: summary.aggregateMargin.baseAmount.toString(),
      baseColumn: summary.aggregateMargin.baseColumn,
      rate: summary.aggregateMargin.rate?.toString() ?? null,
      percentage: percentage(summary.aggregateMargin.rate),
    },
    byChannel: summary.byChannel.map(breakdown),
    financialFullIndicators: {
      evidenceChannel: summary.financialFullIndicators.evidenceChannel,
      records: summary.financialFullIndicators.records,
      totals: decimalTotals(summary.financialFullIndicators),
      marginRate:
        summary.financialFullIndicators.marginRate?.toString() ?? null,
      marginPercentage: percentage(
        summary.financialFullIndicators.marginRate,
      ),
      operationalClassification:
        summary.financialFullIndicators.operationalClassification,
    },
  };
}

function decimalTotals(
  totals: ReturnType<typeof summarizeFinancialEvidence>['totals'],
): Record<string, string> {
  return {
    productSoldAmount: totals.productSoldAmount.toString(),
    discountAmount: totals.discountAmount.toString(),
    totalProductsSoldAmount: totals.totalProductsSoldAmount.toString(),
    customerShippingAmount: totals.customerShippingAmount.toString(),
    totalSaleAmount: totals.totalSaleAmount.toString(),
    productCostAmount: totals.productCostAmount.toString(),
    feesAndCommissionsAmount: totals.feesAndCommissionsAmount.toString(),
    taxAmount: totals.taxAmount.toString(),
    netAmount: totals.netAmount.toString(),
    marginAmount: totals.marginAmount.toString(),
  };
}

function percentage(
  rate: ReturnType<typeof summarizeFinancialEvidence>['aggregateMargin']['rate'],
): string | null {
  return rate?.times(100).toDecimalPlaces(4).toString() ?? null;
}

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

main().catch((error: unknown) => {
  const safeError =
    error instanceof GeFinanceReportError
      ? { code: error.code, message: error.message }
      : {
          code: 'UNEXPECTED_ERROR',
          message: 'Não foi possível inspecionar o relatório.',
        };
  process.stderr.write(`${JSON.stringify({ error: safeError })}\n`);
  process.exitCode = 1;
});
