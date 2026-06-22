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
export type FrontmatterScalarType = "boolean" | "number" | "string";

/**
 * A field type used in {@link ParseOptions}.
 * Use a plain `FrontmatterScalarType` for scalar fields, or a single-element tuple for arrays.
 *
 * @example
 * ```ts
 * { active: "boolean", count: "number", tags: ["string"] }
 * ```
 */
export type FrontmatterFieldType = FrontmatterScalarType | [FrontmatterScalarType];

/** Options accepted by {@link parse}. */
export interface ParseOptions {
  /**
   * Per-key type declarations. Each value is cast to the declared type after parsing.
   * Keys are matched case-insensitively (they are lowercased before lookup).
   */
  types?: Record<string, FrontmatterFieldType>;

  /**
   * Whether to throw a {@link TypeCastError} when a cast fails.
   * - `true` (default) — throws on failure.
   * - `false` — keeps the original value unchanged.
   */
  throwing?: boolean;
}

interface Formatter {
  readonly open: string;
  readonly close: string;
  readonly displayName: string;
}

const FORMATS = {
  json: { open: "{",   close: "}",   displayName: "JSON" },
  toml: { open: "+++", close: "+++", displayName: "TOML" },
  yaml: { open: "---", close: "---", displayName: "YAML" },
} as const satisfies Record<FrontmatterFormat, Formatter>;

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
    readonly expectedType: FrontmatterFieldType
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

/**
 * Returns the frontmatter format whose opening delimiter matches `firstLine`, or `null`.
 *
 * @param firstLine - The first non-empty line of the document.
 * @returns The matching {@link FrontmatterFormat}, or `null` if no delimiter matched.
 */
function detectFormat(firstLine: string): FrontmatterFormat | null {
  return ALL_FORMATS.find((f) => firstLine === FORMATS[f].open) ?? null;
}

/**
 * Strips leading and trailing whitespace from an extracted markdown body.
 *
 * @param body - The raw body string returned by the frontmatter splitter.
 * @returns The body with leading and trailing whitespace removed.
 */
function trimBody(body: string): string {
  return body.trimStart().trimEnd();
}

/**
 * Recursively lowercases all keys in a plain object.
 * Arrays and scalar values are passed through unchanged.
 *
 * @param obj - The object whose keys should be lowercased.
 * @returns A new object with all keys (and nested keys) lowercased.
 */
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

/**
 * Casts a single scalar value to the given type.
 * Throws a plain `Error` on failure — the caller is responsible for wrapping it into a {@link TypeCastError}.
 *
 * @param value - The value to cast.
 * @param type  - The target scalar type.
 * @returns The cast value.
 * @throws `Error` if the value cannot be cast to the requested type.
 */
