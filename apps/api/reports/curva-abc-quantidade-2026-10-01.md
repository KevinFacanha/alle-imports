# Curva ABC por quantidade vendida — pós-expansão read-only

Gerado em 01/10/2026, 15:15:58.

> Escopo: somente os 124 Products materializados com confiança HIGH. Itens sem Product não entram no denominador da Curva ABC; seu impacto aparece em Cobertura.

## Resumo executivo

- Janela móvel: 30 dias, de 29/08/2026, 23:31:20 até 28/09/2026, 23:31:20.
- Dados persistidos: de 30/08/2026, 00:26:10 até 28/09/2026, 23:31:20.
- Venda válida no baseline: somente status `PAID`.
- Pedidos pagos: 5.497; unidades pagas: 6.712.
- Pedidos pagos cobertos: 1.163; unidades pagas cobertas: 1.750.
- Escritas no banco: 0.
- **CURVA ABC PÓS-EXPANSÃO: APROVADA.**
- Conexão validada dentro de transação com `transaction_read_only=on`; contagens antes e depois permaneceram idênticas.
- Cobertura de volume: **26,07%** (1.750 / 6.712), ganho de **1,41 p.p.** e **95 unidades** versus o baseline anterior.

## Regra aplicada

- Incluído: `PAID`.
- Excluídos do baseline: `CANCELLED`, `PENDING`, `PROCESSING`, `UNKNOWN`, `REFUNDED` e `PARTIALLY_REFUNDED`.
- `REFUNDED` e `PARTIALLY_REFUNDED` ficam separados no impacto por status. Não houve rateio de unidades por valor reembolsado.
- Ordenação: `unitsSoldTotal DESC`, depois `sku ASC` e `productId ASC`, garantindo desempate determinístico.
- Cruzamento dos limites: a classe é definida pelo acumulado antes de adicionar o Product. Assim, o Product que alcança ou ultrapassa 80% fecha A; o que alcança ou ultrapassa 95% fecha B. O Product não é fracionado.
- Product sem venda válida na janela tem `lastSaleAt = null` e dias sem venda exibidos como `≥ 30`; não se inventa uma data anterior à janela observada.

## Auditoria dos relacionamentos

`MarketplaceOrderItem → MarketplaceOrder → MarketplaceAccount → BusinessAccount` fornece status, `soldAt` e C1/C2. `MarketplaceOrderItem.quantity` fornece as unidades. O Product é resolvido por `MarketplaceOrderItem.productId` e, quando nulo, por `MarketplaceOrderItem.marketplaceListingItemId → MarketplaceListingItem.productId`.

| Caminho | Itens na janela |
|---|---:|
| Product direto no order item | 0 |
| Product via listing item | 1.270 |
| Sem Product | 4.872 |
| Conflito entre os dois caminhos | 0 |

## Impacto por status

| Status | Pedidos | Itens | Unidades | Itens com Product | Unidades com Product | Pago (R$) | Reembolsado (R$) | Baseline |
|---|---:|---:|---:|---:|---:|---:|---:|:---:|
| PAID | 5.497 | 5.497 | 6.712 | 1.163 | 1.750 | 641.355,40 | 0,00 | sim |
| CANCELLED | 638 | 638 | 725 | 105 | 146 | 0,00 | 63.770,86 | não |
| PARTIALLY_REFUNDED | 7 | 7 | 11 | 2 | 3 | 534,74 | 419,04 | não |

### Recomendação explícita para reembolsos

Manter `REFUNDED` fora das unidades líquidas e manter `PARTIALLY_REFUNDED` fora do baseline até existir uma decisão de negócio ou dado de devolução por item. Para devolução parcial, as opções honestas são contar todas as unidades originais ou excluir o pedido inteiro; ratear unidades pelo valor reembolsado fabricaria uma quantidade. Recomenda-se persistir futuramente eventos/quantidades devolvidas por item e então calcular unidades líquidas.

## Cobertura atual

| Universo | Itens com Product | Itens sem Product | Cobertura de itens | Unidades com Product | Unidades sem Product | Cobertura do volume |
|---|---:|---:|---:|---:|---:|---:|
| Histórico persistido (6.142 itens / 7.448 unid.) | 1.270 | 4.872 | 20,68% | 1.899 | 5.549 | 25,50% |
| Vendas válidas do baseline (5.497 itens / 6.712 unid.) | 1.163 | 4.334 | 21,16% | 1.750 | 4.962 | 26,07% |

## Resultado da Curva ABC

| Classe | Products | Unidades | Participação real |
|:---:|---:|---:|---:|
| A | 24 | 1.402 | 80,11% |
| B | 31 | 262 | 14,97% |
| C | 69 | 86 | 4,91% |

A participação real pode ultrapassar 80% em A ou 15% em B porque o Product que cruza o limite permanece inteiro na classe que ele fecha.

## Comparação antes × depois

| Métrica | Antes | Depois | Delta |
|---|---:|---:|---:|
| Products materializados | 110 | 124 | +14 |
| Listings vinculados | 116 | 132 | +16 |
| Unidades PAID cobertas | 1.655 | 1.750 | +95 |
| Cobertura de unidades PAID | 24,66% | 26,07% | +1,41 p.p. |
| Order items PAID cobertos | 1.115 | 1.163 | +48 |

Os 14 novos Products respondem por 82 unidades cobertas (C1=25; C2=57). Os outros 2 vínculos reutilizaram Products existentes e acrescentaram 13 unidades: `PRD-OLIST-C1-784612526` ganhou 6 (96 → 102) e `PRD-OLIST-C1-784614178` ganhou 7 (7 → 14).

### Classes dos 14 novos Products

