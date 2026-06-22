/*
 * node-markdown-frontmatter-parser
 *
 * Copyright 2026, Valerian Saliou
 * Author: Valerian Saliou <valerian@valeriansaliou.name>
 */

import * as yaml from "js-yaml";
import { parse as parseTomlStr } from "smol-toml";

/** The format of the frontmatter. */
export type FrontmatterFormat = "json" | "toml" | "yaml";

const FORMAT_DELIMITERS: Record<FrontmatterFormat, [string, string]> = {
  json: ["{", "}"],
  toml: ["+++", "+++"],
  yaml: ["---", "---"],
};

const FORMAT_NAMES: Record<FrontmatterFormat, string> = {
  json: "JSON",
  toml: "TOML",
  yaml: "YAML",
};

const ALL_FORMATS: FrontmatterFormat[] = ["json", "toml", "yaml"];

/** Base class for all frontmatter errors. */
export class FrontmatterError extends Error {}

/** Thrown when the closing delimiter is absent. */
export class AbsentClosingDelimiterError extends FrontmatterError {
  readonly format: FrontmatterFormat;
  constructor(format: FrontmatterFormat) {
    super(`absent closing ${FORMAT_NAMES[format]} delimiter`);
    this.name = "AbsentClosingDelimiterError";
    this.format = format;
  }
}

/** Thrown on invalid JSON syntax. */
export class InvalidJsonError extends FrontmatterError {
  constructor(cause?: unknown) {
    super("invalid JSON syntax");
    this.name = "InvalidJsonError";
    if (cause !== undefined) this.cause = cause;
  }
}

/** Thrown on invalid TOML syntax. */
export class InvalidTomlError extends FrontmatterError {
  constructor(cause?: unknown) {
    super("invalid TOML syntax");
    this.name = "InvalidTomlError";
    if (cause !== undefined) this.cause = cause;
  }
}

/** Thrown on invalid YAML syntax. */
export class InvalidYamlError extends FrontmatterError {
  constructor(cause?: unknown) {
    super("invalid YAML syntax");
    this.name = "InvalidYamlError";
    if (cause !== undefined) this.cause = cause;
  }
}

/** A line with its character-position span within the source string. */
export interface LineSpan {
  /** Start position of the line content (excluding any preceding newline). */
  start: number;
  /** Start position of the next line (i.e. after the line ending). */
  nextStart: number;
  /** The line content, without the line ending. */
  line: string;
}

/** Iterates over lines in a string, yielding each line with its span. Handles both CRLF and LF. */
export function* lineSpans(s: string): Generator<LineSpan> {
  let pos = 0;
  while (pos < s.length) {
    const start = pos;
    let i = start;
    while (i < s.length && s[i] !== "\n" && s[i] !== "\r") {
      i++;
    }
    const lineEnd = i;
    if (i < s.length && s[i] === "\r") {
      i++;
      if (i < s.length && s[i] === "\n") i++;
    } else if (i < s.length && s[i] === "\n") {
      i++;
    }
    const nextStart = i;
    pos = i;
    yield { start, nextStart, line: s.slice(start, lineEnd) };
  }
}

/** The raw frontmatter extracted by {@link split}. */
export interface SplitResult {
  /** The detected frontmatter format. */
  format: FrontmatterFormat;
  /** The raw frontmatter string (including delimiters for JSON, excluding for TOML/YAML). */
  raw: string;
}

function detectFormat(firstLine: string): FrontmatterFormat | null {
  return ALL_FORMATS.find((f) => firstLine === FORMAT_DELIMITERS[f][0]) ?? null;
}

/**
 * Splits a document into raw frontmatter and body without parsing the frontmatter.
 *
 * Returns `[null, body]` when no frontmatter is found.
 * Throws {@link AbsentClosingDelimiterError} when an opening delimiter has no closing match.
 */
export function split(content: string): [SplitResult | null, string] {
  const trimmed = content.trimStart();
  const iter = lineSpans(trimmed);

  const first = iter.next();
  if (first.done) return [null, trimmed];

  const span = first.value;
  const format = detectFormat(span.line);
  if (format === null) return [null, trimmed];

  // JSON includes the opening `{`; TOML/YAML skip the opening delimiter line.
  const matterStart = format === "json" ? span.start : span.nextStart;
  const closingDelimiter = FORMAT_DELIMITERS[format][1];

  for (const s of iter) {
    if (s.line !== closingDelimiter) continue;
    // JSON includes the closing `}` line; TOML/YAML exclude it.
    const [raw, body] =
      format === "json"
        ? [trimmed.slice(matterStart, s.nextStart), trimmed.slice(s.nextStart)]
        : [trimmed.slice(matterStart, s.start), trimmed.slice(s.nextStart)];
    return [{ format, raw }, body];
  }

  throw new AbsentClosingDelimiterError(format);
}

function parseMatter(
  format: FrontmatterFormat,
  raw: string
): Record<string, unknown> {
  switch (format) {
    case "json":
      try {
        return JSON.parse(raw) as Record<string, unknown>;
      } catch (e) {
        throw new InvalidJsonError(e);
      }
    case "toml":
      try {
        return parseTomlStr(raw) as Record<string, unknown>;
      } catch (e) {
        throw new InvalidTomlError(e);
      }
    case "yaml": {
      let result: unknown;
      try {
        result = yaml.load(raw);
      } catch (e) {
        throw new InvalidYamlError(e);
      }
      if (result === null || result === undefined) return {};
      return result as Record<string, unknown>;
    }
  }
}

/**
 * Parses frontmatter from a markdown string, returning the parsed frontmatter
 * and the body of the document.
 *
 * When the document has no frontmatter, an empty object is returned as the
 * frontmatter and the full content is returned as the body.
 *
 * @example
 * ```ts
 * import { parse } from "markdown-frontmatter-parser";
 *
 * const doc = `---
 * title: Hello
 * ---
 * World
 * `;
 *
 * const [frontmatter, body] = parse(doc);
 * console.log(frontmatter.title); // "Hello"
 * console.log(body);              // "World\n"
 * ```
 */
export function parse<T = Record<string, unknown>>(content: string): [T, string] {
  const [maybeFrontmatter, body] = split(content);
  if (maybeFrontmatter === null) {
    return [{} as T, body];
  }
  return [parseMatter(maybeFrontmatter.format, maybeFrontmatter.raw) as T, body];
}
