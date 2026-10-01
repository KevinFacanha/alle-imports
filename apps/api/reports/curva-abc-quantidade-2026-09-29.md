# Curva ABC por quantidade vendida — fundação read-only

Gerado em 01/10/2026, 11:43:36.

> Escopo: somente os 110 Products materializados com confiança HIGH. Itens sem Product não entram no denominador da Curva ABC; seu impacto aparece em Cobertura.

## Resumo executivo

- Janela móvel: 30 dias, de 29/08/2026, 23:31:20 até 28/09/2026, 23:31:20.
- Dados persistidos: de 30/08/2026, 00:26:10 até 28/09/2026, 23:31:20.
- Venda válida no baseline: somente status `PAID`.
- Pedidos pagos: 5.497; unidades pagas: 6.712.
- Pedidos pagos cobertos: 1.115; unidades pagas cobertas: 1.655.
- Escritas no banco: 0.

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
| Product via listing item | 1.219 |
| Sem Product | 4.923 |
| Conflito entre os dois caminhos | 0 |

## Impacto por status

| Status | Pedidos | Itens | Unidades | Itens com Product | Unidades com Product | Pago (R$) | Reembolsado (R$) | Baseline |
|---|---:|---:|---:|---:|---:|---:|---:|:---:|
| PAID | 5.497 | 5.497 | 6.712 | 1.115 | 1.655 | 641.355,40 | 0,00 | sim |
| CANCELLED | 638 | 638 | 725 | 102 | 141 | 0,00 | 63.770,86 | não |
| PARTIALLY_REFUNDED | 7 | 7 | 11 | 2 | 3 | 534,74 | 419,04 | não |

### Recomendação explícita para reembolsos

Manter `REFUNDED` fora das unidades líquidas e manter `PARTIALLY_REFUNDED` fora do baseline até existir uma decisão de negócio ou dado de devolução por item. Para devolução parcial, as opções honestas são contar todas as unidades originais ou excluir o pedido inteiro; ratear unidades pelo valor reembolsado fabricaria uma quantidade. Recomenda-se persistir futuramente eventos/quantidades devolvidas por item e então calcular unidades líquidas.

## Cobertura atual

| Universo | Itens com Product | Itens sem Product | Cobertura de itens | Unidades com Product | Unidades sem Product | Cobertura do volume |
|---|---:|---:|---:|---:|---:|---:|
| Histórico persistido (6.142 itens / 7.448 unid.) | 1.219 | 4.923 | 19,85% | 1.799 | 5.649 | 24,15% |
| Vendas válidas do baseline (5.497 itens / 6.712 unid.) | 1.115 | 4.382 | 20,28% | 1.655 | 5.057 | 24,66% |

## Resultado da Curva ABC

| Classe | Products | Unidades | Participação real |
|:---:|---:|---:|---:|
| A | 20 | 1.329 | 80,30% |
| B | 25 | 248 | 14,98% |
| C | 65 | 78 | 4,71% |

A participação real pode ultrapassar 80% em A ou 15% em B porque o Product que cruza o limite permanece inteiro na classe que ele fecha.

## Top 20 Products por quantidade vendida

