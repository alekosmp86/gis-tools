import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Modular monolith boundaries.
 *
 * Layer rules, enforced rather than documented:
 *   core     -> may import core only. No React: it must stay headless so it can one day run
 *               outside the browser and outside Next.
 *   ui-kit   -> may import core and ui-kit.
 *   features -> today's tools and pages; may import core and ui-kit, never modules.
 *   modules  -> may import core, ui-kit and their own folder, never another module.
 *   registry -> the composition root, the single place allowed to name modules.
 *
 * The composition root is deliberately the only exception. Everything else that needs a module
 * receives it through the registry, which is what makes a module deletable.
 */

const MODULE_IMPORT_MESSAGE =
  "Modules may not be imported here. Only the composition root (src/app/modules.registry.ts) may name a module; everything else reaches them through the registry defined in core.";

const CROSS_MODULE_MESSAGE =
  "A module may not import another module. Route the dependency through a contract in src/core/modules so either side stays independently removable.";

const HEADLESS_CORE_MESSAGE =
  "src/core must stay headless. Move anything that renders into src/ui-kit.";

const UPWARD_IMPORT_MESSAGE =
  "Lower layers may not import upward. Core and ui-kit must not depend on application or feature code.";

const restrict = (patterns) => ({
  "no-restricted-imports": ["error", { patterns }],
});

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // core: headless, self-contained.
  {
    files: ["src/core/**/*.{ts,tsx}"],
    rules: restrict([
      { group: ["@/modules", "@/modules/*", "@/modules/**"], message: MODULE_IMPORT_MESSAGE },
      { group: ["react", "react-dom", "react-dom/*", "next/*"], message: HEADLESS_CORE_MESSAGE },
      {
        group: ["@/ui-kit", "@/ui-kit/*", "@/ui-kit/**", "@/components/*", "@/app/*", "@/hooks/*"],
        message: UPWARD_IMPORT_MESSAGE,
      },
    ]),
  },

  // ui-kit: shared presentation, unaware of features and modules.
  {
    files: ["src/ui-kit/**/*.{ts,tsx}"],
    rules: restrict([
      { group: ["@/modules", "@/modules/*", "@/modules/**"], message: MODULE_IMPORT_MESSAGE },
      {
        group: ["@/app/*", "@/components/*", "@/hooks/*", "@/data/*", "@/providers/*"],
        message: UPWARD_IMPORT_MESSAGE,
      },
    ]),
  },

  // modules: may use core and ui-kit, never each other. Within a module, use relative imports,
  // so any absolute @/modules/... import from inside a module is by definition cross-module.
  {
    files: ["src/modules/**/*.{ts,tsx}"],
    rules: restrict([
      { group: ["@/modules", "@/modules/*", "@/modules/**"], message: CROSS_MODULE_MESSAGE },
      {
        group: ["@/app/*", "@/components/*", "@/hooks/*", "@/data/*", "@/providers/*"],
        message: UPWARD_IMPORT_MESSAGE,
      },
    ]),
  },

  // Existing features and pages: core and ui-kit only.
  {
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}", "src/hooks/**/*.{ts,tsx}"],
    rules: restrict([
      { group: ["@/modules", "@/modules/*", "@/modules/**"], message: MODULE_IMPORT_MESSAGE },
    ]),
  },

  // The composition root is the one file permitted to name modules.
  {
    files: ["src/app/modules.registry.ts"],
    rules: { "no-restricted-imports": "off" },
  },

  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "scripts/**",
    "public/**",
  ]),
]);

export default eslintConfig;
