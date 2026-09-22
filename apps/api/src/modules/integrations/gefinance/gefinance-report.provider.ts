import * as nodeFs from 'node:fs';
import { readFile as readBinaryFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';

import {
  CellObject,
  readFile,
  set_fs,
  utils,
  WorkBook,
  WorkSheet,
} from '@e965/xlsx';
import { Prisma } from '@prisma/client';

import { FinancialEvidenceProvider } from '../../finance/domain/financial-evidence.provider.js';
import {
  FinancialChannelCode,
  FinancialEvidenceRecord,
  FinancialEvidenceReport,
} from '../../finance/domain/financial-evidence.types.js';

const MAX_REPORT_BYTES = 25 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 500;
const MONEY_SCALE = 4;
const RATE_SCALE = 10;

set_fs(nodeFs);

export const GEFINANCE_REPORT_COLUMN_NAMES = {
  soldOn: 'Data da Venda',
  orderReference: 'Número E-commerce',
  channel: 'Canal de Venda',
  status: 'Status',
  productCostAmount: 'Custo Total dos Produtos',
  productSoldAmount: 'Valor do produto vendido',
  discountAmount: 'Desconto',
  totalProductsSoldAmount: 'Total prod. vendidos',
  customerShippingAmount: 'Valor Frete Pago pelo Cliente',
  totalSaleAmount: 'Total venda',
  feesAndCommissionsAmount: 'Comissão final',
  taxAmount: 'Imposto Total',
  netAmount: 'Valor Líquido',
  marginAmount: 'Margem',
  reportedMarginRate: '% sobre Venda',
} as const;

type GeFinanceField = keyof typeof GEFINANCE_REPORT_COLUMN_NAMES;
type ColumnIndexes = Record<GeFinanceField, number>;
type ReportCellValue = CellObject['v'] | null;

const REQUIRED_HEADERS: readonly string[] = Object.values(
  GEFINANCE_REPORT_COLUMN_NAMES,
);
const FINANCIAL_FULL_CHANNEL = 'Mercado Livre Fulfillment C2';

const CHANNEL_CODES: Readonly<Record<string, FinancialChannelCode>> = {
  'ML_ALEIMMPORTS 2': 'MERCADO_LIVRE_ACCOUNT_2',
  [FINANCIAL_FULL_CHANNEL]: 'MERCADO_LIVRE_FULFILLMENT_C2',
};

export interface GeFinanceReportInspection {
  from: string;
  to: string;
  recordCount: number;
  channels: Array<{
    original: string;
    normalized: FinancialChannelCode;
    recordCount: number;
  }>;
}

interface LoadedGeFinanceReport {
  source: 'GEFINANCE_REPORT';
  recordsByDate: ReadonlyMap<string, readonly FinancialEvidenceRecord[]>;
  marginDefinition: FinancialEvidenceReport['marginDefinition'];
}

export type GeFinanceReportErrorCode =
  | 'INVALID_EXTENSION'
  | 'FILE_NOT_FOUND'
  | 'FILE_TOO_LARGE'
  | 'UNSAFE_ARCHIVE'
  | 'INVALID_XLSX'
  | 'MISSING_HEADERS'
  | 'DUPLICATE_HEADERS'
  | 'EMPTY_REPORT'
  | 'INVALID_DATE'
  | 'INVALID_VALUE'
  | 'FORMULA_NOT_ALLOWED';

export class GeFinanceReportError extends Error {
  constructor(
    readonly code: GeFinanceReportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GeFinanceReportError';
  }
}

/**
 * XLSX-only GeFinance adapter. It does not persist the report and it never
 * returns columns outside the financial evidence allowlist above.
 */
export class GeFinanceReportProvider implements FinancialEvidenceProvider {
  private reportPromise?: Promise<LoadedGeFinanceReport>;

  constructor(private readonly reportPath: string) {}

  async getFinancialEvidence(params: {
    date: string;
  }): Promise<FinancialEvidenceReport> {
    validateIsoDate(params.date);
    const report = await (this.reportPromise ??= this.loadReport());

    return {
      source: report.source,
      date: params.date,
      records: [...(report.recordsByDate.get(params.date) ?? [])],
      marginDefinition: report.marginDefinition,
    };
  }

  async inspectReport(): Promise<GeFinanceReportInspection> {
    const report = await (this.reportPromise ??= this.loadReport());
    const dates = [...report.recordsByDate.keys()].sort();
    const channels = new Map<
      string,
      GeFinanceReportInspection['channels'][number]
    >();
    let recordCount = 0;

    for (const records of report.recordsByDate.values()) {
      recordCount += records.length;
      for (const record of records) {
        const key = `${record.channel.normalized}\u0000${record.channel.original}`;
        const existing = channels.get(key);
        if (existing) {
          existing.recordCount += 1;
        } else {
          channels.set(key, {
            ...record.channel,
            recordCount: 1,
          });
        }
      }
    }

    return {
      from: dates[0]!,
      to: dates.at(-1)!,
      recordCount,
      channels: [...channels.values()].sort((left, right) =>
        left.original.localeCompare(right.original, 'pt-BR'),
      ),
    };
  }

  private async loadReport(): Promise<LoadedGeFinanceReport> {
    await validateFile(this.reportPath);

    let workbook: WorkBook;
    try {
      workbook = readFile(this.reportPath, {
        bookVBA: false,
        cellDates: true,
        cellFormula: true,
        cellHTML: false,
        cellText: false,
        dense: false,
        WTF: false,
      });
    } catch {
      throw new GeFinanceReportError(
        'INVALID_XLSX',
        'O arquivo não é um XLSX válido ou está corrompido.',
      );
    }

    if (workbook.bookType && workbook.bookType !== 'xlsx') {
      throw new GeFinanceReportError(
        'INVALID_XLSX',
        'O conteúdo do arquivo não corresponde ao formato XLSX.',
      );
    }

    const selected = selectWorksheet(workbook);
    const recordsByDate = new Map<string, FinancialEvidenceRecord[]>();
    let sourceDataRows = 0;

    for (let rowNumber = 2; rowNumber <= selected.lastRow; rowNumber += 1) {
      if (isBlankReportRow(selected.worksheet, rowNumber, selected.columns)) {
        continue;
      }
      sourceDataRows += 1;
      const record = mapRow(selected.worksheet, rowNumber, selected.columns);
      const records = recordsByDate.get(record.soldOn) ?? [];
      records.push(record);
      recordsByDate.set(record.soldOn, records);
    }

    if (sourceDataRows === 0) {
      throw new GeFinanceReportError(
        'EMPTY_REPORT',
        'O relatório não contém registros financeiros.',
      );
    }

    return {
      source: 'GEFINANCE_REPORT',
      recordsByDate,
      marginDefinition: {
        amountColumn: GEFINANCE_REPORT_COLUMN_NAMES.marginAmount,
        baseColumn: GEFINANCE_REPORT_COLUMN_NAMES.totalProductsSoldAmount,
        reportedRateColumn: GEFINANCE_REPORT_COLUMN_NAMES.reportedMarginRate,
      },
    };
  }
}

async function validateFile(source: string): Promise<void> {
  if (extname(source).toLowerCase() !== '.xlsx') {
    throw new GeFinanceReportError(
      'INVALID_EXTENSION',
      'Extensão inválida. Apenas arquivos .xlsx são aceitos.',
    );
  }

  let fileStat;
  try {
    fileStat = await stat(source);
  } catch {
    throw new GeFinanceReportError(
      'FILE_NOT_FOUND',
      'O relatório XLSX não foi encontrado.',
    );
  }

  if (!fileStat.isFile() || fileStat.size === 0) {
    throw new GeFinanceReportError(
      'INVALID_XLSX',
      'O arquivo informado não é um XLSX válido.',
    );
  }
  if (fileStat.size > MAX_REPORT_BYTES) {
    throw new GeFinanceReportError(
      'FILE_TOO_LARGE',
      `O relatório excede o limite de ${MAX_REPORT_BYTES / 1024 / 1024} MB.`,
    );
  }

  const archive = await readBinaryFile(source);
  if (
    archive.length < 4 ||
    !archive.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
  ) {
    throw new GeFinanceReportError(
      'INVALID_XLSX',
      'O conteúdo do arquivo não corresponde ao formato XLSX.',
    );
  }
  validateArchiveLimits(archive);
}

function validateArchiveLimits(archive: Buffer): void {
  const endSignature = 0x06054b50;
  const centralSignature = 0x02014b50;
  const minimumEndOffset = Math.max(0, archive.length - 65_557);
  let endOffset = -1;
  for (let offset = archive.length - 22; offset >= minimumEndOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === endSignature) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) {
    throw invalidArchive();
  }

  const entries = archive.readUInt16LE(endOffset + 10);
  const centralSize = archive.readUInt32LE(endOffset + 12);
  const centralOffset = archive.readUInt32LE(endOffset + 16);
  if (
    entries === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff ||
    entries === 0 ||
    entries > MAX_ARCHIVE_ENTRIES ||
    centralOffset + centralSize > endOffset
  ) {
    throw invalidArchive();
  }

  let offset = centralOffset;
  let totalUncompressed = 0;
  for (let entry = 0; entry < entries; entry += 1) {
    if (
      offset + 46 > archive.length ||
      archive.readUInt32LE(offset) !== centralSignature
    ) {
      throw invalidArchive();
    }
    const flags = archive.readUInt16LE(offset + 8);
    const compression = archive.readUInt16LE(offset + 10);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const fileNameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    if ((flags & 0x1) !== 0 || (compression !== 0 && compression !== 8)) {
      throw new GeFinanceReportError(
        'UNSAFE_ARCHIVE',
        'O XLSX usa criptografia ou compactação não suportada.',
      );
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) {
      throw new GeFinanceReportError(
        'UNSAFE_ARCHIVE',
        'O conteúdo descompactado do XLSX excede o limite seguro de 100 MB.',
      );
    }
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  if (offset !== centralOffset + centralSize) {
    throw invalidArchive();
  }
}

function invalidArchive(): GeFinanceReportError {
  return new GeFinanceReportError(
    'INVALID_XLSX',
    'A estrutura interna do XLSX é inválida ou não suportada.',
  );
}

function selectWorksheet(workbook: WorkBook): {
  worksheet: WorkSheet;
  columns: ColumnIndexes;
  lastRow: number;
} {
  if (workbook.SheetNames.length === 0) {
    throw new GeFinanceReportError(
      'EMPTY_REPORT',
      'O relatório não contém planilhas.',
    );
  }

  let bestMatch: {
    worksheet: WorkSheet;
    headers: Map<string, number>;
    lastRow: number;
  } | null = null;
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const range = worksheet['!ref']
      ? utils.decode_range(worksheet['!ref'])
      : null;
    const headers = readHeaderIndexes(worksheet);
    if (!bestMatch || headerMatchCount(headers) > headerMatchCount(bestMatch.headers)) {
      bestMatch = {
        worksheet,
        headers,
        lastRow: range ? range.e.r + 1 : 0,
      };
    }
    if (REQUIRED_HEADERS.every((header) => headers.has(header))) {
      return {
        worksheet,
        columns: toColumnIndexes(headers),
        lastRow: range ? range.e.r + 1 : 0,
      };
    }
  }

  const missing = REQUIRED_HEADERS.filter(
    (header) => !bestMatch?.headers.has(header),
  );
  throw new GeFinanceReportError(
    'MISSING_HEADERS',
    `Cabeçalhos obrigatórios ausentes: ${missing.join(', ')}.`,
  );
}

