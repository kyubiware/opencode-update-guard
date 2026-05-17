export default {
  "*.{js,cjs,mjs}": "biome check --fix --no-errors-on-unmatched",
  "*.ts": [
    "biome check --fix --no-errors-on-unmatched",
    () => "tsc --noEmit",
    () => "tsc",
  ],
  "src/config.ts": () => "node bin/generate-schema.cjs",
}
