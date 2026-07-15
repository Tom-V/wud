const js = require("@eslint/js");
const pluginVue = require("eslint-plugin-vue");
const vuePrettier = require("@vue/eslint-config-prettier");
const {
  defineConfigWithVueTs,
  vueTsConfigs,
} = require("@vue/eslint-config-typescript");

module.exports = [
  {
    ignores: ["coverage/**", "dist/**", "dist-check/**", "node_modules/**"],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
  },
  {
    files: [
      "*.config.js",
      "eslint.config.js",
      "tests/mocks/**/*.js",
    ],
    languageOptions: {
      globals: {
        module: "readonly",
        process: "readonly",
        require: "readonly",
      },
    },
  },
  ...defineConfigWithVueTs(
    js.configs.recommended,
    pluginVue.configs["flat/essential"],
    vueTsConfigs.recommended,
    vuePrettier,
    {
      rules: {
        "no-console": process.env.NODE_ENV === "production" ? "warn" : "off",
        "no-debugger": process.env.NODE_ENV === "production" ? "warn" : "off",
        "no-unused-vars": "off",
        "@typescript-eslint/no-empty-object-type": "off",
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-require-imports": "off",
        "@typescript-eslint/no-unused-vars": "off",
        "prettier/prettier": "off",
      },
    },
  ),
];
