import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**"]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-misused-promises": "off"
    }
  },
  {
    files: ["public/**/*.js"],
    languageOptions: {
      globals: {
        BarcodeDetector: "readonly",
        Image: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        clearInterval: "readonly",
        clearTimeout: "readonly",
        crypto: "readonly",
        document: "readonly",
        fetch: "readonly",
        navigator: "readonly",
        requestAnimationFrame: "readonly",
        setInterval: "readonly",
        setTimeout: "readonly",
        window: "readonly"
      }
    }
  }
);
