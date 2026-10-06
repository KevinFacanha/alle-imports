import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const schemaPath = fileURLToPath(
  new URL('../../../../prisma/schema.prisma', import.meta.url),
);
const migrationPath = fileURLToPath(
  new URL(
    '../../../../prisma/migrations/20261006120000_add_offer_layer_phase_1/migration.sql',
    import.meta.url,
  ),
);

const schema = readFileSync(schemaPath, 'utf8');
const migration = readFileSync(migrationPath, 'utf8');

interface CompositionFixture {
  listingItemId: string;
  componentProductId: string;
  quantity: string;
}

interface EquivalenceFixture {
  leftListingItemId: string;
  rightListingItemId: string;
  status: 'CANDIDATE' | 'CONFIRMED' | 'REJECTED';
}

describe('Offer Layer phase 1 schema', () => {
  it('models C1 and C2 white pack offers as compositions and keeps black separate', () => {
    const products = [
      { id: 'product-white-1300', sku: '1300', color: 'Branco' },
      { id: 'product-black-1305', sku: '1305', color: 'Preto' },
    ];
    const compositions: CompositionFixture[] = [
      {
        listingItemId: 'MLB3414573257:Branco',
        componentProductId: products[0]!.id,
        quantity: '2',
      },
      {
        listingItemId: 'MLB5700878462:Branco',
        componentProductId: products[0]!.id,
        quantity: '2',
      },
      {
        listingItemId: 'MLB3414573257:Preto',
        componentProductId: products[1]!.id,
        quantity: '2',
      },
      {
        listingItemId: 'MLB5700878462:Preto',
        componentProductId: products[1]!.id,
        quantity: '2',
      },
    ];
    const equivalence: EquivalenceFixture = {
      leftListingItemId: 'MLB3414573257:Branco',
      rightListingItemId: 'MLB5700878462:Branco',
      status: 'CONFIRMED',
    };
    const olistBaseProductIdentities = products.map(({ id, sku }) => ({
      productId: id,
      externalListingId: `olist-product-${sku}`,
    }));

    const white = compositions.filter(({ listingItemId }) =>
      listingItemId.endsWith(':Branco'),
    );
    const black = compositions.filter(({ listingItemId }) =>
      listingItemId.endsWith(':Preto'),
    );

    assert.equal(products.length, 2);
    assert.deepEqual(white.map(({ quantity }) => quantity), ['2', '2']);
    assert.equal(new Set(white.map(({ componentProductId }) => componentProductId)).size, 1);
    assert.equal(new Set(black.map(({ componentProductId }) => componentProductId)).size, 1);
    assert.notEqual(white[0]!.componentProductId, black[0]!.componentProductId);
    assert.equal(equivalence.status, 'CONFIRMED');
    assert.deepEqual(
      [equivalence.leftListingItemId, equivalence.rightListingItemId],
      white.map(({ listingItemId }) => listingItemId),
    );
    assert.ok(
      olistBaseProductIdentities.every(({ productId }) =>
        products.some(({ id }) => id === productId),
      ),
    );
    assert.ok(
      olistBaseProductIdentities.every(
        ({ externalListingId }) =>
          !compositions.some(({ listingItemId }) => listingItemId === externalListingId),
      ),
    );
  });

  it('represents different pack sizes with the same base Product', () => {
    const compositions: CompositionFixture[] = [
      { listingItemId: 'offer-2199-x1', componentProductId: 'product-2199', quantity: '1' },
      { listingItemId: 'offer-2199-x5', componentProductId: 'product-2199', quantity: '5' },
      { listingItemId: 'offer-2084-x10', componentProductId: 'product-2084', quantity: '10' },
      { listingItemId: 'offer-2084-x20', componentProductId: 'product-2084', quantity: '20' },
    ];

    assert.equal(
      new Set(compositions.map(({ componentProductId }) => componentProductId)).size,
      2,
    );
    assert.deepEqual(
      compositions
        .filter(({ componentProductId }) => componentProductId === 'product-2199')
        .map(({ quantity }) => quantity),
      ['1', '5'],
    );
    assert.deepEqual(
      compositions
        .filter(({ componentProductId }) => componentProductId === 'product-2084')
        .map(({ quantity }) => quantity),
      ['10', '20'],
    );
  });

  it('allows several components in one offer without requiring a Product on equivalence', () => {
    const kit: CompositionFixture[] = [
      { listingItemId: 'offer-kit', componentProductId: 'product-a', quantity: '1' },
      { listingItemId: 'offer-kit', componentProductId: 'product-b', quantity: '2.5' },
    ];
    const listingEquivalence = modelBlock('ListingEquivalence');

    assert.equal(new Set(kit.map(({ listingItemId }) => listingItemId)).size, 1);
    assert.equal(new Set(kit.map(({ componentProductId }) => componentProductId)).size, 2);
    assert.doesNotMatch(listingEquivalence, /productId|componentProductId/);
    assert.match(
      migration,
      /"offer_compositions_current_component_key"[\s\S]*?"marketplace_listing_item_id", "component_product_id"/,
    );
  });

  it('declares decimal positive quantities, history, and sanitized optional evidence', () => {
    const offerComposition = modelBlock('OfferComposition');

    assert.match(offerComposition, /quantity\s+Decimal\s+@db\.Decimal\(30, 10\)/);
    assert.match(offerComposition, /validFrom\s+DateTime/);
    assert.match(offerComposition, /validTo\s+DateTime\?/);
    assert.match(offerComposition, /evidence\s+Json\?/);
    assert.match(
      migration,
      /"offer_compositions_quantity_check" CHECK \("quantity" > 0\)/,
    );
    assert.match(migration, /"offer_compositions_validity_check" CHECK/);
    assert.match(migration, /"offer_compositions_current_component_key"/);
  });

  it('prevents self-equivalence and a current duplicate in either direction', () => {
    assert.match(migration, /"listing_equivalences_distinct_items_check" CHECK/);
    assert.match(
      migration,
      /LEAST\("left_listing_item_id", "right_listing_item_id"\)/,
    );
    assert.match(
      migration,
      /GREATEST\("left_listing_item_id", "right_listing_item_id"\)/,
    );
    assert.match(migration, /WHERE "valid_to" IS NULL;/);
  });

  it('is additive and leaves ProductExternalIdentity as a base Product identity', () => {
    const statements = withoutSqlComments(migration);
    const identity = modelBlock('ProductExternalIdentity');

    assert.doesNotMatch(
      statements,
      /^\s*(ALTER\s+TABLE|INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|DROP\s+|TRUNCATE\s+)/im,
    );
    assert.doesNotMatch(statements, /product_external_identities/i);
    assert.match(identity, /productId\s+String\s+@map\("product_id"\)/);
    assert.match(identity, /externalListingId\s+String\?/);
    assert.doesNotMatch(identity, /OfferComposition|ListingEquivalence/);
  });
});

function modelBlock(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `model ${name} must exist in schema.prisma`);
  return match[0];
}

function withoutSqlComments(sql: string): string {
  return sql.replace(/^\s*--.*$/gm, '');
}
