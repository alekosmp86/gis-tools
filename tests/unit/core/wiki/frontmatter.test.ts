import { describe, it, expect } from "vitest";
import { parseWikiFrontmatter } from "@/core/wiki/frontmatter";

const FILE = "src/wiki/x/page.md";

describe("parseWikiFrontmatter", () => {
  it("should read title and order from a valid block", () => {
    const result = parseWikiFrontmatter("---\ntitle: Intro\norder: 2\n---\n# Body", FILE);

    expect(result.metadata).toEqual({ title: "Intro", order: 2 });
    expect(result.body).toBe("# Body");
  });

  it("should strip matching surrounding quotes from the title", () => {
    expect(parseWikiFrontmatter('---\ntitle: "A: b"\n---\nx', FILE).metadata.title).toBe("A: b");
    expect(parseWikiFrontmatter("---\ntitle: 'Q'\n---\nx", FILE).metadata.title).toBe("Q");
  });

  it("should keep mismatched quotes untouched", () => {
    expect(parseWikiFrontmatter('---\ntitle: "Q\'\n---\nx', FILE).metadata.title).toBe('"Q\'');
  });

  it("should treat the whole text as body when there is no block", () => {
    const result = parseWikiFrontmatter("# Just text\nmore", FILE);

    expect(result.metadata).toEqual({});
    expect(result.body).toBe("# Just text\nmore");
  });

  it("should treat the whole text as body when the block is unterminated", () => {
    const text = "---\ntitle: X\nbody";
    const result = parseWikiFrontmatter(text, FILE);

    expect(result.metadata).toEqual({});
    expect(result.body).toBe(text);
  });

  it("should handle CRLF input and normalise the body to LF", () => {
    const result = parseWikiFrontmatter("---\r\ntitle: T\r\norder: 1\r\n---\r\nline1\r\nline2", FILE);

    expect(result.metadata).toEqual({ title: "T", order: 1 });
    expect(result.body).toBe("line1\nline2");
  });

  it("should ignore a BOM prefix", () => {
    const result = parseWikiFrontmatter("﻿---\ntitle: T\n---\nb", FILE);

    expect(result.metadata.title).toBe("T");
    expect(result.body).toBe("b");
  });

  it("should ignore unknown keys and lines without a colon", () => {
    const result = parseWikiFrontmatter("---\nauthor: me\nnonsense\ntitle: T\n---\nb", FILE);

    expect(result.metadata.title).toBe("T");
    expect(result.metadata.order).toBeUndefined();
  });

  it("should yield an undefined title when title is empty", () => {
    expect(parseWikiFrontmatter("---\ntitle:\n---\nb", FILE).metadata.title).toBeUndefined();
    expect(parseWikiFrontmatter('---\ntitle: ""\n---\nb', FILE).metadata.title).toBeUndefined();
  });

  it("should accept a negative integer order", () => {
    expect(parseWikiFrontmatter("---\norder: -3\n---\nb", FILE).metadata.order).toBe(-3);
  });

  it.each(["1.5", "", "abc"])("should throw naming the file when order is %j", (value) => {
    expect(() => parseWikiFrontmatter(`---\norder: ${value}\n---\nb`, FILE)).toThrow(FILE);
  });
});
