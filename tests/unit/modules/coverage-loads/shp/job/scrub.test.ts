import { describe, expect, it } from "vitest";
import { createScrubber, errorText, scrubSecrets } from "@/modules/coverage-loads/shp/job/scrub.ts";

describe("scrubSecrets", () => {
  it("should replace a secret with *** when it appears in the message", () => {
    expect(scrubSecrets("password=abc123 ok", ["abc123"])).toBe("password=*** ok");
  });

  it("should replace every occurrence when the secret repeats", () => {
    expect(scrubSecrets("abc abc abc", ["abc"])).toBe("*** *** ***");
  });

  it("should ignore empty secrets when scrubbing", () => {
    expect(scrubSecrets("hello", ["", ""])).toBe("hello");
  });

  it("should return the message unchanged when there are no secrets", () => {
    expect(scrubSecrets("hello", [])).toBe("hello");
  });

  it("should hide an overlapping secret fully when the longer one is listed last", () => {
    expect(scrubSecrets("pass=secretlong!", ["secret", "secretlong"])).toBe("pass=***!");
  });

  it("should not mutate the secrets array when ordering them", () => {
    const secrets = ["a", "abc"];

    scrubSecrets("abc", secrets);

    expect(secrets).toEqual(["a", "abc"]);
  });

  it.each(["a.b*c", "(x)+[y]", "^$|\\", "a?b{2}"])("should treat regex special characters literally in %s", (secret) => {
    expect(scrubSecrets(`before ${secret} after`, [secret])).toBe("before *** after");
    expect(scrubSecrets("axb", [secret])).toBe("axb");
  });

  it("should throw a TypeError when the message is not a string", () => {
    expect(() => scrubSecrets(undefined as never, ["a"])).toThrow(TypeError);
  });

  it("should ignore a non-string secret (no length) and leave the message untouched", () => {
    expect(scrubSecrets("abc 123", [123 as never])).toBe("abc 123");
  });
});

describe("createScrubber", () => {
  it("should snapshot the secrets when the scrubber is created", () => {
    const secrets = ["one"];
    const scrub = createScrubber(secrets);
    secrets.push("two");

    expect(scrub("one two")).toBe("*** two");
  });
});

describe("errorText", () => {
  it("should return the error message when it is an Error with text", () => {
    expect(errorText(new Error("boom"), "fb")).toBe("boom");
  });

  it("should return the fallback when the message is empty", () => {
    expect(errorText(new Error(""), "fb")).toBe("fb");
  });

  it.each([["str"], [undefined], [null], [{ message: "x" }]])("should return the fallback when input is not an Error: %j", (value) => {
    expect(errorText(value, "fb")).toBe("fb");
  });
});
