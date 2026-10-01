import {
  ProductSalesAbcMetric,
  ProductSalesAbcReport,
} from './product-sales-abc.service.js';

export function formatProductSalesAbcMarkdown(
  report: ProductSalesAbcReport,
): string {
  const lines: string[] = [
    '# Curva ABC por quantidade vendida — fundação read-only',
    '',
    `Gerado em ${dateTime(report.metadata.generatedAt, report)}.`,
    '',
    '> Escopo: somente os 110 Products materializados com confiança HIGH. Itens sem Product não entram no denominador da Curva ABC; seu impacto aparece em Cobertura.',
    '',
    '## Resumo executivo',
    '',
    `- Janela móvel: ${report.metadata.windowDays} dias, de ${dateTime(report.metadata.windowFrom, report)} até ${dateTime(report.metadata.windowTo, report)}.`,
    `- Dados persistidos: de ${dateTime(report.metadata.loadedFrom, report)} até ${dateTime(report.metadata.loadedTo, report)}.`,
    `- Venda válida no baseline: somente status \`PAID\`.`,
    `- Pedidos pagos: ${integer(report.totals.validPaidOrders)}; unidades pagas: ${integer(report.totals.validPaidUnits)}.`,
    `- Pedidos pagos cobertos: ${integer(report.totals.coveredPaidOrders)}; unidades pagas cobertas: ${integer(report.totals.coveredPaidUnits)}.`,
    `- Escritas no banco: ${report.metadata.writesPerformed}.`,
    '',
    '## Regra aplicada',
    '',
    '- Incluído: `PAID`.',
    '- Excluídos do baseline: `CANCELLED`, `PENDING`, `PROCESSING`, `UNKNOWN`, `REFUNDED` e `PARTIALLY_REFUNDED`.',
    '- `REFUNDED` e `PARTIALLY_REFUNDED` ficam separados no impacto por status. Não houve rateio de unidades por valor reembolsado.',
    '- Ordenação: `unitsSoldTotal DESC`, depois `sku ASC` e `productId ASC`, garantindo desempate determinístico.',
    '- Cruzamento dos limites: a classe é definida pelo acumulado antes de adicionar o Product. Assim, o Product que alcança ou ultrapassa 80% fecha A; o que alcança ou ultrapassa 95% fecha B. O Product não é fracionado.',
    `- Product sem venda válida na janela tem \`lastSaleAt = null\` e dias sem venda exibidos como \`≥ ${report.metadata.windowDays}\`; não se inventa uma data anterior à janela observada.`,
    '',
    '## Auditoria dos relacionamentos',
    '',
    '`MarketplaceOrderItem → MarketplaceOrder → MarketplaceAccount → BusinessAccount` fornece status, `soldAt` e C1/C2. `MarketplaceOrderItem.quantity` fornece as unidades. O Product é resolvido por `MarketplaceOrderItem.productId` e, quando nulo, por `MarketplaceOrderItem.marketplaceListingItemId → MarketplaceListingItem.productId`.',
    '',
    '| Caminho | Itens na janela |',
    '|---|---:|',
    `| Product direto no order item | ${integer(report.relationshipAudit.resolvedByOrderItemProduct)} |`,
    `| Product via listing item | ${integer(report.relationshipAudit.resolvedByListingItemProduct)} |`,
    `| Sem Product | ${integer(report.relationshipAudit.unresolvedItems)} |`,
    `| Conflito entre os dois caminhos | ${integer(report.relationshipAudit.conflictingProductLinks)} |`,
    '',
    '## Impacto por status',
    '',
    '| Status | Pedidos | Itens | Unidades | Itens com Product | Unidades com Product | Pago (R$) | Reembolsado (R$) | Baseline |',
    '|---|---:|---:|---:|---:|---:|---:|---:|:---:|',
    ...report.statusImpact.map((status) =>
      `| ${status.status} | ${integer(status.orders)} | ${integer(status.items)} | ${integer(status.units)} | ${integer(status.itemsWithProduct)} | ${integer(status.unitsWithProduct)} | ${money(status.paidAmount)} | ${money(status.refundedAmount)} | ${status.includedInBaseline ? 'sim' : 'não'} |`,
    ),
    '',
    '### Recomendação explícita para reembolsos',
    '',
    'Manter `REFUNDED` fora das unidades líquidas e manter `PARTIALLY_REFUNDED` fora do baseline até existir uma decisão de negócio ou dado de devolução por item. Para devolução parcial, as opções honestas são contar todas as unidades originais ou excluir o pedido inteiro; ratear unidades pelo valor reembolsado fabricaria uma quantidade. Recomenda-se persistir futuramente eventos/quantidades devolvidas por item e então calcular unidades líquidas.',
    '',
    '## Cobertura atual',
    '',
    '| Universo | Itens com Product | Itens sem Product | Cobertura de itens | Unidades com Product | Unidades sem Product | Cobertura do volume |',
    '|---|---:|---:|---:|---:|---:|---:|',
    coverageRow('Histórico persistido', report.historicalCoverage),
    coverageRow('Vendas válidas do baseline', report.validSalesCoverage),
    '',
    '## Resultado da Curva ABC',
    '',
    '| Classe | Products | Unidades | Participação real |',
    '|:---:|---:|---:|---:|',
    ...report.abcSummary.map((summary) =>
      `| ${summary.abcClass} | ${integer(summary.products)} | ${integer(summary.units)} | ${percent(summary.participationPercentage)} |`,
    ),
    '',
    'A participação real pode ultrapassar 80% em A ou 15% em B porque o Product que cruza o limite permanece inteiro na classe que ele fecha.',
    '',
    '## Top 20 Products por quantidade vendida',
    '',
    productTable(report.top20, report),
    '',
    '## Curva ABC completa',
    '',
    productTable(report.products, report),
    '',
    '## X1 — C1 × C2',
    '',
    'Inclui Products com identidade externa vigente nas duas BusinessAccounts, mesmo que uma conta tenha zero venda válida na janela. A diferença percentual é simétrica: `|C1-C2| / média(C1,C2)`, evitando escolher uma conta como base; quando ambas são zero, vale 0%.',
    '',
    '| SKU | Product | C1 | C2 | Dif. absoluta | Dif. percentual | Part. C1 | Part. C2 |',
    '|---|---|---:|---:|---:|---:|---:|---:|',
    ...report.c1C2Comparison.map((item) =>
      `| ${escapeCell(item.sku)} | ${escapeCell(item.name)} | ${integer(item.unitsC1)} | ${integer(item.unitsC2)} | ${integer(item.absoluteDifference)} | ${percent(item.percentageDifference)} | ${percent(item.participationC1)} | ${percent(item.participationC2)} |`,
    ),
    '',
    '## Decisão de arquitetura',
    '',
    '**Recomendação: C) híbrido.**',
    '',
    '- Manter o detalhe de pedidos como fonte de verdade e o cálculo on-demand para auditoria, cenários de refund e reprocessamentos.',
    '- Quando houver autorização para schema, materializar métricas incrementais por `businessDate × Product × BusinessAccount`, além de snapshots versionados da classificação. Não materializar apenas a letra A/B/C sem seus numeradores, denominadores, janela e regra.',
    '- Recalcular os deltas após cada sync de 10 minutos e fechar snapshots diários. Isso oferece baixa latência para dashboard, alertas, produtos sem giro e agentes de IA sem varrer pedidos detalhados a cada leitura.',
    '- Estoque por produto/depósito deve permanecer uma dimensão separada e ser combinado com velocidade de venda e dias sem venda na camada de leitura.',
    '- Toda resposta deve carregar `calculatedAt`, janela, cobertura e versão da regra, preservando auditabilidade para FULL Intelligence e para a Gabi.',
    '',
    'Nenhum agregado foi persistido e nenhum Product, identidade ou dado histórico foi alterado.',
    '',
  ];
  return lines.join('\n');
}

