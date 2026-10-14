/**
 * Naming rules only. Reused by .eslintrc.js and runnable on their own:
 *   npm run lint:naming   (also checks file names, selectors and structure: scripts/check-naming.js)
 * Conventions: docs/UI-GUIDE.md#naming-and-structure
 */
module.exports = {
  root: true,
  overrides: [
    {
      files: ['*.ts'],
      parser: '@typescript-eslint/parser',
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
      plugins: ['@typescript-eslint', '@angular-eslint'],
      rules: {
        '@angular-eslint/component-class-suffix': ['error', { suffixes: ['Component'] }],
        '@angular-eslint/directive-class-suffix': ['error', { suffixes: ['Directive'] }],
        '@typescript-eslint/naming-convention': [
          'error',
          { selector: 'typeLike', format: ['PascalCase'] },
          { selector: 'interface', format: ['PascalCase'], custom: { regex: '^I[A-Z]', match: false } },
          { selector: 'enumMember', format: ['UPPER_CASE', 'PascalCase'] },
          { selector: 'function', format: ['camelCase'] },
          {
            selector: 'variable',
            modifiers: ['exported', 'const'],
            format: ['UPPER_CASE', 'camelCase'],
            leadingUnderscore: 'allow'
          }
        ],
      }
    }
  ]
};
module.exports.rules = module.exports.overrides[0].rules;
