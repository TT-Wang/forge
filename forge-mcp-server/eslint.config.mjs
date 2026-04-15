// ESLint flat config — Node.js ESM, forge MCP server.
export default [
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-undef": "error",
      "no-constant-condition": ["error", { checkLoops: false }],
      eqeqeq: ["error", "smart"],
      "prefer-const": "warn",
    },
  },
  {
    ignores: ["node_modules/", "dist/", "coverage/"],
  },
];