function readHeaderIndexes(worksheet: WorkSheet): Map<string, number> {
  const headers = new Map<string, number>();
  const duplicates: string[] = [];
  const range = worksheet['!ref']
    ? utils.decode_range(worksheet['!ref'])
    : null;
  if (!range) {
    return headers;
  }
  for (let column = range.s.c; column <= range.e.c; column += 1) {
    const header = plainHeader(readCell(worksheet, 1, column + 1)?.v ?? null);
    if (header.length === 0) {
      continue;
    }
    if (headers.has(header)) {
      duplicates.push(header);
    } else {
      headers.set(header, column + 1);
    }
  }

  const duplicatedRequired = duplicates.filter((header) =>
    REQUIRED_HEADERS.includes(header),
  );
  if (duplicatedRequired.length > 0) {
    throw new GeFinanceReportError(
      'DUPLICATE_HEADERS',
      `Cabeçalhos obrigatórios duplicados: ${duplicatedRequired.join(', ')}.`,
    );
  }
  return headers;
}

function plainHeader(value: ReportCellValue): string {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value).trim();
  }
  return '';
}

function headerMatchCount(headers: Map<string, number>): number {
  return REQUIRED_HEADERS.filter((header) => headers.has(header)).length;
}

function toColumnIndexes(headers: Map<string, number>): ColumnIndexes {
  return Object.fromEntries(
    Object.entries(GEFINANCE_REPORT_COLUMN_NAMES).map(([field, header]) => [
      field,
      headers.get(header),
    ]),
  ) as ColumnIndexes;
}

