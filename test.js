// reseed-products.js

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  //
  // ── 1. WIPE ALL EXISTING PRODUCTS AND DEPENDENT STOCKS ────────────────────────
  //
  console.log('🗑  Deleting existing products and stocks…');

  await prisma.stockCheck.deleteMany();
  await prisma.saleItem.deleteMany();
  await prisma.branchStock.deleteMany();
  const deleted = await prisma.product.deleteMany();
  console.log(`   • Deleted ${deleted.count} products.`);

  //
  // ── 2. READ CLEAN LIST AND RE‐INSERT INTO EACH BRANCH ────────────────────────
  //
  console.log('📂 Reading cleaned_products.txt…');
  const filePath = path.join(__dirname, 'cleaned_products.txt');
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n');

  // Fetch a default Category and all Branches
  const defaultCategory = await prisma.category.findFirst();
  if (!defaultCategory) {
    throw new Error('No Category found. Create at least one first.');
  }
  const branches = await prisma.branch.findMany();
  if (branches.length === 0) {
    throw new Error('No Branch found. Create at least one first.');
  }

  // Regex to allow only letters, digits, spaces, common punctuation, and Spanish accents
  const spanishNameRegex = /^[A-Za-z0-9\s\-\–\(\)\,\.&'\/áéíóúÁÉÍÓÚñÑüÜ¿¡]+$/;

  // Regex to detect purely numeric names or names like "50 g", "100gr"
  const onlyDigitsOrWeight = /^\s*\d+(\s*(g|gr|kg|ml))?\s*$/i;

  let insertedCount = 0;
  let skippedCount = 0;
  let weirdCount = 0;

  console.log(`➡️  Re‐inserting products into ${branches.length} branch(es)…`);

  for (let rawLine of lines) {
    const line = rawLine.trim();
    if (!line || /^[-+]+$/.test(line)) continue;

    const parts = line.split('|');
    if (parts.length !== 2) {
      skippedCount++;
      continue;
    }

    const name = parts[0].trim();
    const barcode = parts[1].trim();
    if (!barcode) {
      skippedCount++;
      continue;
    }

    // Skip if name equals barcode
    if (name === barcode) {
      console.log(`🚫 Skipping (name == barcode): "${name}"`);
      weirdCount++;
      continue;
    }

    // Skip if name is only digits or a weight (e.g. "50 g", "100gr")
    if (onlyDigitsOrWeight.test(name)) {
      console.log(`🚫 Skipping (only digits/weight): "${name}"`);
      weirdCount++;
      continue;
    }

    // Skip if name contains disallowed characters
    if (!spanishNameRegex.test(name)) {
      console.log(`🚫 Skipping (weird chars): "${name}"`);
      weirdCount++;
      continue;
    }

    for (let branch of branches) {
      try {
        const created = await prisma.product.create({
          data: {
            name,
            barcode,
            description: null,
            price: 0.0,
            categoryId: defaultCategory.id,
            branchId: branch.id,
            supplierId: null
          },
        });

        // Generate random stock quantity between 10 and 30
        const quantity = Math.floor(Math.random() * 21) + 10;

        await prisma.branchStock.create({
          data: {
            branchId: branch.id,
            productId: created.id,
            quantity,
          },
        });

        insertedCount++;
        console.log(`✅ [Branch ${branch.id}] Inserted: ${barcode} → "${name}" (stock: ${quantity})`);
      } catch (e) {
        console.log(`⚠️ [Branch ${branch.id}] Could not insert ${barcode} → "${name}": ${e.message}`);
        skippedCount++;
      }
    }
  }

  console.log('\n🎉  Done!');
  console.log(`   • Total inserted across all branches: ${insertedCount}`);
  console.log(`   • Total skipped (malformed / duplicates): ${skippedCount}`);
  console.log(`   • Total weird‐name skipped: ${weirdCount}`);
}

main()
  .catch((e) => {
    console.error('❌  Error in reseed-products.js:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
