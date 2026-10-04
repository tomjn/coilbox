import { describe, expect, it } from "vitest";
import { engineVersionRequirement } from "@/content/resolveContent";
import {
  concludeEngine,
  type InstalledEngine,
  type Verification,
} from "./engineConfirmation";

const WANT = "2026.03.01";
const wants = [engineVersionRequirement(WANT)];

const verified = (executable: string, version: string): InstalledEngine => ({
  executable,
  folder: version,
  verified: version,
});
const unverified = (executable: string, folder: string): InstalledEngine => ({
  executable,
  folder,
});
const said = (executable: string, reported: string): Verification => ({
  executable,
  reported,
});
const failed = (executable: string, reason = "boom"): Verification => ({
  executable,
  reported: null,
  reason,
});

describe("concludeEngine", () => {
  it("installs on a verified engine that reports the version, with no verification", () => {
    expect(concludeEngine(wants, [verified("/a", WANT)], [])).toEqual({
      kind: "installed",
    });
  });

  it("asks an unverified engine in a folder named for the version", () => {
    expect(concludeEngine(wants, [unverified("/a", WANT)], [])).toEqual({
      kind: "verify",
      executable: "/a",
    });
  });

  it("installs when that engine reports the version", () => {
    expect(
      concludeEngine(wants, [unverified("/a", WANT)], [said("/a", WANT)]),
    ).toEqual({ kind: "installed" });
  });

  it("treats the version as missing when that engine reports another one", () => {
    expect(
      concludeEngine(
        wants,
        [unverified("/a", WANT)],
        [said("/a", "2025.06.20")],
      ),
    ).toEqual({ kind: "missing" });
  });

  it("does not guess when the engine cannot be verified", () => {
    const c = concludeEngine(
      wants,
      [unverified("/a", WANT)],
      [failed("/a", "engine version check timed out")],
    );
    expect(c).toMatchObject({ kind: "unconfirmed", executable: "/a" });
    expect(c.kind === "unconfirmed" && c.reason).toContain(
      "engine version check timed out",
    );
    expect(c.kind === "unconfirmed" && c.reason).toContain(WANT);
  });

  it("verifies the folder named for the version beside a verified other engine (the issue's case)", () => {
    const engines = [
      verified("/a", "2025.06.20"),
      unverified("/b", "2026.03.01"),
    ];
    expect(concludeEngine(wants, engines, [])).toEqual({
      kind: "verify",
      executable: "/b",
    });
    expect(concludeEngine(wants, engines, [said("/b", WANT)])).toEqual({
      kind: "installed",
    });
    expect(concludeEngine(wants, engines, [said("/b", "2025.01.01")])).toEqual({
      kind: "missing",
    });
  });

  it("is unaffected when the launch names no engine version", () => {
    const engines = [unverified("/a", WANT), unverified("/b", "other")];
    expect(concludeEngine([], engines, [])).toEqual({ kind: "unaffected" });
  });

  it("verifies only the folder named for the version among unverified ones", () => {
    const engines = [
      unverified("/a", "2025.06.20"),
      unverified("/b", WANT),
      unverified("/c", "something-else"),
    ];
    expect(concludeEngine(wants, engines, [])).toEqual({
      kind: "verify",
      executable: "/b",
    });
  });

  it("is missing, with no verification, when no folder is named for the version", () => {
    const engines = [
      unverified("/a", "2025.06.20"),
      verified("/b", "2025.01.01"),
    ];
    expect(concludeEngine(wants, engines, [])).toEqual({ kind: "missing" });
  });

  it("never reads a verified engine's folder name as its version", () => {
    const engines = [
      { executable: "/a", folder: WANT, verified: "2025.06.20" },
    ];
    expect(concludeEngine(wants, engines, [])).toEqual({ kind: "missing" });
  });

  it("asks each unverified folder named for the version, one at a time", () => {
    const engines = [unverified("/a", WANT), unverified("/b", WANT)];
    expect(concludeEngine(wants, engines, [])).toEqual({
      kind: "verify",
      executable: "/a",
    });
    expect(concludeEngine(wants, engines, [said("/a", "2025.01.01")])).toEqual({
      kind: "verify",
      executable: "/b",
    });
    expect(
      concludeEngine(wants, engines, [
        said("/a", "2025.01.01"),
        said("/b", WANT),
      ]),
    ).toEqual({ kind: "installed" });
  });

  it("prefers an answer that matched over one that failed", () => {
    const engines = [unverified("/a", WANT), unverified("/b", WANT)];
    expect(
      concludeEngine(wants, engines, [failed("/a"), said("/b", WANT)]),
    ).toEqual({ kind: "installed" });
  });

  it("matches the way the requirement matches, not by exact text", () => {
    const loose = [
      {
        ...engineVersionRequirement("2024.11.30"),
        isInstalled: (i: { engineVersions: string[] }) =>
          i.engineVersions.some((v) => v.startsWith("2024.11.30")),
      },
    ] as ReturnType<typeof engineVersionRequirement>[];
    expect(
      concludeEngine(loose, [unverified("/a", "2024.11.30 BAR105")], []),
    ).toEqual({ kind: "verify", executable: "/a" });
  });
});
