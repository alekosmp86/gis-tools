import { test as baseTest, expect } from "@playwright/test";
import { mockBackend, type MockBackendOptions } from "./mockBackend";

export interface CustomTestFixtures {
  mockBackend: (options?: MockBackendOptions) => Promise<void>;
  allowConsoleErrors: (pattern?: RegExp) => void;
}

export interface CustomTestOptions {
  failOnConsoleError: boolean;
}

/**
 * Extended Playwright test runner with:
 * 1. Automatic console.error & pageerror assertion guard (fails tests on uncaught errors/hydration mismatches).
 * 2. Pattern-based opt-out mechanism via allowConsoleErrors(pattern) (defaults to /Failed to load resource/).
 * 3. Pre-configured mockBackend fixture for deterministic offline API mocking.
 */
export const test = baseTest.extend<CustomTestFixtures, CustomTestOptions>({
  failOnConsoleError: [true, { option: true, scope: "worker" }],

  allowConsoleErrors: async ({}, use, testInfo) => {
    await use((pattern: RegExp = /Failed to load resource/) => {
      const info = testInfo as unknown as { __allowedConsolePatterns?: RegExp[] };
      info.__allowedConsolePatterns = info.__allowedConsolePatterns || [];
      info.__allowedConsolePatterns.push(pattern);
    });
  },

  mockBackend: async ({ page }, use) => {
    await use(async (options?: MockBackendOptions) => {
      await mockBackend(page, options);
    });
  },

  page: async ({ page, failOnConsoleError }, use, testInfo) => {
    const errorLogs: string[] = [];

    page.on("console", (message) => {
      if (message.type() === "error") {
        const text = message.text();
        const allowedPatterns =
          (testInfo as unknown as { __allowedConsolePatterns?: RegExp[] }).__allowedConsolePatterns || [];
        const isAllowed = allowedPatterns.some((pattern) => pattern.test(text));
        if (!isAllowed) {
          errorLogs.push(`[console.error] ${text}`);
        }
      }
    });

    page.on("pageerror", (error) => {
      errorLogs.push(`[pageerror] ${error.message}\n${error.stack || ""}`);
    });

    await use(page);

    if (failOnConsoleError && errorLogs.length > 0) {
      throw new Error(
        `Unexpected console or runtime page error(s) detected during test execution:\n\n${errorLogs.join(
          "\n\n"
        )}`
      );
    }
  },
});

export { expect };
