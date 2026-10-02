# Auditoria read-only — pareamento item a item dos 35 `POSSIBLE`

Data da auditoria: 2026-10-02 (America/Sao_Paulo)  
Escopo exclusivo: clusters `1125`, `1215` e `1230`  
Diagnóstico: `READ_ONLY`; persistência de negócio: desabilitada

## Resultado executivo

- `DETERMINISTIC_HIGH`: **29 candidatos**, **1.788 unidades recuperáveis**.
- `POSSIBLE`: **6 candidatos**, **33 unidades**. Cada um possui somente um pedido Olist correlacionado; o pareamento da linha nesse pedido é determinístico, mas falta o segundo pedido independente exigido para `HIGH`.
- `CONFLICT`: **0**.
- `NO_EVIDENCE`: **0**.
- Products necessários para os 29 `HIGH`: **6 novos** e **1 Product existente reutilizável**.
- Cobertura ABC potencial: **52,71%** (`3.538 / 6.712` unidades), contra **26,07%** (`1.750 / 6.712`); ganho potencial de **26,64 p.p.**.
- Os 11 `CONFLICT` da rodada anterior não foram carregados nem analisados.

## Regra e evidência usada

Para cada candidato foi percorrido o caminho `ML order/item -> Olist order -> linha Olist -> Olist product.id`:

1. somente pedidos ML persistidos com `normalizedStatus=PAID`;
2. correlação exata do `MarketplaceOrder.externalOrderId` com `numeroPedidoEcommerce` ou `numeroPedidoCanalVenda` da Olist;
3. validação do detalhe oficial do pedido Olist;
4. pareamento 1:1 das linhas usando apenas cardinalidade, IDs exatos, SKU dentro do mesmo pedido, quantidade, preço unitário e valor estendido;
5. classificação por candidato, sem usar título, similaridade textual ou SKU como identidade global.

Foram examinados **356 pedidos correlacionados**, todos com cardinalidade **1 linha ML e 1 linha Olist**. Logo, em todos os 356 casos existe uma única bijeção possível entre as linhas do mesmo pedido. Como corroboradores:

- o SKU coincidiu dentro do pedido em `351/356` pares;
- o valor estendido ML (`quantity × unitPrice`) reconciliou com o valor estendido Olist em até R$ 0,01 em `349/356` pares e em até R$ 0,05 nos outros `7/356`, diferença explicada pela multiplicação de preço unitário arredondado em kits;
- a quantidade foi igual em `64/356`; nos demais casos a Olist decompôs o kit em unidades, mas preservou o valor estendido;
- não houve linha concorrente, `product.id` divergente ou correlação incompatível.

`DETERMINISTIC_HIGH` foi atribuído somente quando o mesmo candidato teve pelo menos dois pedidos independentes, todos apontando para um único `Olist product.id`, sem divergência de correspondência. Pedidos ML sem pedido Olist já correlacionado não foram convertidos em evidência negativa.

## Products resultantes dos 29 `HIGH`

| Conta | Cluster | Olist `product.id` | Candidatos HIGH | Pedidos-evidência | Unidades recuperáveis | Resolução |
|---|---:|---:|---:|---:|---:|---|
| C1 | 1125 | `679464507` | 3 | 9 | 22 | Novo Product |
| C2 | 1125 | `842246393` | 1 | 6 | 141 | Novo Product |
| C1 | 1215 | `677122388` | 7 | 67 | 372 | Novo Product |
| C2 | 1215 | `842246599` | 7 | 128 | 638 | Novo Product |
| C2 | 1215 | `842246586` | 1 | 3 | 21 | Reutilizar Product `c51dc33f-2fbf-485b-b7f7-57f1c2813873` (`PRD-OLIST-C2-842246586`) |
| C1 | 1230 | `677091196` | 5 | 46 | 186 | Novo Product |
| C2 | 1230 | `842246660` | 5 | 91 | 408 | Novo Product |
| **Total** |  |  | **29** | **350** | **1.788** | **6 novos; 1 reutilizável** |

O `product.id=842246637` aparece apenas no candidato 34, com um único pedido correlacionado. Portanto, ele permanece fora dos Products recuperáveis nesta rodada.

## GTIN e equivalência C1 × C2

- O GET oficial Olist de `product.id=842246599` retornou o GTIN-13 válido `7908163135702`.
- Os GETs oficiais autenticados do Mercado Livre retornaram `17055161` para 31 dos 35 candidatos, atravessando os três clusters e vários `Olist product.id` distintos. Embora o dígito verificador seja formalmente válido, o valor é não discriminante neste conjunto e foi rejeitado como prova de identidade.
- Quatro candidatos ML não retornaram GTIN. Nenhum `catalog_product_id` comum foi encontrado; os `user_product_id` são distintos.
- Consequência: **nenhuma equivalência C1 × C2 foi comprovada**. Os pares C1/C2 dos clusters 1125, 1215 e 1230 permanecem separados. O GTIN Olist `7908163135702` é evidência do produto Olist C2, não prova cross-account.