| SKU | Classe | Unidades | C1 | C2 | Pedidos PAID |
|---|:---:|---:|---:|---:|---:|
| PRD-OLIST-C2-842248625 | B | 15 | 0 | 15 | 4 |
| PRD-OLIST-C1-690597060 | B | 12 | 12 | 0 | 5 |
| PRD-OLIST-C1-1029253002 | B | 8 | 8 | 0 | 4 |
| PRD-OLIST-C2-842238988 | B | 7 | 0 | 7 | 5 |
| PRD-OLIST-C2-842248271 | B | 6 | 0 | 6 | 3 |
| PRD-OLIST-C2-872841915 | B | 6 | 0 | 6 | 2 |
| PRD-OLIST-C1-1039495705 | B | 5 | 5 | 0 | 3 |
| PRD-OLIST-C2-842248600 | B | 5 | 0 | 5 | 3 |
| PRD-OLIST-C2-869617096 | B | 5 | 0 | 5 | 3 |
| PRD-OLIST-C2-842240951 | C | 4 | 0 | 4 | 2 |
| PRD-OLIST-C2-842248690 | C | 3 | 0 | 3 | 2 |
| PRD-OLIST-C2-842238995 | C | 2 | 0 | 2 | 2 |
| PRD-OLIST-C2-842248654 | C | 2 | 0 | 2 | 2 |
| PRD-OLIST-C2-842248678 | C | 2 | 0 | 2 | 2 |
| **Total** | **B=9; C=5** | **82** | **25** | **57** | — |

Nenhum Product novo entrou em A.

### Products anteriores que mudaram de classe

| SKU | Antes | Depois | Unidades atuais |
|---|:---:|:---:|---:|
| PRD-OLIST-C1-1029252881 | B | A | 17 |
| PRD-OLIST-C1-827866126 | B | A | 17 |
| PRD-OLIST-C2-842241631 | B | A | 17 |
| PRD-GTIN-7891709197282 | B | A | 16 |
| PRD-OLIST-C2-842246824 | C | B | 5 |

As mudanças decorrem do novo denominador e dos novos pontos de corte acumulados; não houve redução de unidades nesses Products.

## Top 20 Products por quantidade vendida

| # | Classe | SKU | Product | Unid. total | C1 | C2 | Pedidos pagos | % volume | % acumulado | Última venda | Dias sem venda |
|---:|:---:|---|---|---:|---:|---:|---:|---:|---:|---|---:|
| 1 | A | PRD-OLIST-C1-1038460583 | Fita Led 20w/m Cob Ligação Direta - 10m  320leds/m | 271 | 271 | 0 | 146 | 15,49% | 15,49% | 28/09/2026, 21:12:06 | 0 |
| 2 | A | PRD-OLIST-C1-1041363804 | Fita Led 20w/m Cob Ligação Direta - 10m  320leds/m | 200 | 200 | 0 | 112 | 11,43% | 26,91% | 28/09/2026, 21:13:05 | 0 |
| 3 | A | PRD-OLIST-C1-784612526 | Fita Led Cob Profissional 5w/m - 5 Metros 12v 500 Lumens/m | 102 | 102 | 0 | 38 | 5,83% | 32,74% | 28/09/2026, 17:14:07 | 0 |
| 4 | A | PRD-OLIST-C2-842246436 | Perfil Embutido 24mm Aluminio Para Fita Led 2 Metros | 89 | 0 | 89 | 89 | 5,09% | 37,83% | 28/09/2026, 14:26:01 | 0 |
| 5 | A | PRD-OLIST-C2-842246637 | Perfil 17mm Sobrepor Aluminio Para Fita Led 1 Metro | 79 | 0 | 79 | 23 | 4,51% | 42,34% | 28/09/2026, 20:05:19 | 0 |
| 6 | A | PRD-OLIST-C1-786398542 | Perfil Sobrepor 20mm Aluminio Para Fita Led 2 Metros | 78 | 78 | 0 | 78 | 4,46% | 46,80% | 24/09/2026, 21:16:16 | 4 |
| 7 | A | PRD-OLIST-C1-1041363799 | Fita Led 20w/m Cob Ligação Direta - 10m  320leds/m | 70 | 70 | 0 | 35 | 4,00% | 50,80% | 28/09/2026, 21:13:05 | 0 |
| 8 | A | PRD-OLIST-C2-842247808 | Perfil Sobrepor 30x20mm Aluminio Para Fita Led 2 Metros | 64 | 0 | 64 | 64 | 3,66% | 54,46% | 28/09/2026, 14:44:32 | 0 |
| 9 | A | PRD-OLIST-C2-842246741 | Perfil De Canto Sobrepor 45º P/ Led 2 Metros 16x16mm | 50 | 0 | 50 | 50 | 2,86% | 57,31% | 28/09/2026, 18:22:24 | 0 |
| 10 | A | PRD-OLIST-C2-842246586 | Perfil 17mm Sobrepor Aluminio Para Fita Led 1 Metro | 47 | 0 | 47 | 17 | 2,69% | 60,00% | 24/09/2026, 16:46:23 | 4 |
| 11 | A | PRD-OLIST-C1-1010970483 | Fonte Slim Palito 2,5a 60w 24v Gaya Para Fita Led/cftv | 46 | 46 | 0 | 25 | 2,63% | 62,63% | 28/09/2026, 16:49:05 | 0 |
| 12 | A | PRD-OLIST-C1-806658634 | Perfil Sobrepor 20mm Aluminio Para Fita Led 2 Metros | 41 | 41 | 0 | 41 | 2,34% | 64,97% | 21/09/2026, 12:55:53 | 7 |
| 13 | A | PRD-OLIST-C1-1041363810 | Fita Led 20w/m Cob Ligação Direta - 10m  320leds/m | 39 | 39 | 0 | 17 | 2,23% | 67,20% | 28/09/2026, 12:22:57 | 0 |
| 14 | A | PRD-OLIST-C1-682144170 | Perfil De Canto Sobrepor 45º P/ Led 2 Metros 16x16mm | 28 | 28 | 0 | 28 | 1,60% | 68,80% | 24/09/2026, 11:47:28 | 4 |
| 15 | A | PRD-OLIST-C1-851973724 | Perfil Embutido 15mm Aluminio Para Fita De Led 2 Metros Perfil Branco | 27 | 27 | 0 | 27 | 1,54% | 70,34% | 22/09/2026, 14:21:42 | 6 |
| 16 | A | PRD-OLIST-C1-1034314147 | Perfil Sobrepor 17mm Gold Dourado Para Fita Led 2 Metros Perfil Gold - | 22 | 22 | 0 | 9 | 1,26% | 71,60% | 23/09/2026, 14:29:18 | 5 |
| 17 | A | PRD-OLIST-C2-869281972 | Perfil No Frame Embutido Sem Bordas 15x15mm 2 Metros | 22 | 0 | 22 | 22 | 1,26% | 72,86% | 26/09/2026, 19:37:07 | 2 |
| 18 | A | PRD-OLIST-C2-842241657 | Fita Led 20w/m - 5 Metros 2000lumens 240 Leds/m | 21 | 0 | 21 | 11 | 1,20% | 74,06% | 22/09/2026, 17:40:57 | 6 |
| 19 | A | PRD-OLIST-C2-842242671 | Fita Led Cob 5w/m - 5 Metros 500 Lumens 12v | 21 | 0 | 21 | 14 | 1,20% | 75,26% | 28/09/2026, 20:04:57 | 0 |
| 20 | A | PRD-OLIST-C2-842247866 | Perfil Sobrepor 30x20mm Aluminio Para Fita Led 2 Metros | 18 | 0 | 18 | 18 | 1,03% | 76,29% | 27/09/2026, 17:56:02 | 1 |

