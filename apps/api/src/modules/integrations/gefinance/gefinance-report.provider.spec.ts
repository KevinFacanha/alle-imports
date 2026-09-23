import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import {
  CellObject,
  utils,
  writeFile as writeXlsxFile,
} from '@e965/xlsx';
import { Prisma } from '@prisma/client';

import { summarizeFinancialEvidence } from '../../finance/application/financial-evidence-summary.js';
import {
  GEFINANCE_REPORT_COLUMN_NAMES,
  GeFinanceReportError,
  GeFinanceReportProvider,
} from './gefinance-report.provider.js';

const DATE = '2026-09-16';
const LOCAL_REAL_FIXTURE = resolve(
  process.cwd(),
  '.local-fixtures/gefinance/2026-09-16.xlsx',
);
const PII_HEADERS = ['Cliente', 'CPF/CNPJ', 'Telefone', 'Endereço', 'Email'];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('GeFinanceReportProvider', () => {
  it('reads a valid official-schema XLSX report', async () => {
    const file = await reportFile([row()]);

    const report = await read(file);

    assert.equal(report.source, 'GEFINANCE_REPORT');
    assert.equal(report.records.length, 1);
    assert.equal(report.records[0].soldOn, DATE);
    assert.equal(report.records[0].orderReference, 'ORDER-1');
    assert.equal(
      report.marginDefinition.baseColumn,
      'Total prod. vendidos',
    );
  });

  it('rejects reports with missing required headers and names every missing column', async () => {
    const headers = requiredHeaders().filter(
      (header) => header !== GEFINANCE_REPORT_COLUMN_NAMES.marginAmount,
    );
    const file = await reportFile([row()], headers);

    await assertReportError(read(file), 'MISSING_HEADERS', 'Margem');
  });

  it('parses Brazilian monetary strings and preserves signed amounts', async () => {
    const file = await reportFile([
      row({
        productSoldAmount: 'R$ 1.234,56',
        discountAmount: '-10,25',
        totalProductsSoldAmount: '1.224,31',
        totalSaleAmount: '1.224,31',
        marginAmount: '100,1256',
      }),
    ]);

    const record = (await read(file)).records[0];

    assertDecimal(record.productSoldAmount, '1234.56');
    assertDecimal(record.discountAmount, '-10.25');
    assertDecimal(record.totalProductsSoldAmount, '1224.31');
    assertDecimal(record.marginAmount, '100.1256');
  });

  it('represents every monetary field with Decimal', async () => {
    const record = (await read(await reportFile([row()]))).records[0];

    for (const value of [
      record.productSoldAmount,
      record.discountAmount,
      record.totalProductsSoldAmount,
      record.customerShippingAmount,
      record.totalSaleAmount,
      record.productCostAmount,
      record.feesAndCommissionsAmount,
      record.taxAmount,
      record.netAmount,
      record.marginAmount,
      record.marginBaseAmount,
    ]) {
      assert.ok(value instanceof Prisma.Decimal);
    }
  });

  it('parses percentage cells as a decimal rate', async () => {
    const file = await reportFile([
      row({ reportedMarginRate: '15,28485657%' }),
    ]);

    const record = (await read(file)).records[0];

    assertDecimal(record.reportedMarginRate, '0.1528485657');
  });

  it('aggregates margin from component sums instead of averaging row percentages', async () => {
    const file = await reportFile([
      row({
        orderReference: 'ORDER-1',
        totalProductsSoldAmount: 100,
        marginAmount: 50,
        reportedMarginRate: 0.5,
      }),
      row({
        orderReference: 'ORDER-2',
        totalProductsSoldAmount: 900,
        marginAmount: 9,
        reportedMarginRate: 0.01,
      }),
    ]);

    const summary = summarizeFinancialEvidence(await read(file));

    assertDecimal(summary.aggregateMargin.amount, '59');
    assertDecimal(summary.aggregateMargin.baseAmount, '1000');
    assertDecimal(summary.aggregateMargin.rate, '0.059');
  });

  it('separates a multi-day XLSX and calculates margin and Full evidence per day', async () => {
    const file = await reportFile([
      row({
        soldOn: '15/09/2026',
        orderReference: 'DAY-15-STANDARD',
        totalProductsSoldAmount: '100,10',
        totalSaleAmount: '100,10',
        marginAmount: '10,01',
      }),
      row({
        soldOn: '16/09/2026',
        orderReference: 'DAY-16-FULL',
        channel: 'Mercado Livre Fulfillment C2',
        totalProductsSoldAmount: '33,30',
        totalSaleAmount: '40,00',
        marginAmount: '3,33',
      }),
    ]);
    const provider = new GeFinanceReportProvider(file);

    const day15 = summarizeFinancialEvidence(
      await provider.getFinancialEvidence({ date: '2026-09-15' }),
    );
    const day16 = summarizeFinancialEvidence(
      await provider.getFinancialEvidence({ date: '2026-09-16' }),
    );
    const dayWithoutRows = summarizeFinancialEvidence(
      await provider.getFinancialEvidence({ date: '2026-09-14' }),
    );

    assert.equal(day15.recordCount, 1);
    assert.equal(day15.financialFullIndicators.records, 0);
    assertDecimal(day15.aggregateMargin.rate, '0.1');
    assert.equal(day16.recordCount, 1);
    assert.equal(day16.financialFullIndicators.records, 1);
    assertDecimal(day16.totals.totalSaleAmount, '40');
    assertDecimal(day16.aggregateMargin.rate, '0.1');
    assert.equal(dayWithoutRows.recordCount, 0);
    assert.equal(dayWithoutRows.aggregateMargin.rate, null);
    assert.ok(dayWithoutRows.totals.totalSaleAmount instanceof Prisma.Decimal);
    assert.equal(dayWithoutRows.totals.totalSaleAmount.toString(), '0');
  });

  it('inspects the complete report period, record count and channels in one validated load', async () => {
    const file = await reportFile([
      row({ soldOn: '22/09/2026', orderReference: 'LAST' }),
      row({ soldOn: '01/09/2026', orderReference: 'FIRST' }),
      row({
        soldOn: '01/09/2026',
        orderReference: 'FULL',
        channel: 'Mercado Livre Fulfillment C2',
      }),
    ]);

    const inspection = await new GeFinanceReportProvider(file).inspectReport();

    assert.deepEqual(inspection, {
      from: '2026-09-01',
      to: '2026-09-22',
      recordCount: 3,
      channels: [
        {
          original: 'Mercado Livre Fulfillment C2',
          normalized: 'MERCADO_LIVRE_FULFILLMENT_C2',
          recordCount: 1,
        },
        {
          original: 'ML_ALEIMMPORTS 2',
          normalized: 'MERCADO_LIVRE_ACCOUNT_2',
          recordCount: 2,
        },
      ],
    });
  });

  it('preserves original channels and normalizes multiple known channels', async () => {
    const file = await reportFile([
      row({ channel: 'ML_ALEIMMPORTS 1', orderReference: 'ORDER-C1' }),
      row({
        channel: 'Mercado Livre Fulfillment C1',
        orderReference: 'ORDER-FULL-C1',
      }),
      row({ channel: 'ML_ALEIMMPORTS 2', orderReference: 'ORDER-1' }),
      row({
        channel: 'Mercado Livre Fulfillment C2',
        orderReference: 'ORDER-2',
      }),
      row({ channel: 'Canal futuro', orderReference: 'ORDER-3' }),
    ]);

    const records = (await read(file)).records;

    assert.deepEqual(
      records.map((record) => [record.channel.original, record.channel.normalized]),
      [
        ['ML_ALEIMMPORTS 1', 'MERCADO_LIVRE_ACCOUNT_1'],
        [
          'Mercado Livre Fulfillment C1',
          'MERCADO_LIVRE_FULFILLMENT_C1',
        ],
        ['ML_ALEIMMPORTS 2', 'MERCADO_LIVRE_ACCOUNT_2'],
        [
          'Mercado Livre Fulfillment C2',
          'MERCADO_LIVRE_FULFILLMENT_C2',
        ],
        ['Canal futuro', 'OTHER'],
      ],
    );
  });

  it('keeps Full as separate financial evidence without operational inference', async () => {
    const file = await reportFile([
      row({ channel: 'ML_ALEIMMPORTS 2', orderReference: 'ORDER-1' }),
      row({
        channel: 'Mercado Livre Fulfillment C2',
        orderReference: 'ORDER-2',
        totalSaleAmount: 200,
      }),
    ]);

    const summary = summarizeFinancialEvidence(await read(file));

    assert.equal(summary.financialFullIndicators.records, 1);
    assert.equal(
      summary.financialFullIndicators.operationalClassification,
      'NOT_INFERRED',
    );
    assertDecimal(summary.financialFullIndicators.totalSaleAmount, '200');
  });

  it('rejects an empty report', async () => {
    const file = await reportFile([]);

    await assertReportError(read(file), 'EMPTY_REPORT');
  });

  it('does not expose PII columns or values in records or summaries', async () => {
    const pii = {
      Cliente: 'Pessoa Confidencial',
      'CPF/CNPJ': '000.000.000-00',
      Telefone: '+55 11 99999-9999',
      Endereço: 'Rua Privada, 123',
      Email: 'private@example.com',
    };
    const file = await reportFile([row({}, pii)], [
      ...requiredHeaders(),
      ...PII_HEADERS,
    ]);

    const report = await read(file);
    const serialized = JSON.stringify({
      report,
      summary: summarizeFinancialEvidence(report),
    });

    for (const [header, value] of Object.entries(pii)) {
      assert.equal(serialized.includes(header), false);
      assert.equal(serialized.includes(value), false);
    }
  });

  it('rejects formulas in financial evidence cells without evaluating them', async () => {
    const file = await reportFile([
      row({ marginAmount: { formula: '1+1', result: 2 } }),
    ]);

    await assertReportError(read(file), 'FORMULA_NOT_ALLOWED');
  });

  it('rejects invalid extensions and malformed XLSX input', async () => {
    const directory = await temporaryDirectory();
    const wrongExtension = join(directory, 'report.xlsm');
    const malformed = join(directory, 'report.xlsx');
    await writeFile(wrongExtension, 'not relevant');
    await writeFile(malformed, 'not an xlsx');

    await assertReportError(read(wrongExtension), 'INVALID_EXTENSION');
    await assertReportError(read(malformed), 'INVALID_XLSX');
  });

  it(
    'validates the ignored local fixture from 2026-09-16 without exposing PII',
    { skip: !existsSync(LOCAL_REAL_FIXTURE) },
    async () => {
      const report = await read(LOCAL_REAL_FIXTURE);
      const summary = summarizeFinancialEvidence(report);

      assert.equal(report.records.length, 112);
      assert.deepEqual(summary.channels, [
        'ML_ALEIMMPORTS 2',
        'Mercado Livre Fulfillment C2',
      ]);
      assert.deepEqual(
        summary.statusBreakdown.map(({ value, records }) => [value, records]),
        [
          ['Entregue', 27],
          ['Envio agendado', 81],
          ['Enviado', 3],
          ['Pronto para envio', 1],
        ],
      );
      assertDecimal(summary.totals.totalSaleAmount, '11224.04');
      assertDecimal(summary.totals.marginAmount, '2715.4012');
      assertDecimal(summary.aggregateMargin.baseAmount, '10548.24');
      assertDecimal(
        summary.aggregateMargin.rate,
        '0.25742694515862361873',
      );
      assert.equal(summary.financialFullIndicators.records, 8);
      assert.equal(JSON.stringify(summary).includes('Cliente'), false);
    },
  );
});

