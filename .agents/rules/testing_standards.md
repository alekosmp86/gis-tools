# Testing Standards & Best Practices

All automated tests in the project must strictly adhere to the following standards:

## 1. Tests as the Definitive Specification (Golden Rule)
- **Zero Test Downgrading**: Never alter, relax, or delete test assertions merely to make failing or buggy code pass.
- **Implementation Correction**: If a valid test specification fails, the underlying source code must be fixed to satisfy the specification—the test is the guiding ground truth.

## 2. Arrange-Act-Assert (AAA) Architecture
- Structure every test clearly into three distinct stages:
  1. **Arrange**: Set up inputs, mock dependencies, and define expected outcomes.
  2. **Act**: Execute the function or method under test.
  3. **Assert**: Verify outputs, state mutations, or exceptions using strict equality or domain-specific assertions.

## 3. Descriptive & Intent-Revealing Naming
- Use clear block hierarchies:
  - `describe("ModuleName or ClassName", () => { ... })`
  - `describe("methodName or sub-feature", () => { ... })`
  - `it("should return expected result when input condition occurs", () => { ... })`
- Never write ambiguous test labels like `test("works")` or `test("handles stuff")`.

## 4. Edge-Case & Boundary Completeness
- Every test suite must cover:
  - **Happy Paths**: Normal expected operations with representative domain datasets.
  - **Boundary Limits**: Maximum/minimum values, coordinate limits, large payloads.
  - **Null, Undefined & Empty States**: Empty arrays, empty strings, missing optional fields, whitespace-only strings.
  - **Malformed / Corrupt Inputs**: Malformed WKT, truncated EWKB, corrupted encoding, invalid delimiters.
  - **Error & Exception Paths**: Verify that expected errors are cleanly thrown or captured.

## 5. Hermetic Isolation & Determinism
- **Zero Inter-Test Coupling**: Each test must run completely independently. Never share mutable global state across tests.
- **Predictable Outcomes**: Tests must never rely on system clock intervals, network calls, random seeds, or execution order.
- **Cleanup**: Always clean up mocks, timers, or state in `beforeEach` / `afterEach`.

## 6. Real Logic Verification (No Mocking of Pure Algorithms)
- For spatial math, parsers, string sanitizers, and encoding engines, test against **real computations** and real inputs rather than mocking internal logic.
- Reserve mocking strictly for external I/O boundaries (PostgreSQL network queries, file system access, browser UI APIs).
