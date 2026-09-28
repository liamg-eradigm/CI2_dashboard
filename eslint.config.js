// Flat ESLint config for the whole monorepo.
//
// Besides normal TypeScript linting, this file enforces the architectural
// boundaries from 4_Backend_Design:
//   * Model-specific SDKs may only be imported inside packages/llm/src/providers.
//   * The dashboard (apps/web) may only depend on the versioned shared contract;
//     it can never import API internals, the LLM adapter, or database code.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

const MODEL_SDKS = ["@anthropic-ai/*", "openai", "@google/generative-ai", "@mistralai/*", "cohere-ai"];

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.wrangler/**",
      "**/worker-configuration.d.ts",
      "playwright-report/**",
      "test-results/**",
      "docs/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        URL: "readonly",
        fetch: "readonly",
        crypto: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        Response: "readonly",
        Request: "readonly",
        Headers: "readonly",
        AbortController: "readonly",
        AbortSignal: "readonly",
        structuredClone: "readonly",
        atob: "readonly",
        btoa: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: MODEL_SDKS,
              message: "Model-specific SDKs are only allowed inside packages/llm/src/providers (LLM container boundary).",
            },
          ],
        },
      ],
    },
  },
  {
    // The only place a model vendor SDK may be imported.
    files: ["packages/llm/src/providers/**/*.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        Blob: "readonly",
        File: "readonly",
        FileReader: "readonly",
        FormData: "readonly",
        HTMLElement: "readonly",
        HTMLInputElement: "readonly",
        KeyboardEvent: "readonly",
        MouseEvent: "readonly",
        Event: "readonly",
        URLSearchParams: "readonly",
      },
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: MODEL_SDKS, message: "The dashboard must never talk to an LLM directly." },
            {
              group: ["@eradigm/llm", "@eradigm/llm/*", "@eradigm/api", "@eradigm/api/*", "**/apps/api/**"],
              message: "apps/web may only import the versioned @eradigm/shared contract.",
            },
          ],
        },
      ],
    },
  },
  {
    // Tests may use loose typing for JSON responses.
    files: ["**/test/**/*.ts", "e2e/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    files: ["scripts/**/*.mjs", "e2e/**/*.ts", "services/**/*.mjs", "*.config.{js,ts,mjs}"],
    languageOptions: {
      globals: { process: "readonly", Buffer: "readonly", console: "readonly", URLSearchParams: "readonly", performance: "readonly" },
    },
  },
);