function mapRow(
  worksheet: WorkSheet,
  rowNumber: number,
  columns: ColumnIndexes,
): FinancialEvidenceRecord {
  const value = (field: GeFinanceField): ReportCellValue => {
    const cell = readCell(worksheet, rowNumber, columns[field]);
    rejectFormula(cell, GEFINANCE_REPORT_COLUMN_NAMES[field], rowNumber);
    return cell?.v ?? null;
  };

  const soldOn = parseSaleDate(value('soldOn'), rowNumber);
  const channelOriginal = requiredText(
    value('channel'),
    GEFINANCE_REPORT_COLUMN_NAMES.channel,
    rowNumber,
  );

  return {
    soldOn,
    orderReference: requiredText(
      value('orderReference'),
      GEFINANCE_REPORT_COLUMN_NAMES.orderReference,
      rowNumber,
    ),
    channel: {
      original: channelOriginal,
      normalized: CHANNEL_CODES[channelOriginal] ?? 'OTHER',
    },
    status: requiredText(
      value('status'),
      GEFINANCE_REPORT_COLUMN_NAMES.status,
      rowNumber,
    ),
    productSoldAmount: money(value('productSoldAmount'), 'Valor do produto vendido', rowNumber),
    discountAmount: money(value('discountAmount'), 'Desconto', rowNumber),
    totalProductsSoldAmount: money(
      value('totalProductsSoldAmount'),
      'Total prod. vendidos',
      rowNumber,
    ),
    customerShippingAmount: money(
      value('customerShippingAmount'),
      'Valor Frete Pago pelo Cliente',
      rowNumber,
    ),
    totalSaleAmount: money(value('totalSaleAmount'), 'Total venda', rowNumber),
    productCostAmount: money(
      value('productCostAmount'),
      'Custo Total dos Produtos',
      rowNumber,
    ),
    feesAndCommissionsAmount: money(
      value('feesAndCommissionsAmount'),
      'Comissão final',
      rowNumber,
    ),
    taxAmount: money(value('taxAmount'), 'Imposto Total', rowNumber),
    netAmount: money(value('netAmount'), 'Valor Líquido', rowNumber),
    marginAmount: money(value('marginAmount'), 'Margem', rowNumber),
    reportedMarginRate: rate(
      value('reportedMarginRate'),
      '% sobre Venda',
      rowNumber,
    ),
    marginBaseAmount: money(
      value('totalProductsSoldAmount'),
      'Total prod. vendidos',
      rowNumber,
    ),
    isFinancialFulfillmentEvidence:
      channelOriginal === FINANCIAL_FULL_CHANNEL,
  };
}

