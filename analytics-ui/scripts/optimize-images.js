#!/usr/bin/env node
/**
 * Build step: compresses the PNG screenshots referenced in cumulocity.config.ts
 * into ../resources/images-optimized/ (generated, gitignored) without touching
 * the originals in ../resources/images/. cumulocity.config.ts's buildTime.copy
 * list points at the optimized directory, so `npm run build` picks these up.
 *
 * Runs automatically via the "prestart" and "prebuild" npm scripts. Source files
 * are skipped if an up-to-date optimized copy already exists.
 *
 * Screenshots are captured on a retina display at ~3400px wide; they are
 * downscaled to MAX_WIDTH because the extra pixels are never displayed and only
 * inflate the deployable zip.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const UI_ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(UI_ROOT, 'cumulocity.config.ts');
const SOURCE_DIR = path.resolve(UI_ROOT, '../resources/images');
const OUTPUT_DIR = path.resolve(UI_ROOT, '../resources/images-optimized');

/** Images narrower than this are left alone (withoutEnlargement). */
const MAX_WIDTH = 1600;

function extractImageFilenames(configSource) {
  const regex = /['"]\.\.\/resources\/images-optimized\/([^'"]+\.png)['"]/g;
  const names = new Set();
  let match;
  while ((match = regex.exec(configSource)) !== null) {
    names.add(match[1]);
  }
  return [...names];
}

async function optimizeOne(filename) {
  const srcPath = path.join(SOURCE_DIR, filename);
  const outPath = path.join(OUTPUT_DIR, filename);

  if (!fs.existsSync(srcPath)) {
    throw new Error(`${filename} is referenced in cumulocity.config.ts but missing from resources/images/`);
  }
  const srcStat = fs.statSync(srcPath);
  if (fs.existsSync(outPath)) {
    const outStat = fs.statSync(outPath);
    const width = (await sharp(outPath).metadata()).width ?? 0;
    if (outStat.mtimeMs >= srcStat.mtimeMs && width <= MAX_WIDTH) {
      return { filename, skipped: true, before: srcStat.size, after: outStat.size };
    }
  }

  await sharp(srcPath)
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .png({ quality: 80, palette: true, compressionLevel: 9 })
    .toFile(outPath);

  return { filename, skipped: false, before: srcStat.size, after: fs.statSync(outPath).size };
}

async function main() {
  const filenames = extractImageFilenames(fs.readFileSync(CONFIG_PATH, 'utf8'));
  if (filenames.length === 0) {
    console.log('[optimize-images] no images referenced in cumulocity.config.ts, skipping');
    return;
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Prune leftovers of renamed/deleted screenshots so they don't keep shipping in the zip.
  const expected = new Set(filenames);
  const pruned = fs
    .readdirSync(OUTPUT_DIR)
    .filter((f) => f.toLowerCase().endsWith('.png') && !expected.has(f));
  for (const filename of pruned) {
    fs.unlinkSync(path.join(OUTPUT_DIR, filename));
  }
  if (pruned.length > 0) {
    console.log(`[optimize-images] pruned ${pruned.length} unreferenced: ${pruned.join(', ')}`);
  }

  const results = [];
  for (const filename of filenames) {
    results.push(await optimizeOne(filename));
  }

  const optimized = results.filter((r) => !r.skipped);
  const totalBefore = results.reduce((sum, r) => sum + r.before, 0);
  const totalAfter = results.reduce((sum, r) => sum + r.after, 0);
  const pct = totalBefore > 0 ? Math.round((1 - totalAfter / totalBefore) * 100) : 0;
  console.log(
    `[optimize-images] ${optimized.length} optimized, ${results.length - optimized.length} cached ` +
      `(${(totalBefore / 1024 / 1024).toFixed(1)}MB -> ${(totalAfter / 1024 / 1024).toFixed(1)}MB, -${pct}%)`
  );
}

main().catch((err) => {
  console.error('[optimize-images] failed:', err);
  process.exit(1);
});
