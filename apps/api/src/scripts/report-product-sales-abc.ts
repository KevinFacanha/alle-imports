import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module.js';
import { formatProductSalesAbcMarkdown } from '../modules/analytics/application/product-sales-abc.markdown.js';
import { ProductSalesAbcService } from '../modules/analytics/application/product-sales-abc.service.js';

interface Arguments {
  windowDays: number;
  format: 'json' | 'markdown';
  outputPath: string | null;
}

async function main(): Promise<void> {
  let application;
  try {
    const args = parseArguments(process.argv.slice(2));
    application = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });
    const report = await application
      .get(ProductSalesAbcService)
      .generate(args.windowDays);
    const contents =
      args.format === 'json'
        ? `${JSON.stringify(report, null, 2)}\n`
        : formatProductSalesAbcMarkdown(report);

    if (args.outputPath) {
      const outputPath = resolve(args.outputPath);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, contents, 'utf8');
      process.stdout.write(`${outputPath}\n`);
    } else {
      process.stdout.write(contents);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error.';
    process.stderr.write(`Product ABC report failed: ${message}\n`);
    process.exitCode = 1;
  } finally {
    await application?.close();
  }
}

function parseArguments(arguments_: string[]): Arguments {
  const values = new Map<string, string>();
  for (const argument of arguments_) {
    const separator = argument.indexOf('=');
    if (!argument.startsWith('--') || separator < 3) throw usageError();
    const name = argument.slice(2, separator);
    if (values.has(name)) throw usageError();
    values.set(name, argument.slice(separator + 1));
  }
  const allowed = new Set(['window-days', 'format', 'output']);
  if ([...values.keys()].some((name) => !allowed.has(name))) throw usageError();

  const windowDays = Number(values.get('window-days') ?? '30');
  if (!Number.isInteger(windowDays) || windowDays <= 0) throw usageError();
  const format = values.get('format') ?? 'markdown';
  if (format !== 'json' && format !== 'markdown') throw usageError();
  const outputPath = values.get('output')?.trim() || null;
  return { windowDays, format, outputPath };
}

function usageError(): Error {
  return new Error(
    'Usage: npm run report:product-abc -- [--window-days=30] [--format=markdown|json] [--output=path]',
  );
}

void main();