function castScalar(value: unknown, type: FrontmatterScalarType): unknown {
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

/**
 * Casts a value to the given `fieldType`, handling both scalar and array field types.
 *
 * @param key       - The metadata key name, used in error messages.
 * @param value     - The value to cast.
 * @param fieldType - The target field type (scalar or array-of-scalar).
 * @returns The cast value.
 * @throws {@link TypeCastError} if the value cannot be cast to the requested type.
 */
function castField(key: string, value: unknown, fieldType: FrontmatterFieldType): unknown {
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

/**
 * Applies per-key type casts from `types` to `metadata`.
 * On cast failure, throws if `throwing` is `true`, otherwise keeps the original value unchanged.
 *
 * @param metadata  - The already-parsed frontmatter object.
 * @param types     - Map of key names to their declared {@link FrontmatterFieldType}.
 * @param throwing  - Whether to throw a {@link TypeCastError} on failure (`true`) or silently ignore it (`false`).
 * @returns A new object with the requested fields cast to their declared types.
 */
function applyTypes(
  metadata: Record<string, unknown>,
  types: Record<string, FrontmatterFieldType>,
  throwing: boolean
): Record<string, unknown> {
  const result = { ...metadata };

  for (const [rawKey, fieldType] of Object.entries(types)) {
    const key = rawKey.toLowerCase();

    if (!(key in result)) continue;

    try {
      result[key] = castField(key, result[key], fieldType);
    } catch (e) {
      if (throwing) throw e;
    }
  }

  return result;
}

type Parser = (raw: string) => Record<string, unknown>;
type Serializer = (metadata: Record<string, unknown>) => string;

/** Custom YAML boolean type that serializes `true`/`false` as `yes`/`no`. */
const YAML_BOOL_YES_NO_TYPE = new yaml.Type("tag:yaml.org,2002:bool", {
  kind: "scalar",

  predicate: (value) => typeof value === "boolean",

  represent: (value) => (value ? "yes" : "no"),

  resolve: (data) => {
    if (typeof data !== "string") return false;

    const lower = data.toLowerCase();

    return lower === "true" || lower === "false" || lower === "yes" || lower === "no";
  },

  construct: (data: string) => {
    const lower = data.toLowerCase();

    return lower === "true" || lower === "yes";
  },
});

/** @types/js-yaml does not expose `implicit`/`explicit` on Schema or `tag` on Type, but they exist at runtime. */
interface YamlSchemaInternal {
  implicit: Array<yaml.Type & { tag: string }>;
  explicit: Array<yaml.Type & { tag: string }>;
}

/**
 * YAML schema identical to the default, but with booleans serialized as `yes`/`no`
 * instead of `true`/`false`.
 */
const YAML_SCHEMA_YES_NO = new yaml.Schema({
  implicit: [
    ...(yaml.DEFAULT_SCHEMA as unknown as YamlSchemaInternal).implicit.filter(
      (t) => t.tag !== "tag:yaml.org,2002:bool"
    ),
    YAML_BOOL_YES_NO_TYPE,
  ],
  explicit: (yaml.DEFAULT_SCHEMA as unknown as YamlSchemaInternal).explicit,
});

const SERIALIZERS: Record<FrontmatterFormat, Serializer> = {
  json: (metadata) => JSON.stringify(metadata, null, "\t"),

  toml: (metadata) =>
    stringifyToml(metadata as Parameters<typeof stringifyToml>[0]).trimEnd(),

  yaml: (metadata) =>
    yaml.dump(metadata, { indent: 2, schema: YAML_SCHEMA_YES_NO }).trimEnd(),
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

/**
 * Iterates over lines in a string, yielding each line with its span. Handles both CRLF and LF.
 *
 * @param s - The source string to iterate over.
 * @returns A generator of {@link LineSpan} objects, one per line.
 */
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
 * @param content - The full markdown document string.
 * @returns A tuple of `[SplitResult | null, body]`. The first element is `null` when no frontmatter is found.
 * @throws {@link AbsentClosingDelimiterError} when an opening delimiter has no closing match.
 */
export function split(content: string): [SplitResult | null, string] {
  const trimmed = content.trimStart();
  const iter = lineSpans(trimmed);

  const first = iter.next();

  if (first.done) return [null, trimmed];

  const format = detectFormat(first.value.line);

  if (format === null) return [null, trimBody(trimmed)];

  // JSON includes the opening `{`; TOML/YAML skip the opening delimiter line.
  const matterStart = format === "json" ? first.value.start : first.value.nextStart;
  const { close } = FORMATS[format];

  for (const span of iter) {
    if (span.line !== close) continue;

    // JSON includes the closing `}` line; TOML/YAML exclude it.
    const rawEnd = format === "json" ? span.nextStart : span.start;

    return [
      { format, raw: trimmed.slice(matterStart, rawEnd) },
      trimBody(trimmed.slice(span.nextStart)),
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
 * @returns A markdown string with the frontmatter header followed by a blank line and the body.
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
 * @param content - The full markdown document string.
 * @param format  - Target frontmatter format. Defaults to the format detected in `content`.
 * @param options - Optional type casting options, same as {@link parse}.
 * @returns The normalized markdown string, or the original `content` unchanged if no frontmatter was detected.
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
export function lint(
  content: string,
  format?: FrontmatterFormat,
  options?: ParseOptions
): string {
  const [extracted, body] = split(content);

  if (extracted === null) return content;

  let metadata = lowercaseKeys(PARSERS[extracted.format](extracted.raw));

  if (options?.types !== undefined) {
    metadata = applyTypes(metadata, options.types, options.throwing ?? true);
  }

  return generate(metadata, body, format ?? extracted.format);
}

/**
 * Parses frontmatter from a markdown string, returning the parsed frontmatter
 * and the body of the document.
 *
 * When the document has no frontmatter, an empty object is returned as the
 * frontmatter and the full content is returned as the body.
 *
 * @param content - The full markdown document string.
 * @param options - Optional type casting and error-handling options.
 * @returns A tuple of `[frontmatter, body]`. `frontmatter` is cast to `T` (no runtime validation).
 * @throws {@link AbsentClosingDelimiterError} if an opening delimiter has no closing match.
 * @throws {@link InvalidJsonError} | {@link InvalidTomlError} | {@link InvalidYamlError} on malformed frontmatter.
 * @throws {@link TypeCastError} if a declared type cast fails and `options.throwing` is `true` (default).
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
    metadata = applyTypes(metadata, options.types, options.throwing ?? true);
  }

  return [metadata as T, body];
}
