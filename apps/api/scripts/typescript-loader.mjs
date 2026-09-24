import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

let compiler;

function getCompiler() {
  if (compiler) {
    return compiler;
  }

  const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists);
  if (!configPath) {
    throw new Error('tsconfig.json da API não encontrado.');
  }
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error('tsconfig.json da API não pôde ser lido.');
  }
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    dirname(configPath),
    {
      declaration: false,
      incremental: false,
      noEmit: false,
      sourceMap: true,
    },
    configPath,
  );
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  compiler = { program };
  return compiler;
}

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (
      error?.code !== 'ERR_MODULE_NOT_FOUND' ||
      !specifier.startsWith('.') ||
      !specifier.endsWith('.js')
    ) {
      throw error;
    }
    return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
  }
}

export async function load(url, context, nextLoad) {
  if (!url.endsWith('.ts')) {
    return nextLoad(url, context);
  }

  const fileName = resolvePath(fileURLToPath(url));
  const { program } = getCompiler();
  const sourceFile = program.getSourceFile(fileName);
  if (!sourceFile) {
    throw new Error(`Arquivo TypeScript fora do projeto da API: ${fileName}`);
  }

  let source;
  const result = program.emit(sourceFile, (emittedFile, contents) => {
    if (emittedFile.endsWith('.js')) {
      source = contents;
    }
  });
  if (result.emitSkipped || source === undefined) {
    throw new Error(`Falha ao transpilar ${fileName}.`);
  }

  return { format: 'module', shortCircuit: true, source };
}