interface TestRow {
  soldOn: TestCellValue;
  orderReference: TestCellValue;
  channel: TestCellValue;
  status: TestCellValue;
  productCostAmount: TestCellValue;
  productSoldAmount: TestCellValue;
  discountAmount: TestCellValue;
  totalProductsSoldAmount: TestCellValue;
  customerShippingAmount: TestCellValue;
  totalSaleAmount: TestCellValue;
  feesAndCommissionsAmount: TestCellValue;
  taxAmount: TestCellValue;
  netAmount: TestCellValue;
  marginAmount: TestCellValue;
  reportedMarginRate: TestCellValue;
}

interface FormulaValue {
  formula: string;
  result: number;
}

type TestCellValue = CellObject['v'] | FormulaValue | null;

function row(
  overrides: Partial<TestRow> = {},
  extra: Record<string, TestCellValue> = {},
): Record<string, TestCellValue> {
  const values: TestRow = {
    soldOn: '16/09/2026',
    orderReference: 'ORDER-1',
    channel: 'ML_ALEIMMPORTS 2',
    status: 'Entregue',
    productCostAmount: 40,
    productSoldAmount: 100,
    discountAmount: -5,
    totalProductsSoldAmount: 95,
    customerShippingAmount: 10,
    totalSaleAmount: 105,
    feesAndCommissionsAmount: -15,
    taxAmount: -10,
    netAmount: 80,
    marginAmount: 40,
    reportedMarginRate: 0.4210526316,
    ...overrides,
  };
  return {
    [GEFINANCE_REPORT_COLUMN_NAMES.soldOn]: values.soldOn,
    [GEFINANCE_REPORT_COLUMN_NAMES.orderReference]: values.orderReference,
    [GEFINANCE_REPORT_COLUMN_NAMES.channel]: values.channel,
    [GEFINANCE_REPORT_COLUMN_NAMES.status]: values.status,
    [GEFINANCE_REPORT_COLUMN_NAMES.productCostAmount]: values.productCostAmount,
    [GEFINANCE_REPORT_COLUMN_NAMES.productSoldAmount]: values.productSoldAmount,
    [GEFINANCE_REPORT_COLUMN_NAMES.discountAmount]: values.discountAmount,
    [GEFINANCE_REPORT_COLUMN_NAMES.totalProductsSoldAmount]:
      values.totalProductsSoldAmount,
    [GEFINANCE_REPORT_COLUMN_NAMES.customerShippingAmount]:
      values.customerShippingAmount,
    [GEFINANCE_REPORT_COLUMN_NAMES.totalSaleAmount]: values.totalSaleAmount,
    [GEFINANCE_REPORT_COLUMN_NAMES.feesAndCommissionsAmount]:
      values.feesAndCommissionsAmount,
    [GEFINANCE_REPORT_COLUMN_NAMES.taxAmount]: values.taxAmount,
    [GEFINANCE_REPORT_COLUMN_NAMES.netAmount]: values.netAmount,
    [GEFINANCE_REPORT_COLUMN_NAMES.marginAmount]: values.marginAmount,
    [GEFINANCE_REPORT_COLUMN_NAMES.reportedMarginRate]:
      values.reportedMarginRate,
    ...extra,
  };
}