## Curva ABC completa

| # | Classe | SKU | Product | Unid. total | C1 | C2 | Pedidos pagos | % volume | % acumulado | Última venda | Dias sem venda |
|---:|:---:|---|---|---:|---:|---:|---:|---:|---:|---|---:|
| 1 | A | PRD-OLIST-C1-1038460583 | Fita Led 20w/m Cob Ligação Direta - 10m  320leds/m | 271 | 271 | 0 | 146 | 15,49% | 15,49% | 28/09/2026, 21:12:06 | 0 |
| 2 | A | PRD-OLIST-C1-1041363804 | Fita Led 20w/m Cob Ligação Direta - 10m  320leds/m | 200 | 200 | 0 | 112 | 11,43% | 26,91% | 28/09/2026, 21:13:05 | 0 |
| 3 | A | PRD-OLIST-C1-784612526 | Fita Led Cob Profissional 5w/m - 5 Metros 12v 500 Lumens/m | 102 | 102 | 0 | 38 | 5,83% | 32,74% | 28/09/2026, 17:14:07 | 0 |
| 4 | A | PRD-OLIST-C2-842246436 | Perfil Embutido 24mm Aluminio Para Fita Led 2 Metros | 89 | 0 | 89 | 89 | 5,09% | 37,83% | 28/09/2026, 14:26:01 | 0 |
| 5 | A | PRD-OLIST-C2-842246637 | Perfil 17mm Sobrepor Aluminio Para Fita Led 1 Metro | 79 | 0 | 79 | 23 | 4,51% | 42,34% | 28/09/2026, 20:05:19 | 0 |
| 6 | A | PRD-OLIST-C1-786398542 | Perfil Sobrepor 20mm Aluminio Para Fita Led 2 Metros | 78 | 78 | 0 | 78 | 4,46% | 46,80% | 24/09/2026, 21:16:16 | 4 |
| 7 | A | PRD-OLIST-C1-1041363799 | Fita Led 20w/m Cob Ligação Direta - 10m  320leds/m | 70 | 70 | 0 | 35 | 4,00% | 50,80% | 28/09/2026, 21:13:05 | 0 |
| 8 | A | PRD-OLIST-C2-842247808 | Perfil Sobrepor 30x20mm Aluminio Para Fita Led 2 Metros | 64 | 0 | 64 | 64 | 3,66% | 54,46% | 28/09/2026, 14:44:32 | 0 |
| 9 | A | PRD-OLIST-C2-842246741 | Perfil De Canto Sobrepor 45º P/ Led 2 Metros 16x16mm | 50 | 0 | 50 | 50 | 2,86% | 57,31% | 28/09/2026, 18:22:24 | 0 |
| 10 | A | PRD-OLIST-C2-842246586 | Perfil 17mm Sobrepor Aluminio Para Fita Led 1 Metro | 47 | 0 | 47 | 17 | 2,69% | 60,00% | 24/09/2026, 16:46:23 | 4 |
| 11 | A | PRD-OLIST-C1-1010970483 | Fonte Slim Palito 2,5a 60w 24v Gaya Para Fita Led/cftv | 46 | 46 | 0 | 25 | 2,63% | 62,63% | 28/09/2026, 16:49:05 | 0 |
| 12 | A | PRD-OLIST-C1-806658634 | Perfil Sobrepor 20mm Aluminio Para Fita Led 2 Metros | 41 | 41 | 0 | 41 | 2,34% | 64,97% | 21/09/2026, 12:55:53 | 7 |
| 13 | A | PRD-OLIST-C1-1041363810 | Fita Led 20w/m Cob Ligação Direta - 10m  320leds/m | 39 | 39 | 0 | 17 | 2,23% | 67,20% | 28/09/2026, 12:22:57 | 0 |
| 14 | A | PRD-OLIST-C1-682144170 | Perfil De Canto Sobrepor 45º P/ Led 2 Metros 16x16mm | 28 | 28 | 0 | 28 | 1,60% | 68,80% | 24/09/2026, 11:47:28 | 4 |
| 15 | A | PRD-OLIST-C1-851973724 | Perfil Embutido 15mm Aluminio Para Fita De Led 2 Metros Perfil Branco | 27 | 27 | 0 | 27 | 1,54% | 70,34% | 22/09/2026, 14:21:42 | 6 |
| 16 | A | PRD-OLIST-C1-1034314147 | Perfil Sobrepor 17mm Gold Dourado Para Fita Led 2 Metros Perfil Gold - | 22 | 22 | 0 | 9 | 1,26% | 71,60% | 23/09/2026, 14:29:18 | 5 |
| 17 | A | PRD-OLIST-C2-869281972 | Perfil No Frame Embutido Sem Bordas 15x15mm 2 Metros | 22 | 0 | 22 | 22 | 1,26% | 72,86% | 26/09/2026, 19:37:07 | 2 |
| 18 | A | PRD-OLIST-C2-842241657 | Fita Led 20w/m - 5 Metros 2000lumens 240 Leds/m | 21 | 0 | 21 | 11 | 1,20% | 74,06% | 22/09/2026, 17:40:57 | 6 |
| 19 | A | PRD-OLIST-C2-842242671 | Fita Led Cob 5w/m - 5 Metros 500 Lumens 12v | 21 | 0 | 21 | 14 | 1,20% | 75,26% | 28/09/2026, 20:04:57 | 0 |
| 20 | A | PRD-OLIST-C2-842247866 | Perfil Sobrepor 30x20mm Aluminio Para Fita Led 2 Metros | 18 | 0 | 18 | 18 | 1,03% | 76,29% | 27/09/2026, 17:56:02 | 1 |
| 21 | A | PRD-OLIST-C1-1029252881 | Sensor De Led Marcenaria Uma Porta 12v/24v Sensi Gaya | 17 | 17 | 0 | 6 | 0,97% | 77,26% | 21/09/2026, 16:30:10 | 7 |
| 22 | A | PRD-OLIST-C1-827866126 | Fita Led 20w/m - 5 Metros 2000lumens 240 Leds/m | 17 | 17 | 0 | 9 | 0,97% | 78,23% | 28/09/2026, 14:10:17 | 0 |
| 23 | A | PRD-OLIST-C2-842241631 | Fita Led 20w/m - 5 Metros 2000lumens 240 Leds/m | 17 | 0 | 17 | 13 | 0,97% | 79,20% | 26/09/2026, 00:52:55 | 2 |
| 24 | A | PRD-GTIN-7891709197282 | Cobertor Manta Neo Velour 300g Macia Premium Aveludada | 16 | 16 | 0 | 16 | 0,91% | 80,11% | 24/09/2026, 12:14:13 | 4 |
| 25 | B | PRD-OLIST-C2-842309753 | Perfil Sobrepor Alumínio 17mm Fita Led 1,5m Com Difusor Perfil Preto | 16 | 0 | 16 | 14 | 0,91% | 81,03% | 28/09/2026, 22:31:03 | 0 |
| 26 | B | PRD-OLIST-C1-1030886443 | Perfil Sobrepor Alumínio 17mm Fita Led 1,5m Com Difusor Perfil Branco | 15 | 15 | 0 | 15 | 0,86% | 81,89% | 24/09/2026, 16:46:27 | 4 |
| 27 | B | PRD-OLIST-C2-842248625 | Sensor De Movimento P Led Marcenaria 12v/24v Sensi Gaya | 15 | 0 | 15 | 4 | 0,86% | 82,74% | 24/09/2026, 09:37:09 | 4 |
| 28 | B | PRD-OLIST-C1-784614178 | Fita Led Cob Profissional 5w/m - 5 Metros 12v 500 Lumens/m | 14 | 14 | 0 | 9 | 0,80% | 83,54% | 24/09/2026, 09:31:27 | 4 |
| 29 | B | PRD-GTIN-7899097914740 | Fonte Chaveada Slim 5a 100w 24v Gaya Led/cftv | 13 | 0 | 13 | 8 | 0,74% | 84,29% | 28/09/2026, 09:15:40 | 0 |
| 30 | B | PRD-OLIST-C1-1039299469 | Cobertor Manta Neo Velour 300g Macia Premium Aveludada | 13 | 13 | 0 | 13 | 0,74% | 85,03% | 20/09/2026, 21:07:54 | 8 |
| 31 | B | PRD-OLIST-C1-1030886474 | Perfil Sobrepor Alumínio 17mm Fita Led 1,5m Com Difusor Perfil Preto | 12 | 12 | 0 | 12 | 0,69% | 85,71% | 27/09/2026, 23:45:11 | 1 |
| 32 | B | PRD-OLIST-C1-690597060 | Perfil De Embutir 24mm  Aluminio Para Fita De Led 1 Metro Br Branco | 12 | 12 | 0 | 5 | 0,69% | 86,40% | 23/09/2026, 12:34:41 | 5 |
| 33 | B | PRD-OLIST-C1-1032999957 | Kit Par Cabo De Aço Pendente Para Perfil De Led Sobrepor 2m . - | 10 | 10 | 0 | 3 | 0,57% | 86,97% | 14/09/2026, 10:20:59 | 14 |
| 34 | B | PRD-OLIST-C1-1041363794 | Fita Led 20w/m Cob Ligação Direta - 10m  320leds/m | 9 | 9 | 0 | 7 | 0,51% | 87,49% | 17/09/2026, 16:17:18 | 11 |
| 35 | B | PRD-OLIST-C1-682170128 | Kit Perfil Sobrepor 50x20mm Aluminio Para Fita Led 2 Metros | 9 | 9 | 0 | 9 | 0,51% | 88,00% | 22/09/2026, 11:01:36 | 6 |
| 36 | B | PRD-OLIST-C1-1029253002 | Sensor De Led Marcenaria Duas Portas 12v/24v Sensi Gaya | 8 | 8 | 0 | 4 | 0,46% | 88,46% | 19/09/2026, 16:12:54 | 9 |
| 37 | B | PRD-OLIST-C1-1038991287 | Interruptor Bolinha Gota De Embutir Em Moveis | 8 | 8 | 0 | 3 | 0,46% | 88,91% | 28/09/2026, 15:29:39 | 0 |
| 38 | B | PRD-OLIST-C2-842245891 | Perfil Embutido 30x20mm Aluminio Para Fita Led 2 Metros | 8 | 0 | 8 | 8 | 0,46% | 89,37% | 23/09/2026, 13:40:24 | 5 |
| 39 | B | PRD-OLIST-C1-1032082910 | Fita Led 20w/m Ligação Direta - 10m 2000lumens 240 Leds/m | 7 | 7 | 0 | 7 | 0,40% | 89,77% | 27/09/2026, 11:13:41 | 1 |
| 40 | B | PRD-OLIST-C1-1032082921 | Fita Led 20w/m Ligação Direta - 10m 2000lumens 240 Leds/m | 7 | 7 | 0 | 4 | 0,40% | 90,17% | 19/09/2026, 11:28:46 | 9 |
| 41 | B | PRD-OLIST-C2-842238988 | Kit 10 Pçs De Acabamento Para Perfil Slim Sobrepor 17x7mm | 7 | 0 | 7 | 5 | 0,40% | 90,57% | 28/09/2026, 09:36:41 | 0 |
| 42 | B | PRD-OLIST-C2-872313214 | 10m Fita Led Cob 12w/m 320leds Luz Contínua Premium - 24v | 7 | 0 | 7 | 5 | 0,40% | 90,97% | 28/09/2026, 09:31:53 | 0 |
| 43 | B | PRD-OLIST-C2-873891191 | Luminária Led Sobrepor Slim 20w 1 Metro 127v/220v | 7 | 0 | 7 | 5 | 0,40% | 91,37% | 24/09/2026, 20:29:18 | 4 |
| 44 | B | PRD-OLIST-C1-983077421 | Perfil Embutido 20x10mm Para Fita Led 2 Metros | 6 | 6 | 0 | 6 | 0,34% | 91,71% | 11/09/2026, 16:23:01 | 17 |
| 45 | B | PRD-OLIST-C2-842240814 | Driver Sistema Sensi Sensores P Marcenaria 60w 5a 12v Gaya | 6 | 0 | 6 | 4 | 0,34% | 92,06% | 26/09/2026, 18:58:26 | 2 |
| 46 | B | PRD-OLIST-C2-842248271 | Kit 10 Emendas P/ Fita Led 3528 Com Rabicho P4 Femea S/c | 6 | 0 | 6 | 3 | 0,34% | 92,40% | 23/09/2026, 14:15:12 | 5 |
| 47 | B | PRD-OLIST-C2-842309049 | Perfil Sobrepor Alumínio 17mm Fita Led 1,5m Com Difusor Perfil Branco | 6 | 0 | 6 | 4 | 0,34% | 92,74% | 26/09/2026, 16:30:31 | 2 |
| 48 | B | PRD-OLIST-C2-872841915 | Fita Led Neon Flex 5m 12v Ip65 Silicone Decorativa Dourado 12v | 6 | 0 | 6 | 2 | 0,34% | 93,09% | 14/09/2026, 10:28:48 | 14 |
| 49 | B | PRD-OLIST-C1-1039495705 | Sensor Touch Dimerizável Led Marcenaria Sensi Ellegance Gaya Controle Central 12v-24v | 5 | 5 | 0 | 3 | 0,29% | 93,37% | 14/09/2026, 15:18:12 | 14 |
| 50 | B | PRD-OLIST-C1-1044911343 | Arandela Led Meia Lua 6 Fachos 6w Branco Quente Ip65 Bivolt 127v/220v Preto | 5 | 5 | 0 | 4 | 0,29% | 93,66% | 28/09/2026, 15:48:45 | 0 |
| 51 | B | PRD-OLIST-C2-842241675 | Fita Led 20w/m - 5 Metros 2000lumens 240 Leds/m | 5 | 0 | 5 | 3 | 0,29% | 93,94% | 18/09/2026, 10:34:01 | 10 |
| 52 | B | PRD-OLIST-C2-842244330 | Fonte Slim Palito 2,5a 60w 24v Gaya Para Fita Led/cftv | 5 | 0 | 5 | 4 | 0,29% | 94,23% | 24/09/2026, 19:24:48 | 4 |
| 53 | B | PRD-OLIST-C2-842246824 | Perfil Sobrepor 20mm Aluminio Para Fita Led 2 Metros | 5 | 0 | 5 | 5 | 0,29% | 94,51% | 26/09/2026, 21:23:53 | 2 |
| 54 | B | PRD-OLIST-C2-842248600 | Sensor De Aproximação P Led Marcenaria 12v/24v Sensi Gaya | 5 | 0 | 5 | 3 | 0,29% | 94,80% | 17/09/2026, 15:13:22 | 11 |
| 55 | B | PRD-OLIST-C2-869617096 | Sensor Touch Invisível Dimerizavel Marcenaria Sensi  Gaya | 5 | 0 | 5 | 3 | 0,29% | 95,09% | 25/09/2026, 11:52:43 | 3 |
| 56 | C | PRD-OLIST-C2-872841934 | Fita Led Neon Flex 5m 12v Ip65 Silicone Decorativa Laranja 12v | 5 | 0 | 5 | 3 | 0,29% | 95,37% | 24/09/2026, 20:38:17 | 4 |
| 57 | C | PRD-OLIST-C1-1023475641 | Perfil Embutido 30x20mm Aluminio Para Fita Led 2 Metros | 4 | 4 | 0 | 4 | 0,23% | 95,60% | 16/09/2026, 15:14:07 | 12 |
| 58 | C | PRD-OLIST-C1-1036680728 | Cobertor Manta Neo Velour 300g Macia Premium Aveludada | 4 | 4 | 0 | 4 | 0,23% | 95,83% | 16/09/2026, 10:49:39 | 12 |
| 59 | C | PRD-OLIST-C1-1038991276 | Interruptor Bolinha Gota De Embutir Em Moveis | 4 | 4 | 0 | 3 | 0,23% | 96,06% | 24/09/2026, 12:25:01 | 4 |
| 60 | C | PRD-OLIST-C2-842240951 | Kit 10 Emendas Em L Teto/teto De Ferro P Junção Perfil D Led - | 4 | 0 | 4 | 2 | 0,23% | 96,29% | 11/09/2026, 12:53:55 | 17 |
| 61 | C | PRD-OLIST-C2-842247733 | Kit Perfil Sobrepor 30x10mm Aluminio Para Fita Led 3 Metros | 4 | 0 | 4 | 4 | 0,23% | 96,51% | 25/09/2026, 20:04:31 | 3 |
| 62 | C | PRD-OLIST-C2-873891137 | Luminária Led Sobrepor Slim 20w 1 Metro 127v/220v | 4 | 0 | 4 | 2 | 0,23% | 96,74% | 15/09/2026, 17:49:35 | 13 |
| 63 | C | PRD-OLIST-C1-913140176 | Fita Led Vermelha Alta Potência 14w/m 240led/m 5m 1400lumens Vermelha 12v | 3 | 3 | 0 | 2 | 0,17% | 96,91% | 19/09/2026, 11:06:04 | 9 |
| 64 | C | PRD-OLIST-C2-842248690 | Sensor Touch Dimerizável Para Marcenaria 12v/24v Sensi Gaya | 3 | 0 | 3 | 2 | 0,17% | 97,09% | 25/09/2026, 16:14:00 | 3 |
| 65 | C | PRD-OLIST-C2-842249092 | Trilho Eletrificado Magnético Sobrepor Preto 200 Cm Gaya | 3 | 0 | 3 | 1 | 0,17% | 97,26% | 25/09/2026, 19:07:15 | 3 |
| 66 | C | PRD-OLIST-C2-869617065 | Sensor Touch Invisível Dimerizavel Marcenaria Sensi  Gaya | 3 | 0 | 3 | 3 | 0,17% | 97,43% | 24/09/2026, 21:30:00 | 4 |
| 67 | C | PRD-OLIST-C2-874722827 | Fita Led Cob 25w/m 480 Leds 10m 110v 220v Ip44 Irc90 4000k 127v | 3 | 0 | 3 | 2 | 0,17% | 97,60% | 28/09/2026, 21:20:44 | 0 |
| 68 | C | PRD-GTIN-7893456475521 | Spot Embutido De Solo Para Área Externa 5w Antirreflexo Ip67 85v A 265v Preto | 2 | 2 | 0 | 1 | 0,11% | 97,71% | 07/09/2026, 15:33:46 | 21 |
| 69 | C | PRD-GTIN-7899097919707 | Driver P/ Trilho Magnético 48v 180w Gaya | 2 | 2 | 0 | 1 | 0,11% | 97,83% | 28/09/2026, 13:49:47 | 0 |
| 70 | C | PRD-GTIN-7899097972214 | Conector Para Sensor De Led Marcenaria 12v/24v Sensi Gaya 12v-24v | 2 | 0 | 2 | 1 | 0,11% | 97,94% | 09/09/2026, 14:54:50 | 19 |
| 71 | C | PRD-GTIN-7899097993660 | Fonte Slim P/ Fita De Led/cftv 12v 5a 60w | 2 | 2 | 0 | 2 | 0,11% | 98,06% | 26/09/2026, 20:02:41 | 2 |
| 72 | C | PRD-OLIST-C1-1038991304 | Interruptor Bolinha Gota De Embutir Em Moveis | 2 | 2 | 0 | 2 | 0,11% | 98,17% | 02/09/2026, 19:11:36 | 26 |
| 73 | C | PRD-OLIST-C2-842238995 | Kit 10 Pçs De Acabamento Para Perfil Slim Embutir 24x7mm | 2 | 0 | 2 | 2 | 0,11% | 98,29% | 16/09/2026, 19:50:35 | 12 |
| 74 | C | PRD-OLIST-C2-842245299 | Luminária P/ Trilho Magnético Linear De Foco 12w Mag Gaya - Base Preta - Cor Da Luz 2700k | 2 | 0 | 2 | 2 | 0,11% | 98,40% | 24/09/2026, 14:19:19 | 4 |
| 75 | C | PRD-OLIST-C2-842246761 | Kit Perfil Sobrepor De Canto 16x16 45o P/ Fita Led 3 Metros Perfil Preto | 2 | 0 | 2 | 2 | 0,11% | 98,51% | 27/09/2026, 19:52:19 | 1 |
| 76 | C | PRD-OLIST-C2-842248654 | Sensor De Led Marcenaria Duas Portas 12v/24v Sensi Gaya | 2 | 0 | 2 | 2 | 0,11% | 98,63% | 19/09/2026, 16:48:27 | 9 |
| 77 | C | PRD-OLIST-C2-842248678 | Sensor Touch Dimerizável Para Marcenaria 12v/24v Sensi Gaya | 2 | 0 | 2 | 2 | 0,11% | 98,74% | 28/09/2026, 11:08:16 | 0 |
| 78 | C | PRD-OLIST-C2-872376014 | Luminária Led Sobrepor Slim 20w 1 Metro 127v/220v | 2 | 0 | 2 | 2 | 0,11% | 98,86% | 27/09/2026, 14:32:24 | 1 |
| 79 | C | PRD-OLIST-C2-872377487 | Luminária Led Sobrepor Slim 20w 1 Metro 127v/220v | 2 | 0 | 2 | 2 | 0,11% | 98,97% | 24/09/2026, 18:49:32 | 4 |
| 80 | C | PRD-OLIST-C2-873891118 | Luminária Led Sobrepor Slim 20w 1 Metro 127v/220v | 2 | 0 | 2 | 2 | 0,11% | 99,09% | 24/09/2026, 09:29:53 | 4 |
| 81 | C | PRD-GTIN-7899862891740 | Fonte Slim Para Fita De Led/cftv 12v 6a 72w | 1 | 1 | 0 | 1 | 0,06% | 99,14% | 03/09/2026, 23:22:39 | 25 |
| 82 | C | PRD-GTIN-7899862892211 | Fonte Slim Chaveada 180w 12v 15a Para Fita Led/cftv | 1 | 0 | 1 | 1 | 0,06% | 99,20% | 24/09/2026, 15:48:42 | 4 |
| 83 | C | PRD-OLIST-C1-1029252729 | Kit Sensor Marcenaria Uma Porta Central P Fita De Led Gaya | 1 | 1 | 0 | 1 | 0,06% | 99,26% | 24/09/2026, 13:46:24 | 4 |
| 84 | C | PRD-OLIST-C1-1030941299 | Spot Tutti De Embutir 7w Antiofuscante Icr98 Gaya 840lúmens | 1 | 1 | 0 | 1 | 0,06% | 99,31% | 21/09/2026, 21:17:31 | 7 |
| 85 | C | PRD-OLIST-C1-1032082903 | Fita Led 20w/m Ligação Direta - 10m 2000lumens 240 Leds/m | 1 | 1 | 0 | 1 | 0,06% | 99,37% | 19/09/2026, 11:29:33 | 9 |
| 86 | C | PRD-OLIST-C1-1038991699 | Dimmer Digital Para Fita Led 12v/24v Com Conector P4 - Gaya - 12v/24v | 1 | 1 | 0 | 1 | 0,06% | 99,43% | 13/09/2026, 18:38:12 | 15 |
| 87 | C | PRD-OLIST-C1-677126040 | Perfil Sobrepor 40x20mm Aluminio Para Fita Led 2m | 1 | 1 | 0 | 1 | 0,06% | 99,49% | 05/09/2026, 12:03:50 | 23 |
| 88 | C | PRD-OLIST-C1-677137262 | Kit Completo Perfil 30mm 2m + Fita Led 240 20w + Fonte Slim | 1 | 1 | 0 | 1 | 0,06% | 99,54% | 12/09/2026, 19:25:39 | 16 |
| 89 | C | PRD-OLIST-C1-786390333 | Perfil Embutir 30x10mm Aluminio Para Fita Led 2 Metros | 1 | 1 | 0 | 1 | 0,06% | 99,60% | 07/09/2026, 16:15:42 | 21 |
| 90 | C | PRD-OLIST-C1-827872927 | Fita Led Para Perfil 20w 240 Leds/m 12v 5 Metros Com Fonte | 1 | 1 | 0 | 1 | 0,06% | 99,66% | 11/09/2026, 14:12:12 | 17 |
| 91 | C | PRD-OLIST-C2-842245738 | Perfil Embutido 15mm Aluminio Para Fita Led 2 Metros Perfil Branco | 1 | 0 | 1 | 1 | 0,06% | 99,71% | 25/09/2026, 11:03:50 | 3 |
| 92 | C | PRD-OLIST-C2-842248113 | Perfil Sobrepor 40mm Aluminio Para Fita Led 2m | 1 | 0 | 1 | 1 | 0,06% | 99,77% | 24/09/2026, 20:05:23 | 4 |
| 93 | C | PRD-OLIST-C2-842248592 | Sensor De Aproximação P Led Marcenaria 12v/24v Sensi Gaya | 1 | 0 | 1 | 1 | 0,06% | 99,83% | 22/09/2026, 23:57:39 | 6 |
| 94 | C | PRD-OLIST-C2-869616484 | Sensor Uma Porta De Led Marcenaria Sensi Ellegance Gaya Controle Central 12v-24v | 1 | 0 | 1 | 1 | 0,06% | 99,89% | 16/09/2026, 17:37:18 | 12 |
| 95 | C | PRD-OLIST-C2-872377071 | Luminária Led Sobrepor Slim 20w 1 Metro 127v/220v | 1 | 0 | 1 | 1 | 0,06% | 99,94% | 10/09/2026, 13:12:23 | 18 |
| 96 | C | PRD-OLIST-C2-874722815 | Fita Led Cob 25w/m 480 Leds 10m 110v 220v Ip44 Irc90 4000k 220v | 1 | 0 | 1 | 1 | 0,06% | 100,00% | 24/09/2026, 21:54:17 | 4 |
| 97 | C | PRD-GTIN-7891709169173 | Cobertor Manta Neo Velour 300g Macia Premium Aveludada | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 98 | C | PRD-GTIN-7891709189560 | Cobertor Manta Maxy Plush Microfibra Ultra Macio 280g Casal Geométrico 280 G Sortido / Casal | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 99 | C | PRD-GTIN-7891709197190 | Cobertor Manta Neo Velour 300g Macia Premium Aveludada | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 100 | C | PRD-GTIN-7898589036472 | Ventilador Retrátil Teto Opus 4pás 60w 3000lm Cct C/controle | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 101 | C | PRD-GTIN-7898696185582 | Ventilador Retrátil Teto Opus 4pás 60w 3000lm Cct C/controle | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 102 | C | PRD-GTIN-7899097911084 | Fita Led Cob Gaya 18w/m - 50 Metros 1800lumens 12v  4000k | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 103 | C | PRD-GTIN-7899097919523 | Luminária P/ Trilho Magnético Linear 12w Mag Gaya   Base Preta - Cor Da Luz 2700k | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 104 | C | PRD-GTIN-7899097919530 | Luminária P/ Trilho Magnético Linear 24w Mag Gaya   Base Preta - Cor Da Luz 2700k | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 105 | C | PRD-GTIN-7899097919547 | Spot De Foco P/ Trilho Magnético 6w Mag Gaya Base Preta - Cor Da Luz 2700k | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 106 | C | PRD-GTIN-7899097919578 | Trilho Magnético Sobrepor Mag Gaya 1 Metro Trilho Preto | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 107 | C | PRD-GTIN-7899097919691 | Driver P/ Trilho Magnético 48v 90w Gaya | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 108 | C | PRD-GTIN-7899097931204 | Arandela Leya 2w Preta Bivolt Direcionável 150lumens Gaya 110v/220v Preto | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 109 | C | PRD-GTIN-7899097933222 | Mini Spot De Sobrepor Redondo Leya 1w 24v Irc90 Gaya 2700k - Preto | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 110 | C | PRD-GTIN-7899097939804 | Luminária Abajur Mesa Led Dimerizável Sem Fio Recarregável Cor Da Estrutura Preto Preto 127/220v | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 111 | C | PRD-GTIN-7899097955804 | Kit Conexão Para Fita De Led 10mm - Gaya Conectores Não Se Aplica | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 112 | C | PRD-GTIN-7899097956856 | Refletor Infinity 100w 8000 Lúmens Ip65 Bivolt 6000k Gaya 127/220v Preta | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 113 | C | PRD-GTIN-7899097975604 | Embutido De Solo Balizador 3w Antiofuscante Bivolt Ip67 Gaya 127/220v Preto | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 114 | C | PRD-GTIN-7899097975642 | Spot Balizador Embutido Solo Gaya Led 15w Para Jardim Bivolt | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 115 | C | PRD-GTIN-7899097990461 | Fita Led Super Brilho 12w Branco Quente 2835 Gaya 5 Metros | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 116 | C | PRD-GTIN-7899097990478 | Fita Led Super Brilho 12w Branco Quente 2835 Gaya 5 Metros | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 117 | C | PRD-GTIN-7899097993677 | Fonte Chaveada Slim 20a 240w 12v Gaya Led/cftv | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 118 | C | PRD-GTIN-7899097996685 | Refletor Solar 20w 1600lm Com Placa Solar Gaya Preta | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 119 | C | PRD-GTIN-7899862891757 | Fonte Slim Para Fita De Led/cftv 12v 7a 84w | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 120 | C | PRD-GTIN-7899862892327 | Fonte / Driver Para Fita De Led/cftv 12v 30a 360w | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 121 | C | PRD-GTIN-7899862892334 | Fonte / Driver Para Fita De Led/cftv 12v 50a 600w | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 122 | C | PRD-OLIST-C1-677144553 | Perfil Sobrepor 30x10mm Aluminio Para Fita Led 2 Metros | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 123 | C | PRD-OLIST-C2-842240831 | Driver Sistema Sensi Sensores P Marcenaria 60w 2.5a 24v Gaya | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 124 | C | PRD-OLIST-C2-872377090 | Luminária Led Sobrepor Slim 20w 1 Metro 127v/220v | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |

