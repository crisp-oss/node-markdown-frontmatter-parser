# node-markdown-frontmatter-parser

[![Test and Build](https://github.com/crisp-oss/node-markdown-frontmatter-parser/actions/workflows/test.yml/badge.svg)](https://github.com/crisp-oss/node-markdown-frontmatter-parser/actions/workflows/test.yml) [![Build and Release](https://github.com/crisp-oss/node-markdown-frontmatter-parser/actions/workflows/build.yml/badge.svg)](https://github.com/crisp-oss/node-markdown-frontmatter-parser/actions/workflows/build.yml) [![NPM](https://img.shields.io/npm/v/markdown-frontmatter-parser.svg)](https://www.npmjs.com/package/markdown-frontmatter-parser) [![Downloads](https://img.shields.io/npm/dt/markdown-frontmatter-parser.svg)](https://www.npmjs.com/package/markdown-frontmatter-parser)

**Markdown Frontmatter parser for Node. Can be used to extract metadata as key-value in Frontmatter headers in your Markdown files.**

This library was converted from Rust code, from the original library: [imbolc/markdown-frontmatter](https://github.com/imbolc/markdown-frontmatter). All credits for the original implementation go to the Rust `markdown-frontmatter` library.

**🇵🇹 Crafted in Lisbon, Portugal.**

## How to install?

Include `markdown-frontmatter-parser` in your `package.json` dependencies.

Alternatively, you can run `npm install markdown-frontmatter-parser --save`.

## How to use?

### Parse a Markdown with Frontmatter

Extract metadata and body from a markdown document. Returns `[{}, fullContent]` when no frontmatter is found. All metadata keys are lowercased.

Supports YAML (`---`), TOML (`+++`), and JSON (`{`) frontmatter.

```js
import { parse } from "markdown-frontmatter-parser";

const markdownWithFrontmatter = `---
title: Hello World
tags:
  - news
  - tech
---
Body content here.
`;

const [headers, body] = parse(markdownWithFrontmatter);

console.log(headers.title); // "Hello World"
console.log(headers.tags);  // ["news", "tech"]
console.log(body);          // "Body content here.\n"
```

### Parse a Markdown with Frontmatter, with typed fields

By default, `parse` returns every value as-is from the raw frontmatter (a string stays a string, a number stays a number, etc.). If you need to force specific fields to a particular type — for example, a field that arrives as the string `"42"` but should be the number `42` — pass a `types` map as the second argument.

**Available types:** `"string"`, `"number"`, `"boolean"`, or an array variant like `["string"]`, `["number"]`, `["boolean"]` for fields that are lists.

**Boolean casting** accepts: `true`/`false`, `"true"`/`"false"`, `"yes"`/`"no"`, `1`/`0`, `"1"`/`"0"`.

**On cast failure**, a `TypeCastError` is thrown by default. Pass `throwing: false` to silently keep the original value instead.

```js
import { parse } from "markdown-frontmatter-parser";

const doc = `---
title: Hello World
count: "42"
active: "yes"
tags:
  - foo
  - bar
scores:
  - "10"
  - "20"
---
Body content here.
`;

const [headers, body] = parse(doc, {
  types: {
    count:   "number",    // "42"   → 42
    active:  "boolean",   // "yes"  → true
    tags:    ["string"],  // already strings, no-op but explicit
    scores:  ["number"],  // ["10", "20"] → [10, 20]
  },
});

console.log(headers.count);   // 42
console.log(headers.active);  // true
console.log(headers.tags);    // ["foo", "bar"]
console.log(headers.scores);  // [10, 20]

// Keep original value when a cast fails, instead of throwing:
const [headers2] = parse(doc, {
  types: { count: "boolean" }, // "42" can't be cast to boolean
  throwing: false,             // → keeps "42" as-is
});

console.log(headers2.count); // "42"
```

### Generate Markdown and Frontmatter content from object

Serialize metadata and content into a markdown string with a frontmatter header. Defaults to YAML format. A blank line is inserted between the header and the body.

```js
import { generate } from "markdown-frontmatter-parser";

const doc = generate(
  { title: "Hello World", tags: ["news", "tech"] },
  "Body content here.\n"
);

// ---
// title: Hello World
// tags:
//   - news
//   - tech
// ---
//
// Body content here.

// Pass a second format argument to use TOML or JSON instead:
const tomlDoc = generate({ title: "Hello" }, "Body.\n", "toml");
```

### Lint a Markdown with Frontmatter (fixing it if needed)

Normalize a markdown document by re-serializing its frontmatter in canonical form: keys lowercased, consistent delimiters, and a blank line between header and body. Returns the content unchanged when no frontmatter is detected.

Pass a `format` argument to convert to a different frontmatter format.

```js
import { lint } from "markdown-frontmatter-parser";

const messy = `---
Title: Hello World
TAGS: [news, tech]
---
Body content here.
`;

console.log(lint(messy));
// ---
// title: Hello World
// tags:
//   - news
//   - tech
// ---
//
// Body content here.

// Convert YAML frontmatter to TOML:
console.log(lint(messy, "toml"));
// +++
// title = "Hello World"
// tags = ["news", "tech"]
// +++
//
// Body content here.
```