function productTable(
  products: ProductSalesAbcMetric[],
  report: ProductSalesAbcReport,
): string {
  return [
    '| # | Classe | SKU | Product | Unid. total | C1 | C2 | Pedidos pagos | % volume | % acumulado | Última venda | Dias sem venda |',
    '|---:|:---:|---|---|---:|---:|---:|---:|---:|---:|---|---:|',
    ...products.map((product, index) =>
      `| ${index + 1} | ${product.abcClass} | ${escapeCell(product.sku)} | ${escapeCell(product.name)} | ${integer(product.unitsSoldTotal)} | ${integer(product.unitsSoldC1)} | ${integer(product.unitsSoldC2)} | ${integer(product.paidOrders)} | ${percent(product.volumePercentage)} | ${percent(product.cumulativePercentage)} | ${product.lastSaleAt ? dateTime(product.lastSaleAt, report) : '—'} | ${product.daysWithoutSale ?? `≥ ${report.metadata.windowDays}`} |`,
    ),
  ].join('\n');
}

function coverageRow(
  label: string,
  coverage: ProductSalesAbcReport['historicalCoverage'],
): string {
  return `| ${label} (${integer(coverage.itemsTotal)} itens / ${integer(coverage.unitsTotal)} unid.) | ${integer(coverage.itemsWithProduct)} | ${integer(coverage.itemsWithoutProduct)} | ${percent(coverage.itemCoveragePercentage)} | ${integer(coverage.unitsWithProduct)} | ${integer(coverage.unitsWithoutProduct)} | ${percent(coverage.unitCoveragePercentage)} |`;
}

function dateTime(value: string, report: ProductSalesAbcReport): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: report.metadata.businessTimeZone,
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(value));
}

function integer(value: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(value);
}

function money(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function percent(value: number): string {
  return `${new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}%`;
}

function escapeCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}
