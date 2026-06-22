/*
 * node-markdown-frontmatter-parser
 *
 * Copyright 2026, Valerian Saliou
 * Author: Valerian Saliou <valerian@valeriansaliou.name>
 */

import { describe, expect, it } from "vitest";
import {
  AbsentClosingDelimiterError,
  InvalidJsonError,
  InvalidTomlError,
  InvalidYamlError,
  lineSpans,
  parse,
  split,
} from "./index.js";

// ---------------------------------------------------------------------------
// lineSpans
// ---------------------------------------------------------------------------

describe("lineSpans", () => {
  it("handles CRLF, LF, and no trailing newline", () => {
    const input = "line 1\r\nline 2\nline 3";
    const spans = [...lineSpans(input)];

    expect(spans).toHaveLength(3);

    expect(spans[0].line).toBe("line 1");
    expect(spans[0].start).toBe(0);
    expect(spans[0].nextStart).toBe(8); // "line 1\r\n" = 8 chars

    expect(spans[1].line).toBe("line 2");
    expect(spans[1].start).toBe(8);
    expect(spans[1].nextStart).toBe(15); // "line 2\n" = 7 chars

    expect(spans[2].line).toBe("line 3");
    expect(spans[2].start).toBe(15);
    expect(spans[2].nextStart).toBe(21); // "line 3" = 6 chars, no newline

    expect([...lineSpans(input)][3]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// split
// ---------------------------------------------------------------------------

describe("split", () => {
  it("empty document", () => {
    const [fm, body] = split("");
    expect(fm).toBeNull();
    expect(body).toBe("");
  });

  it("no frontmatter", () => {
    const [fm, body] = split("hello world");
    expect(fm).toBeNull();
    expect(body).toBe("hello world");
  });

  it("unclosed JSON delimiter throws", () => {
    expect(() => split('{\n\t"foo": "bar"\n')).toThrow(
      AbsentClosingDelimiterError
    );
    expect(() => split('{\n\t"foo": "bar"\n')).toThrow(
      /absent closing JSON delimiter/
    );
  });

  it("unclosed TOML delimiter throws", () => {
    expect(() => split('+++\nfoo = "bar"')).toThrow(AbsentClosingDelimiterError);
    expect(() => split('+++\nfoo = "bar"')).toThrow(
      /absent closing TOML delimiter/
    );
  });

  it("unclosed YAML delimiter throws", () => {
    expect(() => split("---\nfoo: bar")).toThrow(AbsentClosingDelimiterError);
    expect(() => split("---\nfoo: bar")).toThrow(
      /absent closing YAML delimiter/
    );
  });

  it("JSON singleline", () => {
    const input = '{\n\t"foo": "bar"\n}\nhello world';
    const [fm, body] = split(input);
    expect(fm?.raw).toBe('{\n\t"foo": "bar"\n}\n');
    expect(fm?.format).toBe("json");
    expect(body).toBe("hello world");
  });

  it("JSON multiline", () => {
    const input = '{\n\t"foo": "bar",\n\t"baz": 1\n}\nhello world';
    const [fm, body] = split(input);
    expect(fm?.raw).toBe('{\n\t"foo": "bar",\n\t"baz": 1\n}\n');
    expect(fm?.format).toBe("json");
    expect(body).toBe("hello world");
  });

  it("TOML singleline", () => {
    const input = '+++\nfoo = "bar"\n+++\nhello world';
    const [fm, body] = split(input);
    expect(fm?.raw).toBe('foo = "bar"\n');
    expect(fm?.format).toBe("toml");
    expect(body).toBe("hello world");
  });

  it("TOML multiline", () => {
    const input = '+++\nfoo = "bar"\nbaz = 1\n+++\nhello world';
    const [fm, body] = split(input);
    expect(fm?.raw).toBe('foo = "bar"\nbaz = 1\n');
    expect(fm?.format).toBe("toml");
    expect(body).toBe("hello world");
  });

  it("YAML singleline", () => {
    const input = "---\nfoo: bar\n---\nhello world";
    const [fm, body] = split(input);
    expect(fm?.raw).toBe("foo: bar\n");
    expect(fm?.format).toBe("yaml");
    expect(body).toBe("hello world");
  });

  it("YAML multiline", () => {
    const input = "---\nfoo: bar\nbaz: 1\n---\nhello world";
    const [fm, body] = split(input);
    expect(fm?.raw).toBe("foo: bar\nbaz: 1\n");
    expect(fm?.format).toBe("yaml");
    expect(body).toBe("hello world");
  });
});

// ---------------------------------------------------------------------------
// parse — JSON
// ---------------------------------------------------------------------------

describe("parse / JSON", () => {
  const VALID_DOCUMENT = '{\n\t"foo": true\n}\nhello world';
  const INVALID_SYNTAX = "{\n1\n}";
  // Note: TypeScript has no runtime type enforcement, so a mismatched value type
  // (foo: 0 assigned to foo: boolean) is returned as-is rather than throwing.
  const INVALID_TYPE = '{\n\t"foo": 0\n}';

  it("empty document yields empty frontmatter", () => {
    const [fm, body] = parse("");
    expect(fm).toEqual({});
    expect(body).toBe("");
  });

  it("document without frontmatter yields empty frontmatter", () => {
    const [fm, body] = parse("hello world");
    expect(fm).toEqual({});
    expect(body).toBe("hello world");
  });

  it("valid document", () => {
    const [fm, body] = parse(VALID_DOCUMENT);
    expect(fm).toEqual({ foo: true });
    expect(body).toBe("hello world");
  });

  it("invalid JSON syntax throws InvalidJsonError", () => {
    expect(() => parse(INVALID_SYNTAX)).toThrow(InvalidJsonError);
  });

  it("mismatched value type is returned as-is (no runtime type checking in TS)", () => {
    const [fm] = parse(INVALID_TYPE);
    expect(fm).toEqual({ foo: 0 });
  });
});

// ---------------------------------------------------------------------------
// parse — TOML
// ---------------------------------------------------------------------------

describe("parse / TOML", () => {
  const VALID_DOCUMENT = "+++\nfoo = true\n+++\nhello world";
  const INVALID_SYNTAX = "+++\nfoobar\n+++\n";
  // Note: TypeScript has no runtime type enforcement; foo = 123 succeeds as number.
  const INVALID_TYPE = "+++\nfoo = 123\n+++\n";

  it("empty document yields empty frontmatter", () => {
    const [fm, body] = parse("");
    expect(fm).toEqual({});
    expect(body).toBe("");
  });

  it("document without frontmatter yields empty frontmatter", () => {
    const [fm, body] = parse("hello world");
    expect(fm).toEqual({});
    expect(body).toBe("hello world");
  });

  it("valid document", () => {
    const [fm, body] = parse(VALID_DOCUMENT);
    expect(fm).toEqual({ foo: true });
    expect(body).toBe("hello world");
  });

  it("invalid TOML syntax throws InvalidTomlError", () => {
    expect(() => parse(INVALID_SYNTAX)).toThrow(InvalidTomlError);
  });

  it("mismatched value type is returned as-is (no runtime type checking in TS)", () => {
    const [fm] = parse(INVALID_TYPE);
    expect(fm).toEqual({ foo: 123 });
  });
});

// ---------------------------------------------------------------------------
// parse — YAML
// ---------------------------------------------------------------------------

describe("parse / YAML", () => {
  const VALID_DOCUMENT = "---\nfoo: true\n---\nhello world";
  // An undefined YAML alias is a reliable syntax/resolution error in js-yaml.
  const INVALID_SYNTAX = "---\nfoo: *undefined_alias\n---\n";
  // Note: TypeScript has no runtime type enforcement; foo: 123 succeeds as number.
  const INVALID_TYPE = "---\nfoo: 123\n---\n";

  it("empty document yields empty frontmatter", () => {
    const [fm, body] = parse("");
    expect(fm).toEqual({});
    expect(body).toBe("");
  });

  it("document without frontmatter yields empty frontmatter", () => {
    const [fm, body] = parse("hello world");
    expect(fm).toEqual({});
    expect(body).toBe("hello world");
  });

  it("valid document", () => {
    const [fm, body] = parse(VALID_DOCUMENT);
    expect(fm).toEqual({ foo: true });
    expect(body).toBe("hello world");
  });

  it("invalid YAML syntax throws InvalidYamlError", () => {
    expect(() => parse(INVALID_SYNTAX)).toThrow(InvalidYamlError);
  });

  it("mismatched value type is returned as-is (no runtime type checking in TS)", () => {
    const [fm] = parse(INVALID_TYPE);
    expect(fm).toEqual({ foo: 123 });
  });
});
