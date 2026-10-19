import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/wiki/assets/[tool]/[...path]/route";

function call(tool: string, path: string[]): Promise<Response> {
  return GET(new Request("http://localhost/api/wiki/assets"), { params: Promise.resolve({ tool, path }) });
}

describe("wiki asset route GET", () => {
  it("should answer 404 for an unknown tool", async () => {
    expect((await call("no-such-tool", ["a.png"])).status).toBe(404);
  });

  it("should answer 404 for a path traversal attempt on a known tool", async () => {
    expect((await call("file-viewer", ["..", "..", "..", "package.png"])).status).toBe(404);
  });

  it("should answer 404 for a percent-encoded traversal", async () => {
    expect((await call("file-viewer", ["%2e%2e", "a.png"])).status).toBe(404);
  });

  it("should answer 404 for a non-image file such as the page markdown", async () => {
    expect((await call("file-viewer", ["index.md"])).status).toBe(404);
  });

  it("should answer 404 for an image that does not exist", async () => {
    expect((await call("file-viewer", ["img", "missing.png"])).status).toBe(404);
  });
});