Foram feitos 24 GETs oficiais autenticados de listings ML, todos HTTP 200. Os detalhes de pedido e de produto Olist usados foram obtidos por GET oficial na coleta read-only imediatamente anterior desta mesma rodada.

## Classificação item a item

Na coluna “Pedidos/unidades”, pedidos significa a quantidade total de pedidos ML `PAID` já conhecida para o candidato. “Correl.” é a quantidade desses pedidos que já possuía correlação exata com um pedido Olist e pôde fornecer evidência item a item.

| # | Cluster | Conta | ML listing / sellable | Pedidos / unidades | Correl. | Olist `product.id` | Corroboração nos pedidos correlacionados | Classificação |
|---:|---:|---|---|---:|---:|---:|---|---|
| 1 | 1125 | C1 | `MLB2210019493` / `174647488996` | 3 / 3 | 2 | `679464507` | SKU 2/2; total ≤R$0,01 2/2 | `DETERMINISTIC_HIGH` |
| 2 | 1125 | C1 | `MLB2778675842` / `175142104664` | 9 / 9 | 4 | `679464507` | SKU 4/4; total ≤R$0,01 4/4 | `DETERMINISTIC_HIGH` |
| 3 | 1125 | C1 | `MLB5504840826` / `193434526173` | 10 / 10 | 3 | `679464507` | SKU 3/3; total ≤R$0,01 3/3 | `DETERMINISTIC_HIGH` |
| 4 | 1125 | C2 | `MLB3665300400` / `177799568754` | 141 / 141 | 6 | `842246393` | SKU 6/6; total ≤R$0,01 6/6 | `DETERMINISTIC_HIGH` |
| 5 | 1125 | C2 | `MLB3669090262` / `178399931679` | 6 / 6 | 1 | `842246393` | SKU 1/1; total ≤R$0,01 1/1 | `POSSIBLE` |
| 6 | 1215 | C1 | `MLB2094107160` / `193468166241` | 6 / 6 | 1 | `677122388` | SKU 1/1; total ≤R$0,01 1/1 | `POSSIBLE` |
| 7 | 1215 | C1 | `MLB2130828532` / `MLB2130828532` | 12 / 12 | 2 | `677122388` | SKU 2/2; total ≤R$0,01 2/2 | `DETERMINISTIC_HIGH` |
| 8 | 1215 | C1 | `MLB2664652190` / `175165239114` | 14 / 14 | 6 | `677122388` | SKU 6/6; total ≤R$0,01 5/6; ≤R$0,05 1/6 | `DETERMINISTIC_HIGH` |
| 9 | 1215 | C1 | `MLB2678800289` / `174644413422` | 7 / 7 | 2 | `677122388` | SKU 2/2; total ≤R$0,05 2/2 | `DETERMINISTIC_HIGH` |
| 10 | 1215 | C1 | `MLB2848992191` / `175468680481` | 158 / 158 | 41 | `677122388` | SKU 41/41; total ≤R$0,01 41/41 | `DETERMINISTIC_HIGH` |
| 11 | 1215 | C1 | `MLB3261751171` / `177126001118` | 47 / 47 | 5 | `677122388` | SKU 5/5; total ≤R$0,01 5/5 | `DETERMINISTIC_HIGH` |
| 12 | 1215 | C1 | `MLB3418583437` / `179536853393` | 128 / 128 | 9 | `677122388` | SKU 9/9; total ≤R$0,01 9/9 | `DETERMINISTIC_HIGH` |
| 13 | 1215 | C1 | `MLB3953957213` / `186754185215` | 6 / 6 | 2 | `677122388` | SKU 2/2; total ≤R$0,01 2/2 | `DETERMINISTIC_HIGH` |
| 14 | 1215 | C2 | `MLB3321645337` / `178284046363` | 375 / 375 | 72 | `842246599` | SKU 72/72; total ≤R$0,01 72/72 | `DETERMINISTIC_HIGH` |
| 15 | 1215 | C2 | `MLB3321655271` / `178283866805` | 82 / 82 | 16 | `842246599` | SKU 16/16; total ≤R$0,01 16/16 | `DETERMINISTIC_HIGH` |
| 16 | 1215 | C2 | `MLB3321657105` / `177745935994` | 24 / 24 | 5 | `842246599` | SKU 5/5; total ≤R$0,01 5/5 | `DETERMINISTIC_HIGH` |
| 17 | 1215 | C2 | `MLB3321707639` / `177746065024` | 103 / 103 | 21 | `842246599` | SKU 21/21; total ≤R$0,01 21/21 | `DETERMINISTIC_HIGH` |
| 18 | 1215 | C2 | `MLB3321732553` / `178284123195` | 36 / 36 | 8 | `842246599` | SKU 8/8; total ≤R$0,01 8/8 | `DETERMINISTIC_HIGH` |
| 19 | 1215 | C2 | `MLB3365860779` / `178128514150` | 2 / 3 | 1 | `842246586` | SKU 0/1; total ≤R$0,01 1/1 | `POSSIBLE` |
| 20 | 1215 | C2 | `MLB3645347742` / `177746035406` | 7 / 7 | 3 | `842246599` | SKU 3/3; total ≤R$0,01 3/3 | `DETERMINISTIC_HIGH` |
| 21 | 1215 | C2 | `MLB3709682658` / `180829558901` | 11 / 11 | 3 | `842246599` | SKU 3/3; total ≤R$0,05 3/3 | `DETERMINISTIC_HIGH` |
| 22 | 1215 | C2 | `MLB3769848722` / `178888463983` | 11 / 21 | 3 | `842246586` | SKU 0/3; total ≤R$0,01 3/3 | `DETERMINISTIC_HIGH` |
| 23 | 1230 | C1 | `MLB2094107160` / `174637197649` | 10 / 10 | 1 | `677091196` | SKU 1/1; total ≤R$0,01 1/1 | `POSSIBLE` |
| 24 | 1230 | C1 | `MLB2664652190` / `175165239115` | 10 / 10 | 2 | `677091196` | SKU 2/2; total ≤R$0,01 1/2; ≤R$0,05 1/2 | `DETERMINISTIC_HIGH` |
| 25 | 1230 | C1 | `MLB2848992191` / `175468680482` | 86 / 86 | 24 | `677091196` | SKU 24/24; total ≤R$0,01 24/24 | `DETERMINISTIC_HIGH` |
| 26 | 1230 | C1 | `MLB3261751171` / `178562834397` | 14 / 14 | 6 | `677091196` | SKU 6/6; total ≤R$0,01 6/6 | `DETERMINISTIC_HIGH` |
| 27 | 1230 | C1 | `MLB3418583437` / `179536853395` | 56 / 56 | 12 | `677091196` | SKU 12/12; total ≤R$0,01 12/12 | `DETERMINISTIC_HIGH` |
| 28 | 1230 | C1 | `MLB4134836307` / `MLB4134836307` | 20 / 20 | 2 | `677091196` | SKU 2/2; total ≤R$0,01 2/2 | `DETERMINISTIC_HIGH` |
| 29 | 1230 | C2 | `MLB3321645337` / `178284046365` | 278 / 278 | 61 | `842246660` | SKU 61/61; total ≤R$0,01 61/61 | `DETERMINISTIC_HIGH` |
| 30 | 1230 | C2 | `MLB3321655271` / `178283866807` | 69 / 70 | 13 | `842246660` | SKU 13/13; total ≤R$0,01 13/13 | `DETERMINISTIC_HIGH` |
| 31 | 1230 | C2 | `MLB3321657105` / `177745935996` | 12 / 12 | 2 | `842246660` | SKU 2/2; total ≤R$0,01 2/2 | `DETERMINISTIC_HIGH` |
| 32 | 1230 | C2 | `MLB3321707639` / `177746065026` | 39 / 39 | 10 | `842246660` | SKU 10/10; total ≤R$0,01 10/10 | `DETERMINISTIC_HIGH` |
| 33 | 1230 | C2 | `MLB3321732553` / `178284123197` | 9 / 9 | 5 | `842246660` | SKU 5/5; total ≤R$0,01 5/5 | `DETERMINISTIC_HIGH` |
| 34 | 1230 | C2 | `MLB3645312384` / `178284342471` | 2 / 2 | 1 | `842246637` | SKU 0/1; total ≤R$0,01 1/1 | `POSSIBLE` |
| 35 | 1230 | C2 | `MLB3645347742` / `177746035408` | 6 / 6 | 1 | `842246660` | SKU 1/1; total ≤R$0,01 1/1 | `POSSIBLE` |

## Integridade e encerramento

A leitura do banco ocorreu dentro de transação PostgreSQL explícita com `transaction_read_only=on`. As contagens no início e no fim da transação foram idênticas:

- `Product=124`
- `Identities=262`
- `Listings ligados=132`
- `Pedidos=6142`
- `Writes=0`

Não foram criados Product, identidade ou link; não houve backfill, alteração de schema/migration, commit ou push. Nenhum plano de materialização foi criado.