function rejectFormula(
  cell: CellObject | undefined,
  column: string,
  row: number,
): void {
  if (cell?.f !== undefined || cell?.F !== undefined) {
    throw new GeFinanceReportError(
      'FORMULA_NOT_ALLOWED',
      `Fórmula não permitida na coluna "${column}", linha ${row}.`,
    );
  }
}

function requiredText(
  value: ReportCellValue,
  column: string,
  row: number,
): string {
  if (typeof value === 'string' || typeof value === 'number') {
    const text = String(value).trim();
    if (text.length > 0) {
      return text;
    }
  }
  throw invalidValue(column, row);
}

function parseSaleDate(value: ReportCellValue, row: number): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return [
      value.getUTCFullYear().toString().padStart(4, '0'),
      (value.getUTCMonth() + 1).toString().padStart(2, '0'),
      value.getUTCDate().toString().padStart(2, '0'),
    ].join('-');
  }
  if (typeof value === 'string') {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
    if (match) {
      const isoDate = `${match[3]}-${match[2]}-${match[1]}`;
      validateIsoDate(isoDate, row);
      return isoDate;
    }
  }
  throw invalidValue(GEFINANCE_REPORT_COLUMN_NAMES.soldOn, row);
}

function money(
  value: ReportCellValue,
  column: string,
  row: number,
): Prisma.Decimal {
  return decimalValue(value, column, row).toDecimalPlaces(
    MONEY_SCALE,
    Prisma.Decimal.ROUND_HALF_UP,
  );
}