## X1 — C1 × C2

Inclui Products com identidade externa vigente nas duas BusinessAccounts, mesmo que uma conta tenha zero venda válida na janela. A diferença percentual é simétrica: `|C1-C2| / média(C1,C2)`, evitando escolher uma conta como base; quando ambas são zero, vale 0%.

**Resumo X1:** 6 Products cross-account antes e depois; C1=3 unidades (100,00%) e C2=0 (0,00%). Os 16 vínculos não alteraram a quantidade de Products X1 nem suas unidades/participações. Nenhuma conta é declarada vencedora.

| SKU | Product | C1 | C2 | Dif. absoluta | Dif. percentual | Part. C1 | Part. C2 |
|---|---|---:|---:|---:|---:|---:|---:|
| PRD-GTIN-7899097993660 | Fonte Slim P/ Fita De Led/cftv 12v 5a 60w | 2 | 0 | 2 | 200,00% | 100,00% | 0,00% |
| PRD-GTIN-7899862891740 | Fonte Slim Para Fita De Led/cftv 12v 6a 72w | 1 | 0 | 1 | 200,00% | 100,00% | 0,00% |
| PRD-GTIN-7898589036472 | Ventilador Retrátil Teto Opus 4pás 60w 3000lm Cct C/controle | 0 | 0 | 0 | 0,00% | 0,00% | 0,00% |
| PRD-GTIN-7898696185582 | Ventilador Retrátil Teto Opus 4pás 60w 3000lm Cct C/controle | 0 | 0 | 0 | 0,00% | 0,00% | 0,00% |
| PRD-GTIN-7899862891757 | Fonte Slim Para Fita De Led/cftv 12v 7a 84w | 0 | 0 | 0 | 0,00% | 0,00% | 0,00% |
| PRD-GTIN-7899862892334 | Fonte / Driver Para Fita De Led/cftv 12v 50a 600w | 0 | 0 | 0 | 0,00% | 0,00% | 0,00% |