function requiredHeaders(): string[] {
  return Object.values(GEFINANCE_REPORT_COLUMN_NAMES);
}

async function reportFile(
  rows: Record<string, TestCellValue>[],
  headers = requiredHeaders(),
): Promise<string> {
  const directory = await temporaryDirectory();
  const file = join(directory, 'gefinance-report.xlsx');
  const matrix = [
    headers,
    ...rows.map((values) =>
      headers.map((header) => {
        const value = values[header] ?? null;
        return isFormulaValue(value) ? value.result : value;
      }),
    ),
  ];
  const worksheet = utils.aoa_to_sheet(matrix);
  rows.forEach((values, rowIndex) => {
    headers.forEach((header, columnIndex) => {
      const value = values[header];
      if (isFormulaValue(value)) {
        worksheet[
          utils.encode_cell({ r: rowIndex + 1, c: columnIndex })
        ] = {
          t: 'n',
          v: value.result,
          f: value.formula,
        };
      }
    });
  });
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, worksheet, 'Merged');
  writeXlsxFile(workbook, file, {
    bookType: 'xlsx',
    compression: true,
  });
  return file;
}

function isFormulaValue(value: TestCellValue | undefined): value is FormulaValue {
  return (
    value !== null &&
    value !== undefined &&
    typeof value === 'object' &&
    !(value instanceof Date) &&
    'formula' in value
  );
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'gefinance-report-'));
  temporaryDirectories.push(directory);
  return directory;
}

function read(file: string) {
  return new GeFinanceReportProvider(file).getFinancialEvidence({
    date: DATE,
  });
}

function assertDecimal(
  actual: Prisma.Decimal | null,
  expected: string,
): void {
  assert.ok(actual instanceof Prisma.Decimal);
  assert.equal(actual.toString(), expected);
}

async function assertReportError(
  promise: Promise<unknown>,
  code: GeFinanceReportError['code'],
  messageIncludes?: string,
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof GeFinanceReportError);
    assert.equal(error.code, code);
    if (messageIncludes) {
      assert.ok(error.message.includes(messageIncludes));
    }
    return true;
  });
}
