const startedAt = Date.now();
process.env.GEFINANCE_UPDATE_STARTED_AT = String(startedAt);
process.stdout.write('[00:00] Iniciando atualização GeFinance\n');
process.stdout.write('[00:00] Validando arquivos\n');

await import('../src/scripts/update-gefinance.ts');
