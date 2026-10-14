#!/usr/bin/env node
/**
 * Checks the file/folder/selector naming and structure rules that ESLint cannot express.
 * Class/type/constant naming is covered by .eslintrc.naming.js. Rules: docs/UI-GUIDE.md#naming-and-structure
 *
 *   node scripts/check-naming.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const SELECTOR_PREFIX = 'a17t';
const ENTRY_FILES = new Set(['main.ts', 'bootstrap.ts', 'polyfills.ts', 'i18n.ts', 'app.config.ts', 'index.ts']);
const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
// suffix -> [decorator, class suffix]
const KINDS = {
  component: ['Component', 'Component'],
  service: ['Injectable', 'Service'],
  factory: ['Injectable', 'Factory'],
  interceptor: ['Injectable', 'Interceptor'],
  module: ['NgModule', 'Module']
};

const toPascal = kebab => kebab.split('-').map(p => p[0].toUpperCase() + p.slice(1)).join('');
const errors = [];
const fail = (file, message) => errors.push(`${path.relative(path.join(SRC, '..'), file)}: ${message}`);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? [{ dir: full }, ...walk(full)] : [{ file: full }];
  });
}

const entries = walk(SRC);
const classOwners = new Map();

for (const { dir } of entries.filter(e => e.dir)) {
  const name = path.basename(dir);
  if (!KEBAB.test(name)) fail(dir, `folder "${name}" must be kebab-case`);
  if (name === path.basename(path.dirname(dir))) fail(dir, `folder "${name}" repeats its parent's name`);
}

for (const { file } of entries.filter(e => e.file && e.file.endsWith('.ts') && !e.file.endsWith('.d.ts'))) {
  const base = path.basename(file);
  const isSpec = base.endsWith('.spec.ts');

  if (isSpec) {
    if (!fs.existsSync(file.replace(/\.spec\.ts$/, '.ts'))) fail(file, 'spec has no source file next to it');
    continue;
  }
  if (ENTRY_FILES.has(base)) continue;

  const stem = base.replace(/\.ts$/, '');
  const [name, ...kinds] = stem.split('.');
  if (!KEBAB.test(name) || kinds.some(k => !/^[a-z]+$/.test(k))) {
    fail(file, `file name must be kebab-case with optional lowercase ".kind" suffixes`);
    continue;
  }

  const text = fs.readFileSync(file, 'utf8');
  const kind = kinds[kinds.length - 1];
  const rule = KINDS[kind];

  // every exported class must be unique across the app
  for (const [, className] of text.matchAll(/^export (?:abstract )?class (\w+)/gm)) {
    if (classOwners.has(className)) fail(file, `class ${className} is also exported by ${classOwners.get(className)}`);
    classOwners.set(className, path.relative(SRC, file));
  }

  if (!rule) continue;
  const [decorator, suffix] = rule;
  const match = text.match(new RegExp(`@${decorator}\\([\\s\\S]*?\\)\\s*\\nexport (?:abstract )?class (\\w+)`));
  if (!match) {
    fail(file, `a ".${kind}.ts" file must contain an exported class decorated with @${decorator}`);
    continue;
  }
  const expected = toPascal(name) + suffix;
  // compared case-insensitively so brand names like GitHub stay valid (file: github-*, class: GitHub*)
  if (match[1].toLowerCase() !== expected.toLowerCase()) fail(file, `class is ${match[1]} but file name requires ${expected}`);

  if (kind === 'component') {
    const selector = text.match(/selector:\s*'([^']+)'/);
    // Components without a selector (cell renderers, modals opened by service) are allowed
    if (selector && selector[1] !== `${SELECTOR_PREFIX}-${name}`) {
      fail(file, `selector is '${selector[1]}' but must be '${SELECTOR_PREFIX}-${name}'`);
    }
  }
}

if (errors.length) {
  console.error(`Naming check failed (${errors.length}):\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.log('Naming check passed.');
