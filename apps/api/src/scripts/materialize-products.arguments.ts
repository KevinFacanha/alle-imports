export interface ProductMaterializationCliArguments {
  planPath: string;
  execute: boolean;
  candidateIds: string[];
}

export class ProductMaterializationCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductMaterializationCliError';
  }
}

export function parseProductMaterializationArguments(
  args: string[],
): ProductMaterializationCliArguments {
  let planPath: string | undefined;
  let execute = false;
  let explicitDryRun = false;
  const candidateIds: string[] = [];

  for (const argument of args) {
    if (argument === '--execute' && !execute) {
      execute = true;
      continue;
    }
    if (argument === '--dry-run' && !explicitDryRun) {
      explicitDryRun = true;
      continue;
    }
    if (argument.startsWith('--plan=') && planPath === undefined) {
      planPath = argument.slice('--plan='.length);
      continue;
    }
    if (argument.startsWith('--candidate=')) {
      const candidateId = argument.slice('--candidate='.length);
      if (candidateId.length === 0) throw usageError();
      candidateIds.push(candidateId);
      continue;
    }
    throw usageError();
  }

  if (!planPath || (execute && explicitDryRun)) throw usageError();
  return { planPath, execute, candidateIds };
}

function usageError(): ProductMaterializationCliError {
  return new ProductMaterializationCliError(
    [
      'Usage: npm run materialize:products -- --plan=<json>',
      '[--dry-run | --execute]',
      '[--candidate=<PC-HIGH-xxx> ...]',
    ].join(' '),
  );
}
