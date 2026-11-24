// Lint do portal: regras da raiz + globais de navegador.
import globals from 'globals';
import root from '../../eslint.config.js';

export default [
  { ignores: ['.next/**', 'next-env.d.ts'] },
  ...root,
  { files: ['**/*.{ts,tsx}'], languageOptions: { globals: { ...globals.browser, ...globals.node } } },
];
