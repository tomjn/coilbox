import { describe, expect, it } from "vitest";
import { formatErrorReport, newIssueUrl, REPO_URL } from "./errorReport";

describe("formatErrorReport", () => {
  it("includes route, version, message and both stacks", () => {
    const out = formatErrorReport({
      message: "Can't find variable: pendingNode",
      route: "#/runlite/run",
      jsStack: "at RunPage (RunPage.tsx:46)",
      componentStack: "\n    in RunPage\n    in ErrorBoundary",
      version: "1.2.3",
    });
    expect(out).toContain("**Route:** #/runlite/run");
    expect(out).toContain("**Version:** 1.2.3");
    expect(out).toContain("**Error:** Can't find variable: pendingNode");
    expect(out).toContain("<summary>Stack</summary>");
    expect(out).toContain("<summary>Component stack</summary>");
    expect(out).toContain("in RunPage");
  });

  it("omits optional sections when absent and marks an unknown route", () => {
    const out = formatErrorReport({ message: "boom", route: "" });
    expect(out).toContain("**Route:** (unknown)");
    expect(out).not.toContain("**Version:**");
    expect(out).not.toContain("<summary>Stack</summary>");
    expect(out).not.toContain("<summary>Component stack</summary>");
  });
});

describe("newIssueUrl", () => {
  it("builds a prefilled, encoded new-issue URL", () => {
    const url = newIssueUrl("**Error:** boom & bang", "Crash");
    expect(
      url.startsWith(`${REPO_URL}/issues/new?labels=bug&title=Crash&body=`),
    ).toBe(true);
    // Ampersands in the body must be encoded so they don't split query params.
    expect(url).toContain("boom%20%26%20bang");
  });

  it("truncates an oversized body so the URL stays bounded", () => {
    const huge = "x".repeat(50_000);
    const url = newIssueUrl(huge);
    expect(url.length).toBeLessThanOrEqual(7000);
    expect(decodeURIComponent(url)).toContain("truncated");
  });

  it("leaves a small body untruncated", () => {
    const url = newIssueUrl("short body");
    expect(decodeURIComponent(url)).not.toContain("truncated");
    expect(decodeURIComponent(url)).toContain("short body");
  });
});
