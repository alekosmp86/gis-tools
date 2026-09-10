import { test as baseTest, expect } from "@playwright/test";
import { mockBackend, type MockBackendOptions } from "./mockBackend";

export interface CustomTestFixtures {
  mockBackend: (options?: MockBackendOptions) => Promise<void>;
  allowConsoleErrors: () => void;
}

export interface CustomTestOptions {
  failOnConsoleError: boolean;
}

/**
 * Extended Playwright test runner with:
 * 1. Automatic console.error & pageerror assertion guard (fails tests on uncaught errors/hydration mismatches).
 * 2. Opt-out mechanism via allowConsoleErrors() or test.use({ failOnConsoleError: false }).
 * 3. Pre-configured mockBackend fixture for deterministic offline API mocking.
 */
export const test = baseTest.extend<CustomTestFixtures, CustomTestOptions>({
  failOnConsoleError: [true, { option: true, scope: "worker" }],

  allowConsoleErrors: async ({}, use, testInfo) => {
    await use(() => {
      (testInfo as unknown as { __allowConsoleErrors?: boolean }).__allowConsoleErrors = true;
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
        errorLogs.push(`[console.error] ${message.text()}`);
      }
    });

    page.on("pageerror", (error) => {
      errorLogs.push(`[pageerror] ${error.message}\n${error.stack || ""}`);
    });

    await use(page);

    const isExplicitlyAllowed =
      (testInfo as unknown as { __allowConsoleErrors?: boolean }).__allowConsoleErrors === true;
    if (failOnConsoleError && !isExplicitlyAllowed && errorLogs.length > 0) {
      throw new Error(
        `Unexpected console or runtime page error(s) detected during test execution:\n\n${errorLogs.join(
          "\n\n"
        )}`
      );
    }
  },
});

export { expect };
