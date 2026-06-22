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
  TypeCastError,
  generate,
  lint,
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
// lint
// ---------------------------------------------------------------------------

describe("lint", () => {
  it("normalizes mixed-case YAML keys and spacing", () => {
    const input = "---\nTitle: Hello\nCOUNT: 3\n---\nBody content here.\n";
    expect(lint(input)).toBe("---\ntitle: Hello\ncount: 3\n---\n\nBody content here.\n");
  });

  it("is idempotent", () => {
    const input = "---\nTitle: Hello\n---\nBody content here.\n";
    expect(lint(lint(input))).toBe(lint(input));
  });

  it("no frontmatter returns content unchanged", () => {
    expect(lint("hello world")).toBe("hello world");
  });

  it("converts format when format override is passed", () => {
    const input = "---\ntitle: Hello\n---\nBody.\n";
    const out = lint(input, "toml");
    expect(out).toBe('+++\ntitle = "Hello"\n+++\n\nBody.\n');
  });

  it("preserves detected format when no override is passed", () => {
    const toml = '+++\ntitle = "Hello"\n+++\nBody.\n';
    expect(lint(toml)).toBe('+++\ntitle = "Hello"\n+++\n\nBody.\n');
  });

  it("applies type casting via options", () => {
    const input = '---\ncount: "42"\nactive: "yes"\n---\nBody.\n';
    const out = lint(input, undefined, {
      types: { count: "number", active: "boolean" },
    });
    expect(out).toBe("---\ncount: 42\nactive: true\n---\n\nBody.\n");
  });

  it("applies type casting and format conversion together", () => {
    const input = '---\ncount: "7"\n---\nBody.\n';
    const out = lint(input, "toml", { types: { count: "number" } });
    expect(out).toBe("+++\ncount = 7\n+++\n\nBody.\n");
  });

  it("throws TypeCastError on failed cast by default", () => {
    const input = "---\nactive: maybe\n---\nBody.\n";
    expect(() =>
      lint(input, undefined, { types: { active: "boolean" } })
    ).toThrow(TypeCastError);
  });

  it("throwing: false keeps original value on failed cast", () => {
    const input = "---\nactive: maybe\n---\nBody.\n";
    const out = lint(input, undefined, {
      types: { active: "boolean" },
      throwing: false,
    });
    expect(out).toBe("---\nactive: maybe\n---\n\nBody.\n");
  });
});

// ---------------------------------------------------------------------------
// generate
// ---------------------------------------------------------------------------

