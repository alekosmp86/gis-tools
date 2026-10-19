import { describe, expect, it } from "vitest";
import { parseWikiCalloutMarker } from "@/core/wiki/callouts";

describe("parseWikiCalloutMarker", () => {
  it.each([
    ["[!NOTE]", "NOTE"],
    ["[!tip]", "TIP"],
    ["[!Warning]", "WARNING"],
  ])("should read %s as %s", (text, kind) => {
    expect(parseWikiCalloutMarker(text)?.kind).toBe(kind);
  });

  it("should return the remainder after the marker and consume the newline", () => {
    expect(parseWikiCalloutMarker("[!NOTE]\nhola mundo")).toEqual({ kind: "NOTE", remainder: "hola mundo" });
  });

  it("should consume a CRLF newline and trailing spaces", () => {
    expect(parseWikiCalloutMarker("[!TIP]  \r\ntexto")?.remainder).toBe("texto");
  });

  it("should keep same-line text as remainder", () => {
    expect(parseWikiCalloutMarker("[!NOTE] texto")?.remainder).toBe("texto");
  });

  it.each(["texto plano", "", "[!FOO]\nx", "x [!NOTE]", "[NOTE]"])("should return null for %j", (text) => {
    expect(parseWikiCalloutMarker(text)).toBeNull();
  });
});