| # | Classe | SKU | Product | Unid. total | C1 | C2 | Pedidos pagos | % volume | % acumulado | Última venda | Dias sem venda |
|---:|:---:|---|---|---:|---:|---:|---:|---:|---:|---|---:|
| 1 | A | PRD-OLIST-C1-1038460583 | Fita Led 20w/m Cob Ligação Direta - 10m  320leds/m | 271 | 271 | 0 | 146 | 16,37% | 16,37% | 28/09/2026, 21:12:06 | 0 |
| 2 | A | PRD-OLIST-C1-1041363804 | Fita Led 20w/m Cob Ligação Direta - 10m  320leds/m | 200 | 200 | 0 | 112 | 12,08% | 28,46% | 28/09/2026, 21:13:05 | 0 |
| 3 | A | PRD-OLIST-C1-784612526 | Fita Led Cob Profissional 5w/m - 5 Metros 12v 500 Lumens/m | 96 | 96 | 0 | 35 | 5,80% | 34,26% | 28/09/2026, 17:14:07 | 0 |
| 4 | A | PRD-OLIST-C2-842246436 | Perfil Embutido 24mm Aluminio Para Fita Led 2 Metros | 89 | 0 | 89 | 89 | 5,38% | 39,64% | 28/09/2026, 14:26:01 | 0 |
| 5 | A | PRD-OLIST-C2-842246637 | Perfil 17mm Sobrepor Aluminio Para Fita Led 1 Metro | 79 | 0 | 79 | 23 | 4,77% | 44,41% | 28/09/2026, 20:05:19 | 0 |
| 6 | A | PRD-OLIST-C1-786398542 | Perfil Sobrepor 20mm Aluminio Para Fita Led 2 Metros | 78 | 78 | 0 | 78 | 4,71% | 49,12% | 24/09/2026, 21:16:16 | 4 |
| 7 | A | PRD-OLIST-C1-1041363799 | Fita Led 20w/m Cob Ligação Direta - 10m  320leds/m | 70 | 70 | 0 | 35 | 4,23% | 53,35% | 28/09/2026, 21:13:05 | 0 |
| 8 | A | PRD-OLIST-C2-842247808 | Perfil Sobrepor 30x20mm Aluminio Para Fita Led 2 Metros | 64 | 0 | 64 | 64 | 3,87% | 57,22% | 28/09/2026, 14:44:32 | 0 |
| 9 | A | PRD-OLIST-C2-842246741 | Perfil De Canto Sobrepor 45º P/ Led 2 Metros 16x16mm | 50 | 0 | 50 | 50 | 3,02% | 60,24% | 28/09/2026, 18:22:24 | 0 |
| 10 | A | PRD-OLIST-C2-842246586 | Perfil 17mm Sobrepor Aluminio Para Fita Led 1 Metro | 47 | 0 | 47 | 17 | 2,84% | 63,08% | 24/09/2026, 16:46:23 | 4 |
| 11 | A | PRD-OLIST-C1-1010970483 | Fonte Slim Palito 2,5a 60w 24v Gaya Para Fita Led/cftv | 46 | 46 | 0 | 25 | 2,78% | 65,86% | 28/09/2026, 16:49:05 | 0 |
| 12 | A | PRD-OLIST-C1-806658634 | Perfil Sobrepor 20mm Aluminio Para Fita Led 2 Metros | 41 | 41 | 0 | 41 | 2,48% | 68,34% | 21/09/2026, 12:55:53 | 7 |
| 13 | A | PRD-OLIST-C1-1041363810 | Fita Led 20w/m Cob Ligação Direta - 10m  320leds/m | 39 | 39 | 0 | 17 | 2,36% | 70,69% | 28/09/2026, 12:22:57 | 0 |
| 14 | A | PRD-OLIST-C1-682144170 | Perfil De Canto Sobrepor 45º P/ Led 2 Metros 16x16mm | 28 | 28 | 0 | 28 | 1,69% | 72,39% | 24/09/2026, 11:47:28 | 4 |
| 15 | A | PRD-OLIST-C1-851973724 | Perfil Embutido 15mm Aluminio Para Fita De Led 2 Metros Perfil Branco | 27 | 27 | 0 | 27 | 1,63% | 74,02% | 22/09/2026, 14:21:42 | 6 |
| 16 | A | PRD-OLIST-C1-1034314147 | Perfil Sobrepor 17mm Gold Dourado Para Fita Led 2 Metros Perfil Gold - | 22 | 22 | 0 | 9 | 1,33% | 75,35% | 23/09/2026, 14:29:18 | 5 |
| 17 | A | PRD-OLIST-C2-869281972 | Perfil No Frame Embutido Sem Bordas 15x15mm 2 Metros | 22 | 0 | 22 | 22 | 1,33% | 76,68% | 26/09/2026, 19:37:07 | 2 |
| 18 | A | PRD-OLIST-C2-842241657 | Fita Led 20w/m - 5 Metros 2000lumens 240 Leds/m | 21 | 0 | 21 | 11 | 1,27% | 77,95% | 22/09/2026, 17:40:57 | 6 |
| 19 | A | PRD-OLIST-C2-842242671 | Fita Led Cob 5w/m - 5 Metros 500 Lumens 12v | 21 | 0 | 21 | 14 | 1,27% | 79,21% | 28/09/2026, 20:04:57 | 0 |
| 20 | A | PRD-OLIST-C2-842247866 | Perfil Sobrepor 30x20mm Aluminio Para Fita Led 2 Metros | 18 | 0 | 18 | 18 | 1,09% | 80,30% | 27/09/2026, 17:56:02 | 1 |

## Curva ABC completa