## Integridade, anomalias e encerramento

- Estado confirmado antes e depois: `Product=124`, `ProductExternalIdentity=262`, listings vinculados=`132`, pedidos=`6.142` (`C1=3.607`; `C2=2.535`).
- Banco: `transaction_read_only=on` durante toda a rodada aceita; `writesPerformed=0`; contagens invariantes.
- Relacionamentos na janela: 0 itens por Product direto, 1.270 via listing, 4.872 sem Product e 0 conflitos.
- O total PAID permaneceu 6.712 unidades; a aproximação esperada de 1.750 / 26,07% foi confirmada sem forçar valores.
- A coincidência entre 1.163 pedidos PAID cobertos e 1.163 order items PAID cobertos decorre de haver um item persistido por pedido neste conjunto.
- Anomalia operacional: a opção read-only na URL foi ignorada pelo driver na primeira tentativa; essa rodada foi descartada. A rodada aqui reportada foi repetida integralmente em transação explícita `SET TRANSACTION READ ONLY` e validada com `transaction_read_only=on`.
- Anomalia de apresentação: o formatador-fonte contém o texto estático “110 Products”; este relatório corrigiu o escopo para 124 sem alterar o código-fonte.

Nenhum agregado foi persistido e nenhum Product, identidade, listing, pedido, schema ou migration foi alterado. Não houve backfill, refresh OAuth, auditoria AMBIGUOUS, commit ou push.
