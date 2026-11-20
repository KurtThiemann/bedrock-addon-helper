# bedrock-addon-helper

A CLI tool (`bah`) for building and testing Minecraft Bedrock Edition add-ons.

> v2 is a work in progress. The previous version lives on the `master` branch.

## Requirements

- Node.js 24 or newer
- Docker (for test servers)

## Development

```bash
npm install
npm run dev -- --help   # run the CLI from source
npm test                # unit tests (node:test, runs the .ts files directly)
npm run lint            # Biome lint + format check
npm run typecheck       # tsc, no emit
npm run build           # compile to dist/
```

Source files are TypeScript limited to erasable syntax (no enums, namespaces or
parameter properties), so Node can run them directly without a build step.
Relative imports use the `.ts` extension; `tsc` rewrites them to `.js` on build.
Tests live next to the code as `*.test.ts`.
