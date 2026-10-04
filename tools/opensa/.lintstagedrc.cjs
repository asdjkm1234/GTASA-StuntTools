module.exports = {
  '*.md': ['prettier --write'],
  // `.mjs`/`.cjs` are here because `tools-debug/` writes plain node scripts on purpose (they must run on a
  // tree too broken for TypeScript), and a folder whose files skip the hooks drifts from the rest quietly.
  '*.{ts,tsx,json,mjs,cjs}': ['prettier --write', 'eslint --fix'],
  '*.{ts,tsx}': [() => 'npm run lint:ts'],
};