| # | Classe | SKU | Product | Unid. total | C1 | C2 | Pedidos pagos | % volume | % acumulado | Última venda | Dias sem venda |
|---:|:---:|---|---|---:|---:|---:|---:|---:|---:|---|---:|
| 1 | A | PRD-OLIST-C1-1038460583 | Fita Led 20w/m Cob Ligação Direta - 10m  320leds/m | 271 | 271 | 0 | 146 | 16,37% | 16,37% | 28/09/2026, 21:12:06 | 0 |
| 2 | A | PRD-OLIST-C1-1041363804 | Fita Led 20w/m Cob Ligação Direta - 10m  320leds/m | 200 | 200 | 0 | 112 | 12,08% | 28,46% | 28/09/2026, 21:13:05 | 0 |
| 3 | A | PRD-OLIST-C1-784612526 | Fita Led Cob Profissional 5w/m - 5 Metros 12v 500 Lumens/m | 96 | 96 | 0 | 35 | 5,80% | 34,26% | 28/09/2026, 17:14:07 | 0 |
| 4 | A | PRD-OLIST-C2-842246436 | Perfil Embutido 24mm Aluminio Para Fita Led 2 Metros | 89 | 0 | 89 | 89 | 5,38% | 39,64% | 28/09/2026, 14:26:01 | 0 |
| 5 | A | PRD-OLIST-C2-842246637 | Perfil 17mm Sobrepor Aluminio Para Fita Led 1 Metro | 79 | 0 | 79 | 23 | 4,77% | 44,41% | 28/09/2026, 20:05:19 | 0 |
| 6 | A | PRD-OLIST-C1-786398542 | Perfil Sobrepor 20mm Aluminio Para Fita Led 2 Metros | 78 | 78 | 0 | 78 | 4,71% | 49,12% | 24/09/2026, 21:16:16 | 4 |
| 7 | A | PRD-OLIST-C1-1041363799 | Fita Led 20w/m Cob Ligação Direta - 10m  320leds/m | 70 | 70 | 0 | 35 | 4,23% | 53,35% | 28/09/2026, 21:13:05 | 0 |
| 8 | A | PRD-OLIST-C2-842247808 | Perfil Sobrepor 30x20mm Aluminio Para Fita Led 2 Metros | 64 | 0 | 64 | 64 | 3,87% | 57,22% | 28/09/2026, 14:44:32 | 0 |
| 9 | A | PRD-OLIST-C2-842246741 | Perfil De Canto Sobrepor 45º P/ Led 2 Metros 16x16mm | 50 | 0 | 50 | 50 | 3,02% | 60,24% | 28/09/2026, 18:22:24 | 0 |
| 10 | A | PRD-OLIST-C2-842246586 | Perfil 17mm Sobrepor Aluminio Para Fita Led 1 Metro | 47 | 0 | 47 | 17 | 2,84% | 63,08% | 24/09/2026, 16:46:23 | 4 |
| 11 | A | PRD-OLIST-C1-1010970483 | Fonte Slim Palito 2,5a 60w 24v Gaya Para Fita Led/cftv | 46 | 46 | 0 | 25 | 2,78% | 65,86% | 28/09/2026, 16:49:05 | 0 |
| 12 | A | PRD-OLIST-C1-806658634 | Perfil Sobrepor 20mm Aluminio Para Fita Led 2 Metros | 41 | 41 | 0 | 41 | 2,48% | 68,34% | 21/09/2026, 12:55:53 | 7 |
| 13 | A | PRD-OLIST-C1-1041363810 | Fita Led 20w/m Cob Ligação Direta - 10m  320leds/m | 39 | 39 | 0 | 17 | 2,36% | 70,69% | 28/09/2026, 12:22:57 | 0 |
| 14 | A | PRD-OLIST-C1-682144170 | Perfil De Canto Sobrepor 45º P/ Led 2 Metros 16x16mm | 28 | 28 | 0 | 28 | 1,69% | 72,39% | 24/09/2026, 11:47:28 | 4 |
| 15 | A | PRD-OLIST-C1-851973724 | Perfil Embutido 15mm Aluminio Para Fita De Led 2 Metros Perfil Branco | 27 | 27 | 0 | 27 | 1,63% | 74,02% | 22/09/2026, 14:21:42 | 6 |
| 16 | A | PRD-OLIST-C1-1034314147 | Perfil Sobrepor 17mm Gold Dourado Para Fita Led 2 Metros Perfil Gold - | 22 | 22 | 0 | 9 | 1,33% | 75,35% | 23/09/2026, 14:29:18 | 5 |
| 17 | A | PRD-OLIST-C2-869281972 | Perfil No Frame Embutido Sem Bordas 15x15mm 2 Metros | 22 | 0 | 22 | 22 | 1,33% | 76,68% | 26/09/2026, 19:37:07 | 2 |
| 18 | A | PRD-OLIST-C2-842241657 | Fita Led 20w/m - 5 Metros 2000lumens 240 Leds/m | 21 | 0 | 21 | 11 | 1,27% | 77,95% | 22/09/2026, 17:40:57 | 6 |
| 19 | A | PRD-OLIST-C2-842242671 | Fita Led Cob 5w/m - 5 Metros 500 Lumens 12v | 21 | 0 | 21 | 14 | 1,27% | 79,21% | 28/09/2026, 20:04:57 | 0 |
| 20 | A | PRD-OLIST-C2-842247866 | Perfil Sobrepor 30x20mm Aluminio Para Fita Led 2 Metros | 18 | 0 | 18 | 18 | 1,09% | 80,30% | 27/09/2026, 17:56:02 | 1 |
| 21 | B | PRD-OLIST-C1-1029252881 | Sensor De Led Marcenaria Uma Porta 12v/24v Sensi Gaya | 17 | 17 | 0 | 6 | 1,03% | 81,33% | 21/09/2026, 16:30:10 | 7 |
| 22 | B | PRD-OLIST-C1-827866126 | Fita Led 20w/m - 5 Metros 2000lumens 240 Leds/m | 17 | 17 | 0 | 9 | 1,03% | 82,36% | 28/09/2026, 14:10:17 | 0 |
| 23 | B | PRD-OLIST-C2-842241631 | Fita Led 20w/m - 5 Metros 2000lumens 240 Leds/m | 17 | 0 | 17 | 13 | 1,03% | 83,38% | 26/09/2026, 00:52:55 | 2 |
| 24 | B | PRD-GTIN-7891709197282 | Cobertor Manta Neo Velour 300g Macia Premium Aveludada | 16 | 16 | 0 | 16 | 0,97% | 84,35% | 24/09/2026, 12:14:13 | 4 |
| 25 | B | PRD-OLIST-C2-842309753 | Perfil Sobrepor Alumínio 17mm Fita Led 1,5m Com Difusor Perfil Preto | 16 | 0 | 16 | 14 | 0,97% | 85,32% | 28/09/2026, 22:31:03 | 0 |
| 26 | B | PRD-OLIST-C1-1030886443 | Perfil Sobrepor Alumínio 17mm Fita Led 1,5m Com Difusor Perfil Branco | 15 | 15 | 0 | 15 | 0,91% | 86,22% | 24/09/2026, 16:46:27 | 4 |
| 27 | B | PRD-GTIN-7899097914740 | Fonte Chaveada Slim 5a 100w 24v Gaya Led/cftv | 13 | 0 | 13 | 8 | 0,79% | 87,01% | 28/09/2026, 09:15:40 | 0 |
| 28 | B | PRD-OLIST-C1-1039299469 | Cobertor Manta Neo Velour 300g Macia Premium Aveludada | 13 | 13 | 0 | 13 | 0,79% | 87,79% | 20/09/2026, 21:07:54 | 8 |
| 29 | B | PRD-OLIST-C1-1030886474 | Perfil Sobrepor Alumínio 17mm Fita Led 1,5m Com Difusor Perfil Preto | 12 | 12 | 0 | 12 | 0,73% | 88,52% | 27/09/2026, 23:45:11 | 1 |
| 30 | B | PRD-OLIST-C1-1032999957 | Kit Par Cabo De Aço Pendente Para Perfil De Led Sobrepor 2m . - | 10 | 10 | 0 | 3 | 0,60% | 89,12% | 14/09/2026, 10:20:59 | 14 |
| 31 | B | PRD-OLIST-C1-1041363794 | Fita Led 20w/m Cob Ligação Direta - 10m  320leds/m | 9 | 9 | 0 | 7 | 0,54% | 89,67% | 17/09/2026, 16:17:18 | 11 |
| 32 | B | PRD-OLIST-C1-682170128 | Kit Perfil Sobrepor 50x20mm Aluminio Para Fita Led 2 Metros | 9 | 9 | 0 | 9 | 0,54% | 90,21% | 22/09/2026, 11:01:36 | 6 |
| 33 | B | PRD-OLIST-C1-1038991287 | Interruptor Bolinha Gota De Embutir Em Moveis | 8 | 8 | 0 | 3 | 0,48% | 90,69% | 28/09/2026, 15:29:39 | 0 |
| 34 | B | PRD-OLIST-C2-842245891 | Perfil Embutido 30x20mm Aluminio Para Fita Led 2 Metros | 8 | 0 | 8 | 8 | 0,48% | 91,18% | 23/09/2026, 13:40:24 | 5 |
| 35 | B | PRD-OLIST-C1-1032082910 | Fita Led 20w/m Ligação Direta - 10m 2000lumens 240 Leds/m | 7 | 7 | 0 | 7 | 0,42% | 91,60% | 27/09/2026, 11:13:41 | 1 |
| 36 | B | PRD-OLIST-C1-1032082921 | Fita Led 20w/m Ligação Direta - 10m 2000lumens 240 Leds/m | 7 | 7 | 0 | 4 | 0,42% | 92,02% | 19/09/2026, 11:28:46 | 9 |
| 37 | B | PRD-OLIST-C1-784614178 | Fita Led Cob Profissional 5w/m - 5 Metros 12v 500 Lumens/m | 7 | 7 | 0 | 6 | 0,42% | 92,45% | 24/09/2026, 09:31:27 | 4 |
| 38 | B | PRD-OLIST-C2-872313214 | 10m Fita Led Cob 12w/m 320leds Luz Contínua Premium - 24v | 7 | 0 | 7 | 5 | 0,42% | 92,87% | 28/09/2026, 09:31:53 | 0 |
| 39 | B | PRD-OLIST-C2-873891191 | Luminária Led Sobrepor Slim 20w 1 Metro 127v/220v | 7 | 0 | 7 | 5 | 0,42% | 93,29% | 24/09/2026, 20:29:18 | 4 |
| 40 | B | PRD-OLIST-C1-983077421 | Perfil Embutido 20x10mm Para Fita Led 2 Metros | 6 | 6 | 0 | 6 | 0,36% | 93,66% | 11/09/2026, 16:23:01 | 17 |
| 41 | B | PRD-OLIST-C2-842240814 | Driver Sistema Sensi Sensores P Marcenaria 60w 5a 12v Gaya | 6 | 0 | 6 | 4 | 0,36% | 94,02% | 26/09/2026, 18:58:26 | 2 |
| 42 | B | PRD-OLIST-C2-842309049 | Perfil Sobrepor Alumínio 17mm Fita Led 1,5m Com Difusor Perfil Branco | 6 | 0 | 6 | 4 | 0,36% | 94,38% | 26/09/2026, 16:30:31 | 2 |
| 43 | B | PRD-OLIST-C1-1044911343 | Arandela Led Meia Lua 6 Fachos 6w Branco Quente Ip65 Bivolt 127v/220v Preto | 5 | 5 | 0 | 4 | 0,30% | 94,68% | 28/09/2026, 15:48:45 | 0 |
| 44 | B | PRD-OLIST-C2-842241675 | Fita Led 20w/m - 5 Metros 2000lumens 240 Leds/m | 5 | 0 | 5 | 3 | 0,30% | 94,98% | 18/09/2026, 10:34:01 | 10 |
| 45 | B | PRD-OLIST-C2-842244330 | Fonte Slim Palito 2,5a 60w 24v Gaya Para Fita Led/cftv | 5 | 0 | 5 | 4 | 0,30% | 95,29% | 24/09/2026, 19:24:48 | 4 |
| 46 | C | PRD-OLIST-C2-842246824 | Perfil Sobrepor 20mm Aluminio Para Fita Led 2 Metros | 5 | 0 | 5 | 5 | 0,30% | 95,59% | 26/09/2026, 21:23:53 | 2 |
| 47 | C | PRD-OLIST-C2-872841934 | Fita Led Neon Flex 5m 12v Ip65 Silicone Decorativa Laranja 12v | 5 | 0 | 5 | 3 | 0,30% | 95,89% | 24/09/2026, 20:38:17 | 4 |
| 48 | C | PRD-OLIST-C1-1023475641 | Perfil Embutido 30x20mm Aluminio Para Fita Led 2 Metros | 4 | 4 | 0 | 4 | 0,24% | 96,13% | 16/09/2026, 15:14:07 | 12 |
| 49 | C | PRD-OLIST-C1-1036680728 | Cobertor Manta Neo Velour 300g Macia Premium Aveludada | 4 | 4 | 0 | 4 | 0,24% | 96,37% | 16/09/2026, 10:49:39 | 12 |
| 50 | C | PRD-OLIST-C1-1038991276 | Interruptor Bolinha Gota De Embutir Em Moveis | 4 | 4 | 0 | 3 | 0,24% | 96,62% | 24/09/2026, 12:25:01 | 4 |
| 51 | C | PRD-OLIST-C2-842247733 | Kit Perfil Sobrepor 30x10mm Aluminio Para Fita Led 3 Metros | 4 | 0 | 4 | 4 | 0,24% | 96,86% | 25/09/2026, 20:04:31 | 3 |
| 52 | C | PRD-OLIST-C2-873891137 | Luminária Led Sobrepor Slim 20w 1 Metro 127v/220v | 4 | 0 | 4 | 2 | 0,24% | 97,10% | 15/09/2026, 17:49:35 | 13 |
| 53 | C | PRD-OLIST-C1-913140176 | Fita Led Vermelha Alta Potência 14w/m 240led/m 5m 1400lumens Vermelha 12v | 3 | 3 | 0 | 2 | 0,18% | 97,28% | 19/09/2026, 11:06:04 | 9 |
| 54 | C | PRD-OLIST-C2-842249092 | Trilho Eletrificado Magnético Sobrepor Preto 200 Cm Gaya | 3 | 0 | 3 | 1 | 0,18% | 97,46% | 25/09/2026, 19:07:15 | 3 |
| 55 | C | PRD-OLIST-C2-869617065 | Sensor Touch Invisível Dimerizavel Marcenaria Sensi  Gaya | 3 | 0 | 3 | 3 | 0,18% | 97,64% | 24/09/2026, 21:30:00 | 4 |
| 56 | C | PRD-OLIST-C2-874722827 | Fita Led Cob 25w/m 480 Leds 10m 110v 220v Ip44 Irc90 4000k 127v | 3 | 0 | 3 | 2 | 0,18% | 97,82% | 28/09/2026, 21:20:44 | 0 |
| 57 | C | PRD-GTIN-7893456475521 | Spot Embutido De Solo Para Área Externa 5w Antirreflexo Ip67 85v A 265v Preto | 2 | 2 | 0 | 1 | 0,12% | 97,95% | 07/09/2026, 15:33:46 | 21 |
| 58 | C | PRD-GTIN-7899097919707 | Driver P/ Trilho Magnético 48v 180w Gaya | 2 | 2 | 0 | 1 | 0,12% | 98,07% | 28/09/2026, 13:49:47 | 0 |
| 59 | C | PRD-GTIN-7899097972214 | Conector Para Sensor De Led Marcenaria 12v/24v Sensi Gaya 12v-24v | 2 | 0 | 2 | 1 | 0,12% | 98,19% | 09/09/2026, 14:54:50 | 19 |
| 60 | C | PRD-GTIN-7899097993660 | Fonte Slim P/ Fita De Led/cftv 12v 5a 60w | 2 | 2 | 0 | 2 | 0,12% | 98,31% | 26/09/2026, 20:02:41 | 2 |
| 61 | C | PRD-OLIST-C1-1038991304 | Interruptor Bolinha Gota De Embutir Em Moveis | 2 | 2 | 0 | 2 | 0,12% | 98,43% | 02/09/2026, 19:11:36 | 26 |
| 62 | C | PRD-OLIST-C2-842245299 | Luminária P/ Trilho Magnético Linear De Foco 12w Mag Gaya - Base Preta - Cor Da Luz 2700k | 2 | 0 | 2 | 2 | 0,12% | 98,55% | 24/09/2026, 14:19:19 | 4 |
| 63 | C | PRD-OLIST-C2-842246761 | Kit Perfil Sobrepor De Canto 16x16 45o P/ Fita Led 3 Metros Perfil Preto | 2 | 0 | 2 | 2 | 0,12% | 98,67% | 27/09/2026, 19:52:19 | 1 |
| 64 | C | PRD-OLIST-C2-872376014 | Luminária Led Sobrepor Slim 20w 1 Metro 127v/220v | 2 | 0 | 2 | 2 | 0,12% | 98,79% | 27/09/2026, 14:32:24 | 1 |
| 65 | C | PRD-OLIST-C2-872377487 | Luminária Led Sobrepor Slim 20w 1 Metro 127v/220v | 2 | 0 | 2 | 2 | 0,12% | 98,91% | 24/09/2026, 18:49:32 | 4 |
| 66 | C | PRD-OLIST-C2-873891118 | Luminária Led Sobrepor Slim 20w 1 Metro 127v/220v | 2 | 0 | 2 | 2 | 0,12% | 99,03% | 24/09/2026, 09:29:53 | 4 |
| 67 | C | PRD-GTIN-7899862891740 | Fonte Slim Para Fita De Led/cftv 12v 6a 72w | 1 | 1 | 0 | 1 | 0,06% | 99,09% | 03/09/2026, 23:22:39 | 25 |
| 68 | C | PRD-GTIN-7899862892211 | Fonte Slim Chaveada 180w 12v 15a Para Fita Led/cftv | 1 | 0 | 1 | 1 | 0,06% | 99,15% | 24/09/2026, 15:48:42 | 4 |
| 69 | C | PRD-OLIST-C1-1029252729 | Kit Sensor Marcenaria Uma Porta Central P Fita De Led Gaya | 1 | 1 | 0 | 1 | 0,06% | 99,21% | 24/09/2026, 13:46:24 | 4 |
| 70 | C | PRD-OLIST-C1-1030941299 | Spot Tutti De Embutir 7w Antiofuscante Icr98 Gaya 840lúmens | 1 | 1 | 0 | 1 | 0,06% | 99,27% | 21/09/2026, 21:17:31 | 7 |
| 71 | C | PRD-OLIST-C1-1032082903 | Fita Led 20w/m Ligação Direta - 10m 2000lumens 240 Leds/m | 1 | 1 | 0 | 1 | 0,06% | 99,34% | 19/09/2026, 11:29:33 | 9 |
| 72 | C | PRD-OLIST-C1-1038991699 | Dimmer Digital Para Fita Led 12v/24v Com Conector P4 - Gaya - 12v/24v | 1 | 1 | 0 | 1 | 0,06% | 99,40% | 13/09/2026, 18:38:12 | 15 |
| 73 | C | PRD-OLIST-C1-677126040 | Perfil Sobrepor 40x20mm Aluminio Para Fita Led 2m | 1 | 1 | 0 | 1 | 0,06% | 99,46% | 05/09/2026, 12:03:50 | 23 |
| 74 | C | PRD-OLIST-C1-677137262 | Kit Completo Perfil 30mm 2m + Fita Led 240 20w + Fonte Slim | 1 | 1 | 0 | 1 | 0,06% | 99,52% | 12/09/2026, 19:25:39 | 16 |
| 75 | C | PRD-OLIST-C1-786390333 | Perfil Embutir 30x10mm Aluminio Para Fita Led 2 Metros | 1 | 1 | 0 | 1 | 0,06% | 99,58% | 07/09/2026, 16:15:42 | 21 |
| 76 | C | PRD-OLIST-C1-827872927 | Fita Led Para Perfil 20w 240 Leds/m 12v 5 Metros Com Fonte | 1 | 1 | 0 | 1 | 0,06% | 99,64% | 11/09/2026, 14:12:12 | 17 |
| 77 | C | PRD-OLIST-C2-842245738 | Perfil Embutido 15mm Aluminio Para Fita Led 2 Metros Perfil Branco | 1 | 0 | 1 | 1 | 0,06% | 99,70% | 25/09/2026, 11:03:50 | 3 |
| 78 | C | PRD-OLIST-C2-842248113 | Perfil Sobrepor 40mm Aluminio Para Fita Led 2m | 1 | 0 | 1 | 1 | 0,06% | 99,76% | 24/09/2026, 20:05:23 | 4 |
| 79 | C | PRD-OLIST-C2-842248592 | Sensor De Aproximação P Led Marcenaria 12v/24v Sensi Gaya | 1 | 0 | 1 | 1 | 0,06% | 99,82% | 22/09/2026, 23:57:39 | 6 |
| 80 | C | PRD-OLIST-C2-869616484 | Sensor Uma Porta De Led Marcenaria Sensi Ellegance Gaya Controle Central 12v-24v | 1 | 0 | 1 | 1 | 0,06% | 99,88% | 16/09/2026, 17:37:18 | 12 |
| 81 | C | PRD-OLIST-C2-872377071 | Luminária Led Sobrepor Slim 20w 1 Metro 127v/220v | 1 | 0 | 1 | 1 | 0,06% | 99,94% | 10/09/2026, 13:12:23 | 18 |
| 82 | C | PRD-OLIST-C2-874722815 | Fita Led Cob 25w/m 480 Leds 10m 110v 220v Ip44 Irc90 4000k 220v | 1 | 0 | 1 | 1 | 0,06% | 100,00% | 24/09/2026, 21:54:17 | 4 |
| 83 | C | PRD-GTIN-7891709169173 | Cobertor Manta Neo Velour 300g Macia Premium Aveludada | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 84 | C | PRD-GTIN-7891709189560 | Cobertor Manta Maxy Plush Microfibra Ultra Macio 280g Casal Geométrico 280 G Sortido / Casal | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 85 | C | PRD-GTIN-7891709197190 | Cobertor Manta Neo Velour 300g Macia Premium Aveludada | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 86 | C | PRD-GTIN-7898589036472 | Ventilador Retrátil Teto Opus 4pás 60w 3000lm Cct C/controle | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 87 | C | PRD-GTIN-7898696185582 | Ventilador Retrátil Teto Opus 4pás 60w 3000lm Cct C/controle | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 88 | C | PRD-GTIN-7899097911084 | Fita Led Cob Gaya 18w/m - 50 Metros 1800lumens 12v  4000k | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 89 | C | PRD-GTIN-7899097919523 | Luminária P/ Trilho Magnético Linear 12w Mag Gaya   Base Preta - Cor Da Luz 2700k | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 90 | C | PRD-GTIN-7899097919530 | Luminária P/ Trilho Magnético Linear 24w Mag Gaya   Base Preta - Cor Da Luz 2700k | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 91 | C | PRD-GTIN-7899097919547 | Spot De Foco P/ Trilho Magnético 6w Mag Gaya Base Preta - Cor Da Luz 2700k | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 92 | C | PRD-GTIN-7899097919578 | Trilho Magnético Sobrepor Mag Gaya 1 Metro Trilho Preto | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 93 | C | PRD-GTIN-7899097919691 | Driver P/ Trilho Magnético 48v 90w Gaya | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 94 | C | PRD-GTIN-7899097931204 | Arandela Leya 2w Preta Bivolt Direcionável 150lumens Gaya 110v/220v Preto | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 95 | C | PRD-GTIN-7899097933222 | Mini Spot De Sobrepor Redondo Leya 1w 24v Irc90 Gaya 2700k - Preto | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 96 | C | PRD-GTIN-7899097939804 | Luminária Abajur Mesa Led Dimerizável Sem Fio Recarregável Cor Da Estrutura Preto Preto 127/220v | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 97 | C | PRD-GTIN-7899097955804 | Kit Conexão Para Fita De Led 10mm - Gaya Conectores Não Se Aplica | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 98 | C | PRD-GTIN-7899097956856 | Refletor Infinity 100w 8000 Lúmens Ip65 Bivolt 6000k Gaya 127/220v Preta | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 99 | C | PRD-GTIN-7899097975604 | Embutido De Solo Balizador 3w Antiofuscante Bivolt Ip67 Gaya 127/220v Preto | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 100 | C | PRD-GTIN-7899097975642 | Spot Balizador Embutido Solo Gaya Led 15w Para Jardim Bivolt | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 101 | C | PRD-GTIN-7899097990461 | Fita Led Super Brilho 12w Branco Quente 2835 Gaya 5 Metros | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 102 | C | PRD-GTIN-7899097990478 | Fita Led Super Brilho 12w Branco Quente 2835 Gaya 5 Metros | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 103 | C | PRD-GTIN-7899097993677 | Fonte Chaveada Slim 20a 240w 12v Gaya Led/cftv | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 104 | C | PRD-GTIN-7899097996685 | Refletor Solar 20w 1600lm Com Placa Solar Gaya Preta | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 105 | C | PRD-GTIN-7899862891757 | Fonte Slim Para Fita De Led/cftv 12v 7a 84w | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 106 | C | PRD-GTIN-7899862892327 | Fonte / Driver Para Fita De Led/cftv 12v 30a 360w | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 107 | C | PRD-GTIN-7899862892334 | Fonte / Driver Para Fita De Led/cftv 12v 50a 600w | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 108 | C | PRD-OLIST-C1-677144553 | Perfil Sobrepor 30x10mm Aluminio Para Fita Led 2 Metros | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 109 | C | PRD-OLIST-C2-842240831 | Driver Sistema Sensi Sensores P Marcenaria 60w 2.5a 24v Gaya | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |
| 110 | C | PRD-OLIST-C2-872377090 | Luminária Led Sobrepor Slim 20w 1 Metro 127v/220v | 0 | 0 | 0 | 0 | 0,00% | 100,00% | — | ≥ 30 |

