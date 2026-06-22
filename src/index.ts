/*
 * node-markdown-frontmatter-parser
 *
 * Copyright 2026, Valerian Saliou
 * Author: Valerian Saliou <valerian@valeriansaliou.name>
 */

import * as yaml from "js-yaml";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The format of the frontmatter. */
export type FrontmatterFormat = "json" | "toml" | "yaml";

/** A primitive type name used in {@link ParseOptions} field type declarations. */
export type ScalarType = "boolean" | "number" | "string";

/**
 * A field type used in {@link ParseOptions}.
 * Use a plain `ScalarType` for scalar fields, or a single-element tuple for arrays.
 *
 * @example
 * ```ts
 * { active: "boolean", count: "number", tags: ["string"] }
 * ```
 */
export type FieldType = ScalarType | [ScalarType];

/** Options accepted by {@link parse}. */
export interface ParseOptions {
  /**
   * Per-key type declarations. Each value is cast to the declared type after parsing.
   * Keys are matched case-insensitively (they are lowercased before lookup).
   */
  types?: Record<string, FieldType>;
  /**
   * What to do when a cast fails.
   * - `"throw"` (default) — throws a {@link TypeCastError}.
   * - `"ignore"` — keeps the original value unchanged.
   */
  onError?: "throw" | "ignore";
}

interface FormatSpec {
  readonly open: string;
  readonly close: string;
  readonly displayName: string;
}

const FORMATS = {
  json: { open: "{", close: "}", displayName: "JSON" },
  toml: { open: "+++", close: "+++", displayName: "TOML" },
  yaml: { open: "---", close: "---", displayName: "YAML" },
} as const satisfies Record<FrontmatterFormat, FormatSpec>;

const ALL_FORMATS = Object.keys(FORMATS) as readonly FrontmatterFormat[];

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Base class for all frontmatter errors. */
export class FrontmatterError extends Error {}

/** Thrown when the closing delimiter is absent. */
export class AbsentClosingDelimiterError extends FrontmatterError {
  override readonly name = "AbsentClosingDelimiterError";

  constructor(readonly format: FrontmatterFormat) {
    super(`absent closing ${FORMATS[format].displayName} delimiter`);
  }
}

/** Thrown on invalid JSON syntax. */
export class InvalidJsonError extends FrontmatterError {
  override readonly name = "InvalidJsonError";

  constructor(cause?: unknown) {
    super("invalid JSON syntax", cause !== undefined ? { cause } : undefined);
  }
}

/** Thrown on invalid TOML syntax. */
export class InvalidTomlError extends FrontmatterError {
  override readonly name = "InvalidTomlError";

  constructor(cause?: unknown) {
    super("invalid TOML syntax", cause !== undefined ? { cause } : undefined);
  }
}

/** Thrown on invalid YAML syntax. */
export class InvalidYamlError extends FrontmatterError {
  override readonly name = "InvalidYamlError";

  constructor(cause?: unknown) {
    super("invalid YAML syntax", cause !== undefined ? { cause } : undefined);
  }
}

/** Thrown when a value cannot be cast to its declared {@link FieldType}. */
export class TypeCastError extends FrontmatterError {
  override readonly name = "TypeCastError";

