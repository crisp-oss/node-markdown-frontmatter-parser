# node-markdown-frontmatter-parser

[![Test and Build](https://github.com/crisp-oss/markdown-frontmatter-parser/actions/workflows/test.yml/badge.svg)](https://github.com/crisp-oss/markdown-frontmatter-parser/actions/workflows/test.yml) [![Build and Release](https://github.com/crisp-oss/markdown-frontmatter-parser/actions/workflows/build.yml/badge.svg)](https://github.com/crisp-oss/markdown-frontmatter-parser/actions/workflows/build.yml) [![NPM](https://img.shields.io/npm/v/markdown-frontmatter-parser.svg)](https://www.npmjs.com/package/markdown-frontmatter-parser) [![Downloads](https://img.shields.io/npm/dt/markdown-frontmatter-parser.svg)](https://www.npmjs.com/package/markdown-frontmatter-parser)

**Markdown Frontmatter parser for Node. Can be used to extract metadata as key-value in Frontmatter headers in your Markdown files.**

This library was converted from Rust code, from the original library: [imbolc/markdown-frontmatter](https://github.com/imbolc/markdown-frontmatter). All credits for the original implementation go to the Rust `markdown-frontmatter` library.

**🇵🇹 Crafted in Lisbon, Portugal.**

## How to install?

Include `markdown-frontmatter-parser` in your `package.json` dependencies.

Alternatively, you can run `npm install markdown-frontmatter-parser --save`.

## How to use?

Then, you can import `markdown-frontmatter-parser` and extract metadata:

```js
import { parse } from "markdown-frontmatter-parser";

const markdownWithFrontmatter = `---
title = "Hello World"
tags = ["news", "tech"]
---
Body content here.
`;

const [headers, body] = parse(markdownWithFrontmatter);

console.log(headers.title); // "Hello World"
console.log(headers.tags);  // ["news", "tech"]
```
