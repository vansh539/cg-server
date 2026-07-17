'use strict';

// One-off import of the item catalog from "Stock Items .xlsx" (on Desktop)
// into app/data/stock.json, via stockStore's real API — not a raw file
// write — so category dedup, item dedup, and movement logging all go
// through the same validated paths the running app uses.
//
// Source Excel structure (4 sheets, one per category):
//   PIPES   — ITEM (size, e.g. "20X20"), WEIGHT/PC (KGS), THICKNESS (MM).
//             The same size repeats across multiple thicknesses with a
//             different weight each time, so the imported item name is
//             "<size> (<thickness>mm)" to disambiguate — plain "<size>"
//             alone is not unique in this sheet.
//   SECTION, RING, TMT — a single ITEM column, no weight/quantity data at
//             all: this file is a name catalog, not a stock-count
//             snapshot. Imported with weightPerPieceKg: null (pieces
//             shows "—" until someone sets it) and 0 initial stock.
//
// Every item imports at 0 kg — real on-hand quantities still need to be
// entered via Stock In once the shop does a physical count. Re-running
// this script is safe: existing items (matched by name within their
// category) are left untouched, never re-created or overwritten — this
// script only ever adds categories/items that don't already exist.

const path = require('path');
const { createStore } = require('../stockStore');

const CATALOG = require(path.join(__dirname, 'stock-import-data.json'));

function main() {
  const store = createStore(path.join(__dirname, '..', 'data', 'stock.json'));
  store.init();

  let categoriesCreated = 0;
  let itemsCreated = 0;
  let itemsSkipped = 0;

  for (const [categoryName, items] of Object.entries(CATALOG)) {
    let category = store.listCategories().find((c) => c.name.toLowerCase() === categoryName.toLowerCase());
    if (!category) {
      category = store.addCategory(categoryName);
      categoriesCreated++;
      console.log(`[import] Created category: ${categoryName}`);
    }

    const existingNames = new Set(
      store
        .listItems()
        .filter((i) => i.categoryId === category.id)
        .map((i) => i.name.toLowerCase())
    );

    for (const item of items) {
      if (existingNames.has(item.name.toLowerCase())) {
        itemsSkipped++;
        continue;
      }
      store.addItem({
        categoryId: category.id,
        name: item.name,
        weightPerPieceKg: item.weightPerPieceKg,
        initialStockKg: 0,
      });
      itemsCreated++;
    }
  }

  console.log(`[import] Done. Categories created: ${categoriesCreated}. Items created: ${itemsCreated}. Items skipped (already existed): ${itemsSkipped}.`);
}

main();
