import { describe, it, expect } from "vitest";
import { isQueryBusy } from "@/core/common/queryBusyState";

describe("isQueryBusy", () => {
  it("should report busy for the server render, where isPending is true and isFetching is false", () => {
    // Arrange
    const serverRenderState = { isPending: true, isFetching: false };

    // Act
    const result = isQueryBusy(serverRenderState);

    // Assert
    expect(result).toBe(true);
  });

  it("should report busy for the client hydration render, where both isPending and isFetching are true", () => {
    // Arrange
    const clientHydrationState = { isPending: true, isFetching: true };

    // Act
    const result = isQueryBusy(clientHydrationState);

    // Assert
    expect(result).toBe(true);
  });

  it("should agree between the server render and the client hydration render, so the hydrated DOM never mismatches", () => {
    // Arrange
    const serverRenderState = { isPending: true, isFetching: false };
    const clientHydrationState = { isPending: true, isFetching: true };

    // Act
    const serverBusyFlag = isQueryBusy(serverRenderState);
    const clientHydrationBusyFlag = isQueryBusy(clientHydrationState);

    // Assert
    expect(clientHydrationBusyFlag).toBe(serverBusyFlag);
  });

  it("should report idle once the query has settled with data", () => {
    // Arrange
    const settledState = { isPending: false, isFetching: false };

    // Act
    const result = isQueryBusy(settledState);

    // Assert
    expect(result).toBe(false);
  });

  it("should report busy during a background refetch even though data already arrived", () => {
    // Arrange
    const backgroundRefetchState = { isPending: false, isFetching: true };

    // Act
    const result = isQueryBusy(backgroundRefetchState);

    // Assert
    expect(result).toBe(true);
  });

  it("should report busy for an offline paused query, because isPending stays true while there is no data", () => {
    // Arrange
    const offlinePausedState = { isPending: true, isFetching: false };

    // Act
    const result = isQueryBusy(offlinePausedState);

    // Assert
    expect(result).toBe(true);
  });
});