  constructor(
    readonly key: string,
    readonly value: unknown,
    readonly expectedType: FieldType
  ) {
    const typeName = Array.isArray(expectedType)
      ? `${expectedType[0]}[]`
      : expectedType;
    super(
      `cannot cast key "${key}" to type "${typeName}": ${JSON.stringify(value)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** A line with its character-position span within the source string. */
export interface LineSpan {
  /** Start position of the line content (excluding any preceding newline). */
  readonly start: number;
  /** Start position of the next line (i.e. after the line ending). */
  readonly nextStart: number;
  /** The line content, without the line ending. */
  readonly line: string;
}

/** The raw frontmatter extracted by {@link split}. */
export interface SplitResult {
  /** The detected frontmatter format. */
  readonly format: FrontmatterFormat;
  /** The raw frontmatter string (including delimiters for JSON, excluding for TOML/YAML). */
  readonly raw: string;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function detectFormat(firstLine: string): FrontmatterFormat | null {
  return ALL_FORMATS.find((f) => firstLine === FORMATS[f].open) ?? null;
}

function lowercaseKeys(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k.toLowerCase(),
      v !== null && typeof v === "object" && !Array.isArray(v)
        ? lowercaseKeys(v as Record<string, unknown>)
        : v,
    ])
  );
}

function castScalar(value: unknown, type: ScalarType): unknown {
  switch (type) {
    case "string":
      return String(value);
    case "number": {
      const n = Number(value);
      if (Number.isNaN(n)) throw new Error("not a number");
      return n;
    }
    case "boolean":
      if (value === true  || value === 1 || value === "true"  || value === "yes" || value === "1") return true;
      if (value === false || value === 0 || value === "false" || value === "no"  || value === "0") return false;
      throw new Error("not a boolean");
  }
}

function castField(key: string, value: unknown, fieldType: FieldType): unknown {
  if (Array.isArray(fieldType)) {
    if (!Array.isArray(value)) throw new TypeCastError(key, value, fieldType);
    return value.map((item) => {
      try {
        return castScalar(item, fieldType[0]);
      } catch {
        throw new TypeCastError(key, item, fieldType);
      }
    });
  }
  try {
    return castScalar(value, fieldType);
  } catch {
    throw new TypeCastError(key, value, fieldType);
  }
}

function applyTypes(
  metadata: Record<string, unknown>,
  types: Record<string, FieldType>,
  onError: "throw" | "ignore"
): Record<string, unknown> {
  const result = { ...metadata };
  for (const [rawKey, fieldType] of Object.entries(types)) {
    const key = rawKey.toLowerCase();
    if (!(key in result)) continue;
    try {
      result[key] = castField(key, result[key], fieldType);
    } catch (e) {
      if (onError === "throw") throw e;
    }
  }
  return result;
}

type Parser = (raw: string) => Record<string, unknown>;
type Serializer = (metadata: Record<string, unknown>) => string;

const SERIALIZERS: Record<FrontmatterFormat, Serializer> = {
  json: (metadata) => JSON.stringify(metadata, null, "\t"),
  toml: (metadata) => stringifyToml(metadata as Parameters<typeof stringifyToml>[0]).trimEnd(),
  yaml: (metadata) => yaml.dump(metadata, { indent: 2 }).trimEnd(),
};

const PARSERS: Record<FrontmatterFormat, Parser> = {
  json: (raw) => {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch (e) {
      throw new InvalidJsonError(e);
    }
  },
  toml: (raw) => {
    try {
      return parseToml(raw) as Record<string, unknown>;
    } catch (e) {
      throw new InvalidTomlError(e);
    }
  },
  yaml: (raw) => {
    let result: unknown;
    try {
      result = yaml.load(raw);
    } catch (e) {
      throw new InvalidYamlError(e);
    }
    if (result === null || result === undefined) return {};
    return result as Record<string, unknown>;
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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
    if (s[i] === "\r") {
      i++;
      if (s[i] === "\n") i++;
    } else if (s[i] === "\n") {
      i++;
    }
    pos = i;
    yield { start, nextStart: i, line: s.slice(start, lineEnd) };
  }
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

  const format = detectFormat(first.value.line);
  if (format === null) return [null, trimmed];

  // JSON includes the opening `{`; TOML/YAML skip the opening delimiter line.
  const matterStart = format === "json" ? first.value.start : first.value.nextStart;
  const { close } = FORMATS[format];

  for (const span of iter) {
    if (span.line !== close) continue;
    // JSON includes the closing `}` line; TOML/YAML exclude it.
    const rawEnd = format === "json" ? span.nextStart : span.start;
    return [
      { format, raw: trimmed.slice(matterStart, rawEnd) },
      trimmed.slice(span.nextStart),
    ];
  }

  throw new AbsentClosingDelimiterError(format);
}

/**
 * Generates a markdown string with a frontmatter header from the given metadata and content.
 *
 * @param metadata - Key-value pairs to serialize as frontmatter.
 * @param content  - The markdown body.
 * @param format   - The frontmatter format to use (default: `"yaml"`).
 *
 * @example
 * ```ts
 * import { generate } from "markdown-frontmatter-parser";
 *
 * const doc = generate({ title: "Hello" }, "World\n");
 * // ---
 * // title: Hello
 * // ---
 * //
 * // World
 * ```
 */
export function generate(
  metadata: Record<string, unknown>,
  content: string,
  format: FrontmatterFormat = "yaml"
): string {
  const serialized = SERIALIZERS[format](metadata);
  if (format === "json") {
    return `${serialized}\n\n${content}`;
  }
  const { open, close } = FORMATS[format];
  return `${open}\n${serialized}\n${close}\n\n${content}`;
}

/**
 * Normalizes a markdown document by parsing its frontmatter and re-serializing it
 * in canonical form (keys lowercased, consistent delimiters, double newline spacing).
 *
 * Returns the content unchanged when no frontmatter is detected.
 * Passing `format` re-serializes in a different format than the source.
 *
 * @example
 * ```ts
 * import { lint } from "markdown-frontmatter-parser";
 *
 * const doc = `---
 * Title: Hello
 * ---
 * World
 * `;
 *
 * console.log(lint(doc));
 * // ---
 * // title: Hello
 * // ---
 * //
 * // World
 * ```
 */
export function lint(content: string, format?: FrontmatterFormat): string {
  const [extracted, body] = split(content);
  if (extracted === null) return content;
  const metadata = lowercaseKeys(PARSERS[extracted.format](extracted.raw));
  return generate(metadata, body.replace(/^\n+/, ""), format ?? extracted.format);
}

/**
 * Parses frontmatter from a markdown string, returning the parsed frontmatter
 * and the body of the document.
 *
 * When the document has no frontmatter, an empty object is returned as the
 * frontmatter and the full content is returned as the body.
 *
 * Optionally accepts a {@link ParseOptions} object to declare field types
 * (see {@link ParseOptions.types}) and control cast-failure behavior
 * (see {@link ParseOptions.onError}).
 *
 * @example
 * ```ts
 * import { parse } from "markdown-frontmatter-parser";
 *
 * const doc = `---
 * title: Hello
 * count: "42"
 * active: "yes"
 * tags:
 *   - foo
 *   - bar
 * ---
 * World
 * `;
 *
 * const [frontmatter, body] = parse(doc, {
 *   types: { count: "number", active: "boolean", tags: ["string"] },
 * });
 * console.log(frontmatter.count);  // 42
 * console.log(frontmatter.active); // true
 * console.log(frontmatter.tags);   // ["foo", "bar"]
 * console.log(body);               // "World\n"
 * ```
 */
export function parse<T = Record<string, unknown>>(
  content: string,
  options?: ParseOptions
): [T, string] {
  const [extracted, body] = split(content);
  let metadata: Record<string, unknown> = extracted === null
    ? {}
    : lowercaseKeys(PARSERS[extracted.format](extracted.raw));
  if (options?.types !== undefined) {
    metadata = applyTypes(metadata, options.types, options.onError ?? "throw");
  }
  return [metadata as T, body];
}