describe("generate", () => {
  const METADATA = { title: "Hello", count: 3 };
  const CONTENT = "Body content here.\n";

  it("defaults to YAML format", () => {
    const out = generate(METADATA, CONTENT);
    expect(out).toBe("---\ntitle: Hello\ncount: 3\n---\n\nBody content here.\n");
  });

  it("YAML format", () => {
    const out = generate(METADATA, CONTENT, "yaml");
    expect(out).toBe("---\ntitle: Hello\ncount: 3\n---\n\nBody content here.\n");
  });

  it("TOML format", () => {
    const out = generate(METADATA, CONTENT, "toml");
    expect(out).toBe('+++\ntitle = "Hello"\ncount = 3\n+++\n\nBody content here.\n');
  });

  it("JSON format", () => {
    const out = generate(METADATA, CONTENT, "json");
    expect(out).toBe('{\n\t"title": "Hello",\n\t"count": 3\n}\n\nBody content here.\n');
  });

  it("empty metadata", () => {
    const out = generate({}, CONTENT);
    expect(out).toBe("---\n{}\n---\n\nBody content here.\n");
  });

  it("empty content", () => {
    const out = generate(METADATA, "");
    expect(out).toBe("---\ntitle: Hello\ncount: 3\n---\n\n");
  });

  it("roundtrips through parse (body retains leading newline from spacing)", () => {
    const out = generate(METADATA, CONTENT, "yaml");
    const [fm, body] = parse(out);
    expect(fm).toEqual(METADATA);
    expect(body).toBe("\n" + CONTENT);
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

  it("mixed-case keys are lowercased", () => {
    const [fm] = parse('{\n\t"Foo": 1,\n\t"BAR_Baz": { "Nested": 2 }\n}\n');
    expect(fm).toEqual({ foo: 1, bar_baz: { nested: 2 } });
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

  it("mixed-case keys are lowercased", () => {
    const [fm] = parse('+++\nFoo = 1\n[BAR_Baz]\nNested = 2\n+++\n');
    expect(fm).toEqual({ foo: 1, bar_baz: { nested: 2 } });
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

  it("mixed-case keys are lowercased", () => {
    const [fm] = parse("---\nFoo: 1\nBAR_Baz:\n  Nested: 2\n---\n");
    expect(fm).toEqual({ foo: 1, bar_baz: { nested: 2 } });
  });
});

// ---------------------------------------------------------------------------
// parse — types option
// ---------------------------------------------------------------------------

describe("parse / types", () => {
  it("casts string to number", () => {
    const [fm] = parse('---\ncount: "42"\n---\n', { types: { count: "number" } });
    expect(fm).toEqual({ count: 42 });
  });

  it("casts number to string", () => {
    const [fm] = parse("---\ncount: 42\n---\n", { types: { count: "string" } });
    expect(fm).toEqual({ count: "42" });
  });

  it('casts "yes"/"no" strings to boolean', () => {
    const [fm] = parse('---\na: "yes"\nb: "no"\n---\n', {
      types: { a: "boolean", b: "boolean" },
    });
    expect(fm).toEqual({ a: true, b: false });
  });

  it('casts "true"/"false" strings to boolean', () => {
    const [fm] = parse('---\na: "true"\nb: "false"\n---\n', {
      types: { a: "boolean", b: "boolean" },
    });
    expect(fm).toEqual({ a: true, b: false });
  });

  it('casts "1"/"0" strings to boolean', () => {
    const [fm] = parse('---\na: "1"\nb: "0"\n---\n', {
      types: { a: "boolean", b: "boolean" },
    });
    expect(fm).toEqual({ a: true, b: false });
  });

  it("casts 1/0 numbers to boolean", () => {
    const [fm] = parse("{\n\t\"a\": 1,\n\t\"b\": 0\n}\n", {
      types: { a: "boolean", b: "boolean" },
    });
    expect(fm).toEqual({ a: true, b: false });
  });

  it("casts array elements to number", () => {
    const [fm] = parse('---\nids:\n  - "1"\n  - "2"\n  - "3"\n---\n', {
      types: { ids: ["number"] },
    });
    expect(fm).toEqual({ ids: [1, 2, 3] });
  });

  it("casts array elements to string", () => {
    const [fm] = parse("---\nscores:\n  - 10\n  - 20\n---\n", {
      types: { scores: ["string"] },
    });
    expect(fm).toEqual({ scores: ["10", "20"] });
  });

  it("casts array elements to boolean", () => {
    const [fm] = parse('---\nflags:\n  - "yes"\n  - "no"\n---\n', {
      types: { flags: ["boolean"] },
    });
    expect(fm).toEqual({ flags: [true, false] });
  });

  it("types keys are matched case-insensitively", () => {
    const [fm] = parse('---\nCount: "5"\n---\n', { types: { COUNT: "number" } });
    expect(fm).toEqual({ count: 5 });
  });

  it("unknown types keys are silently ignored", () => {
    const [fm] = parse("---\nfoo: bar\n---\n", { types: { unknown: "number" } });
    expect(fm).toEqual({ foo: "bar" });
  });

  it("throws TypeCastError on failed cast by default", () => {
    expect(() =>
      parse("---\nactive: maybe\n---\n", { types: { active: "boolean" } })
    ).toThrow(TypeCastError);
  });

  it("throws TypeCastError with correct key and value", () => {
    expect(() =>
      parse("---\ncount: abc\n---\n", { types: { count: "number" } })
    ).toThrow(/cannot cast key "count" to type "number": "abc"/);
  });

  it("throws TypeCastError when array type applied to non-array value", () => {
    expect(() =>
      parse("---\ntags: hello\n---\n", { types: { tags: ["string"] } })
    ).toThrow(TypeCastError);
  });

  it("throwing: false keeps original value on failed cast", () => {
    const [fm] = parse("---\nactive: maybe\n---\n", {
      types: { active: "boolean" },
      throwing: false,
    });
    expect(fm).toEqual({ active: "maybe" });
  });

  it("throwing: false keeps original value when array type mismatches", () => {
    const [fm] = parse("---\ntags: hello\n---\n", {
      types: { tags: ["string"] },
      throwing: false,
    });
    expect(fm).toEqual({ tags: "hello" });
  });
});

// ---------------------------------------------------------------------------
// messy real-world documents
// ---------------------------------------------------------------------------

describe("messy documents", () => {
  it("leading blank lines before the opening delimiter are ignored", () => {
    const [fm, body] = parse("\n\n\n---\ntitle: Hello\n---\nBody.\n");
    expect(fm).toEqual({ title: "Hello" });
    expect(body).toBe("Body.\n");
  });

  it("CRLF line endings throughout", () => {
    const [fm, body] = parse("---\r\ntitle: Hello\r\nauthor: Bob\r\n---\r\nBody.\r\n");
    expect(fm).toEqual({ title: "Hello", author: "Bob" });
    expect(body).toBe("Body.\r\n");
  });

  it("mixed CRLF and LF line endings", () => {
    const [fm, body] = parse("---\r\ntitle: Hello\nauthor: Bob\r\n---\nBody.\n");
    expect(fm).toEqual({ title: "Hello", author: "Bob" });
    expect(body).toBe("Body.\n");
  });

  it("ALL-CAPS keys are lowercased", () => {
    const [fm] = parse("---\nTITLE: Hello\nAUTHOR: Bob\n---\n");
    expect(fm).toEqual({ title: "Hello", author: "Bob" });
  });

  it("deeply nested YAML with mixed-case keys", () => {
    const input = "---\nMeta:\n  Author:\n    Name: Bob\n    Age: 30\n---\n";
    const [fm] = parse(input);
    expect(fm).toEqual({ meta: { author: { name: "Bob", age: 30 } } });
  });

  it("multiple blank lines between header and body", () => {
    const [fm, body] = parse("---\ntitle: Hello\n---\n\n\n\nBody.\n");
    expect(fm).toEqual({ title: "Hello" });
    expect(body).toBe("\n\n\nBody.\n");
  });

  it("body-only document with leading blank lines", () => {
    const [fm, body] = parse("\n\nhello world");
    expect(fm).toEqual({});
    expect(body).toBe("hello world");
  });

  it("YAML with unicode values", () => {
    const [fm] = parse("---\ntitle: 日本語タイトル\nauthor: François\n---\n");
    expect(fm).toEqual({ title: "日本語タイトル", author: "François" });
  });

  it("TOML with CRLF line endings", () => {
    const [fm, body] = parse('+++\r\ntitle = "Hello"\r\ncount = 5\r\n+++\r\nBody.\r\n');
    expect(fm).toEqual({ title: "Hello", count: 5 });
    expect(body).toBe("Body.\r\n");
  });

  it("JSON with extra whitespace indentation", () => {
    const [fm] = parse('{\n    "title": "Hello",\n    "count": 3\n}\n');
    expect(fm).toEqual({ title: "Hello", count: 3 });
  });

  it("lint normalizes a CRLF document to canonical form", () => {
    const input = "---\r\nTitle: Hello\r\nCOUNT: 3\r\n---\r\nBody.\r\n";
    const out = lint(input);
    expect(out).toBe("---\ntitle: Hello\ncount: 3\n---\n\nBody.\r\n");
  });

  it("lint + types on a messy mixed-case document", () => {
    const input = "---\nTITLE: Hello\nCOUNT: \"42\"\nACTIVE: \"yes\"\n---\nBody.\n";
    const out = lint(input, undefined, {
      types: { count: "number", active: "boolean" },
    });
    expect(out).toBe("---\ntitle: Hello\ncount: 42\nactive: true\n---\n\nBody.\n");
  });
});
