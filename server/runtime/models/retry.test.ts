// @vitest-environment node
import { describe, expect, it } from "vitest";
import { retryWait } from "./openai";

const res = (status: number, headers: Record<string, string> = {}) => ({ status, headers: new Headers(headers) });

describe("retryWait", () => {
  it("waits as long as Gemini's retryDelay says", () => {
    expect(retryWait(res(429), '[{"error":{"details":[{"retryDelay": "36s"}]}}]', 0)).toBe(36_500);
  });
  it("honours Retry-After", () => {
    expect(retryWait(res(429, { "retry-after": "7" }), "{}", 0)).toBe(7000);
  });
  it("backs off on overloads and server errors", () => {
    expect(retryWait(res(503), "high demand", 0)).toBe(2000);
    expect(retryWait(res(503), "high demand", 2)).toBe(8000);
  });
  it("gives up on exhausted credit, daily quotas, client errors, and after five tries", () => {
    expect(retryWait(res(429), '{"error":{"code":"credit_balance_exhausted","type":"insufficient_quota"}}', 0)).toBeNull();
    expect(retryWait(res(429), '"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier"', 0)).toBeNull();
    expect(retryWait(res(400), "bad request", 0)).toBeNull();
    expect(retryWait(res(503), "", 5)).toBeNull();
  });
});
