# node-markdown-frontmatter-parser

TypeScript library that parses YAML, TOML, and JSON frontmatter from Markdown documents. Ported from the Rust [`markdown-frontmatter`](https://github.com/imbolc/markdown-frontmatter) crate.

## Commands

```sh
npm test          # run tests (vitest)
npm run build     # compile to dist/ (ESM + CJS + .d.ts)
npm run typecheck # type-check without emitting
```

## Structure

```
src/index.ts       # all library code (single file)
src/index.test.ts  # all tests
dist/              # build output (gitignored)
```

## Rules

- After every code change, run `npm t` and ensure all tests pass before considering the task done.

## Key facts

- **Entry point**: `src/index.ts` — exports `parse`, `split`, `lineSpans`, error classes, and types.
- **Formats**: JSON (`{…}`), TOML (`+++…+++`), YAML (`---…---`). All always enabled — no feature flags.
- **No frontmatter**: `parse()` returns `[{}, fullContent]` instead of throwing.
- **Errors**: `AbsentClosingDelimiterError`, `InvalidJsonError`, `InvalidTomlError`, `InvalidYamlError` — all extend `FrontmatterError`.
- **Runtime types**: No runtime type validation; `parse<T>()` is a cast, not a validator.
- **Dependencies**: `js-yaml` (YAML), `smol-toml` (TOML). JSON is built-in.
- **Target**: ES2022 (required for `Error.cause`).
