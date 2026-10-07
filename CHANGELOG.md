# Changelog

## 0.1.0

First release.

**Import case check (`case`)**
- Detects imports whose letter case doesn't match the file on disk, and files whose names differ only by case
- Relative imports, tsconfig/jsconfig path aliases, SvelteKit `$lib`, per-app config in monorepos
- `.js .jsx .ts .tsx .mjs .cjs .mts .cts .svelte .vue`
- `--fix` rewrites imports with the on-disk casing

**Environment variable check (`env`)**
- Finds variables used in code but missing from `.env.example`, and unused documented ones
- Node.js, Vite, SvelteKit `$env`, Bun, Deno, Python and Prisma
- Per-folder example files for monorepos
- Flags real `.env` files that are committed or missing from `.gitignore`
- `--fix` appends missing variables with a note on where each is used

**General**
- `--only` / `--skip`, `--strict`, text, JSON and GitHub Actions annotation output
- GitHub Action
