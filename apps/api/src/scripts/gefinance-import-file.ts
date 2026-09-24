import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export class GeFinanceImportFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeFinanceImportFileError';
  }
}

export async function sha256GeFinanceFile(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('error', () => {
      reject(
        new GeFinanceImportFileError(
          'O arquivo GeFinance não pôde ser aberto para leitura.',
        ),
      );
    });
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolveHash(hash.digest('hex')));
  });
}
