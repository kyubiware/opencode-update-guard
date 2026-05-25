export default {
  "*.{js,cjs,mjs}": "biome check --fix --no-errors-on-unmatched",
  "src/**/*.ts": [
    "biome check --fix --no-errors-on-unmatched",
    () => "tsc",
  ],
  "src/config.ts": () => "node bin/generate-schema.cjs",
  "src/**/*.{js,ts}": () => "vitest run",
}
