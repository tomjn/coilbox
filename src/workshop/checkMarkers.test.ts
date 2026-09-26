import { describe, expect, it } from "vitest";
import type { ArmorProblem } from "./armorClasses";
import {
  compatSubject,
  fieldCheckMarkers,
  fieldMarkersForUnit,
  unitCheckMarkers,
} from "./checkMarkers";
import type { CompatFinding } from "./compatibility";

function finding(over: Partial<CompatFinding> = {}): CompatFinding {
  return {
    id: "test",
    store: "overrides",
    severity: "broken",
    subject: "armcom",
    detail: "detail",
    ...over,
  };
}

describe("compatSubject", () => {
  it("splits an overrides finding scoped to one field", () => {
    expect(
      compatSubject(
        finding({ store: "overrides", subject: "armcom.weapons.0.name" }),
      ),
    ).toEqual({ unit: "armcom", field: "weapons.0.name" });
  });

  it("leaves a whole-unit overrides finding as a unit with no field", () => {
    expect(
      compatSubject(finding({ store: "overrides", subject: "armcom" })),
    ).toEqual({
      unit: "armcom",
    });
  });

  it("never splits another store's subject", () => {
    expect(
      compatSubject(finding({ store: "clones", subject: "arm.co" })),
    ).toEqual({
      unit: "arm.co",
    });
  });
});

describe("unitCheckMarkers", () => {
  it("marks the unit a compatibility finding names, at the finding's severity", () => {
    const markers = unitCheckMarkers(
      [
        finding({
          store: "clones",
          severity: "broken",
          subject: "armcom",
          detail: "gone",
        }),
      ],
      [],
    );
    expect(markers.get("armcom")).toEqual({
      severity: "blocker",
      messages: ["gone"],
    });
  });

  it("marks the unit an armour class problem names, skipping a library-only one", () => {
    const problems: ArmorProblem[] = [
      {
        id: "armcom:armcomlaser:damage",
        message: "unknown class",
        severity: "warning",
      },
      {
        id: "library:someweapon:damage",
        message: "unknown class",
        severity: "warning",
      },
    ];
    const markers = unitCheckMarkers([], problems);
    expect(markers.get("armcom")).toEqual({
      severity: "review",
      messages: ["unknown class"],
    });
    expect(markers.has("library")).toBe(false);
  });

  it("folds a unit's worst severity across several findings", () => {
    const markers = unitCheckMarkers(
      [
        finding({
          store: "clones",
          severity: "review",
          subject: "armcom",
          detail: "a",
        }),
        finding({
          store: "clones",
          severity: "broken",
          subject: "armcom",
          detail: "b",
        }),
      ],
      [],
    );
    expect(markers.get("armcom")?.severity).toBe("blocker");
    expect(markers.get("armcom")?.messages).toEqual(["a", "b"]);
  });

  it("keys a unit lowercased, so a game's own casing still matches", () => {
    const markers = unitCheckMarkers(
      [finding({ store: "clones", subject: "ArmCom", detail: "gone" })],
      [],
    );
    expect(markers.get("armcom")).toBeDefined();
  });
});

describe("fieldCheckMarkers", () => {
  it("marks only a field-scoped overrides finding", () => {
    const markers = fieldCheckMarkers([
      finding({
        store: "overrides",
        subject: "armcom.weapons.0.name",
        detail: "dead",
      }),
      finding({ store: "overrides", subject: "armcom", detail: "whole unit" }),
      finding({ store: "clones", subject: "armcom", detail: "not overrides" }),
    ]);
    expect(markers.size).toBe(1);
    const forUnit = fieldMarkersForUnit(markers, "armcom");
    expect(forUnit["weapons.0.name"]).toEqual({
      severity: "blocker",
      messages: ["dead"],
    });
  });

  it("never confuses the same field path on two units", () => {
    const markers = fieldCheckMarkers([
      finding({ store: "overrides", subject: "armcom.range", detail: "a" }),
      finding({ store: "overrides", subject: "corcom.range", detail: "b" }),
    ]);
    expect(fieldMarkersForUnit(markers, "armcom")).toEqual({
      range: { severity: "blocker", messages: ["a"] },
    });
    expect(fieldMarkersForUnit(markers, "corcom")).toEqual({
      range: { severity: "blocker", messages: ["b"] },
    });
  });
});
