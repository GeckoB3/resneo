import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Many screens use plain img for venue logos / CMS URLs; migrate to next/image incrementally.
      "@next/next/no-img-element": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  // P0.1: discourage new hand-rolled modal overlays (use Dialog/Sheet primitives).
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/components/ui/primitives/**",
      "src/components/booking/BookingDetailSurface.tsx",
      "src/components/practitioner-calendar/ClassInstanceDetailSheet.tsx",
    ],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector: "Literal[value=/fixed inset-0/]",
          message:
            "Prefer Dialog or Sheet from @/components/ui/primitives/ instead of hand-rolled modal overlays.",
        },
      ],
    },
  },
    // Konva floor plan: drag uses refs to avoid re-rendering the full canvas every pointer move.
  {
    files: ["src/app/dashboard/settings/floor-plan/KonvaCanvas.tsx"],
    rules: {
      "react-hooks/refs": "off",
    },
  },
  // React Compiler cannot memoize react-hook-form watch(); behaviour is still correct.
  {
    files: ["src/app/dashboard/settings/sections/BookingRulesSection.tsx"],
    rules: {
      "react-hooks/incompatible-library": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local Claude worktrees duplicate the repo; do not lint them.
    ".claude/**",
  ]),
]);

export default eslintConfig;