function rate(
  value: ReportCellValue,
  column: string,
  row: number,
): Prisma.Decimal {
  if (typeof value === 'string' && value.trim().endsWith('%')) {
    return decimalValue(value.slice(0, -1), column, row)
      .dividedBy(100)
      .toDecimalPlaces(RATE_SCALE, Prisma.Decimal.ROUND_HALF_UP);
  }
  return decimalValue(value, column, row).toDecimalPlaces(
    RATE_SCALE,
    Prisma.Decimal.ROUND_HALF_UP,
  );
}

function decimalValue(
  value: ReportCellValue,
  column: string,
  row: number,
): Prisma.Decimal {
  let text: string;
  if (typeof value === 'number' && Number.isFinite(value)) {
    text = value.toString();
  } else if (typeof value === 'string') {
    text = normalizeLocalizedNumber(value);
  } else {
    throw invalidValue(column, row);
  }

  try {
    return new Prisma.Decimal(text);
  } catch {
    throw invalidValue(column, row);
  }
}

function normalizeLocalizedNumber(value: string): string {
  let normalized = value
    .trim()
    .replace(/\s|R\$/g, '');
  const parenthesized = normalized.startsWith('(') && normalized.endsWith(')');
  if (parenthesized) {
    normalized = normalized.slice(1, -1);
  }
  if (normalized.includes(',')) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  }
  return parenthesized ? `-${normalized}` : normalized;
}

function invalidValue(column: string, row: number): GeFinanceReportError {
  return new GeFinanceReportError(
    'INVALID_VALUE',
    `Valor inválido na coluna "${column}", linha ${row}.`,
  );
}

function validateIsoDate(value: string, row?: number): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new GeFinanceReportError(
      'INVALID_DATE',
      row === undefined
        ? 'A data deve usar o formato YYYY-MM-DD.'
        : `Data inválida na linha ${row}.`,
    );
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() + 1 !== Number(match[2]) ||
    date.getUTCDate() !== Number(match[3])
  ) {
    throw new GeFinanceReportError(
      'INVALID_DATE',
      row === undefined ? 'A data informada é inválida.' : `Data inválida na linha ${row}.`,
    );
  }
}

function isBlankReportRow(
  worksheet: WorkSheet,
  rowNumber: number,
  columns: ColumnIndexes,
): boolean {
  return Object.values(columns).every((column) => {
    const value = readCell(worksheet, rowNumber, column)?.v;
    return value === null || value === undefined || value === '';
  });
}

function readCell(
  worksheet: WorkSheet,
  oneBasedRow: number,
  oneBasedColumn: number,
): CellObject | undefined {
  return worksheet[
    utils.encode_cell({ r: oneBasedRow - 1, c: oneBasedColumn - 1 })
  ] as CellObject | undefined;
}
