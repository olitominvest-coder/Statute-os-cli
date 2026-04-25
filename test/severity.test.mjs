import { describe, expect, test } from "vitest";

import { normalizePreflightSeverity, normalizeScanSeverity, parseFailOn, shouldFail } from "../src/cli/util/severity.mjs";

describe("severity utils", () => {
  test("normalizes severities", () => {
    expect(normalizePreflightSeverity("CRITICAL")).toBe("critical");
    expect(normalizePreflightSeverity("MEDIUM")).toBe("medium");
    expect(normalizePreflightSeverity("LOW")).toBe("low");
    expect(normalizeScanSeverity("high")).toBe("high");
    expect(normalizeScanSeverity("CRITICAL")).toBe("critical");
  });

  test("fail-on threshold works", () => {
    expect(parseFailOn("HIGH")).toBe("high");
    expect(shouldFail({ worstSeverity: "critical", failOn: "high" })).toBe(true);
    expect(shouldFail({ worstSeverity: "medium", failOn: "high" })).toBe(false);
    expect(shouldFail({ worstSeverity: "high", failOn: "none" })).toBe(false);
  });
});

