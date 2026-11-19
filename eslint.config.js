// Configuração de lint da raiz do monorepo (flat config, ESM).
// Vale para apps/, packages/ e db/. services/ (Python), bench/ e dados ficam fora.
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

// Proibido ler a hora do sistema direto: quem precisa de tempo recebe um Clock injetado.
const hora = "Injete Clock; não leia a hora do sistema direto.";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "services/**",
      "bench/**",
      "dev-data/**",
      "postman/**",
    ],
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      "no-console": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: hora,
        },
        {
          selector:
            "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: hora,
        },
      ],
    },
  },
  {
    files: [
      "**/clock.ts",
      "**/*.test.ts",
      "**/test/**",
      "**/scripts/**",
    ],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
);
