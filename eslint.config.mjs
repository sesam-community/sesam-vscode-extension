import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Enforce braces around every if / else / for / while body
      curly: ["error", "all"],
    },
  },
  {
    ignores: ["**/dist/**", "**/*.js"],
  },
);