## X1 — C1 × C2

Inclui Products com identidade externa vigente nas duas BusinessAccounts, mesmo que uma conta tenha zero venda válida na janela. A diferença percentual é simétrica: `|C1-C2| / média(C1,C2)`, evitando escolher uma conta como base; quando ambas são zero, vale 0%.

| SKU | Product | C1 | C2 | Dif. absoluta | Dif. percentual | Part. C1 | Part. C2 |
|---|---|---:|---:|---:|---:|---:|---:|
| PRD-GTIN-7899097993660 | Fonte Slim P/ Fita De Led/cftv 12v 5a 60w | 2 | 0 | 2 | 200,00% | 100,00% | 0,00% |
| PRD-GTIN-7899862891740 | Fonte Slim Para Fita De Led/cftv 12v 6a 72w | 1 | 0 | 1 | 200,00% | 100,00% | 0,00% |
| PRD-GTIN-7898589036472 | Ventilador Retrátil Teto Opus 4pás 60w 3000lm Cct C/controle | 0 | 0 | 0 | 0,00% | 0,00% | 0,00% |
| PRD-GTIN-7898696185582 | Ventilador Retrátil Teto Opus 4pás 60w 3000lm Cct C/controle | 0 | 0 | 0 | 0,00% | 0,00% | 0,00% |
| PRD-GTIN-7899862891757 | Fonte Slim Para Fita De Led/cftv 12v 7a 84w | 0 | 0 | 0 | 0,00% | 0,00% | 0,00% |
| PRD-GTIN-7899862892334 | Fonte / Driver Para Fita De Led/cftv 12v 50a 600w | 0 | 0 | 0 | 0,00% | 0,00% | 0,00% |

## Decisão de arquitetura

**Recomendação: C) híbrido.**

- Manter o detalhe de pedidos como fonte de verdade e o cálculo on-demand para auditoria, cenários de refund e reprocessamentos.
- Quando houver autorização para schema, materializar métricas incrementais por `businessDate × Product × BusinessAccount`, além de snapshots versionados da classificação. Não materializar apenas a letra A/B/C sem seus numeradores, denominadores, janela e regra.
- Recalcular os deltas após cada sync de 10 minutos e fechar snapshots diários. Isso oferece baixa latência para dashboard, alertas, produtos sem giro e agentes de IA sem varrer pedidos detalhados a cada leitura.
- Estoque por produto/depósito deve permanecer uma dimensão separada e ser combinado com velocidade de venda e dias sem venda na camada de leitura.
- Toda resposta deve carregar `calculatedAt`, janela, cobertura e versão da regra, preservando auditabilidade para FULL Intelligence e para a Gabi.

Nenhum agregado foi persistido e nenhum Product, identidade ou dado histórico foi alterado.
