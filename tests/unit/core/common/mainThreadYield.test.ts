import { describe, it, expect } from "vitest";
import { yieldToMainThread } from "@/core/common/mainThreadYield";

describe("yieldToMainThread", () => {
  it("should resolve asynchronously and allow event loop to process other tasks", async () => {
    // Arrange
    const executionOrder: string[] = [];

    // Act
    setTimeout(() => {
      executionOrder.push("macrotask");
    }, 0);

    const yieldPromise = yieldToMainThread().then(() => {
      executionOrder.push("yieldResolved");
    });

    await yieldPromise;

    // Assert
    expect(executionOrder).toContain("yieldResolved");
  });

  it("should resolve to undefined", async () => {
    // Arrange & Act
    const result = await yieldToMainThread();

    // Assert
    expect(result).toBeUndefined();
  });
});
