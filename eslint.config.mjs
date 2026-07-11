import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // Invariant 3: src/lib is pure. It must load in a Web Worker and in a Node test,
  // so it may not reach for React, Next, the DOM, or any store. Enforced here rather
  // than by convention, because a single stray import silently breaks both.
  {
    files: ["src/lib/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "react",
                "react-*",
                "next",
                "next/*",
                "zustand",
                "zustand/*",
                "framer-motion",
                "@/components/*",
                "@/stores/*",
                "@/app/*",
              ],
              message:
                "src/lib must stay pure: no React, no Next, no stores. It runs in a Web Worker and in Node tests.",
            },
          ],
        },
      ],
    },
  },

  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    "src/components/ui/**",
  ]),
]);

export default eslintConfig;
