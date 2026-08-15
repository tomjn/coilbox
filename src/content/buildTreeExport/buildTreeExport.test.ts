import { describe, expect, it } from "vitest";
import type { Side, UnitDatasetEntry } from "../bindings";
import { buildExportInput, type PicEntry } from "./buildInput";
import { buildExportArtifact } from "./index";
import type { ExportArtifact, ExportInput } from "./types";

const units: UnitDatasetEntry[] = [
  {
    name: "armcom",
    fullName: "Arm Commander",
    mobile: true,
    buildOptions: ["armsolar", "armlab"],
  },
  { name: "armsolar", fullName: "Solar Collector", mobile: false },
  {
    name: "armlab",
    fullName: "Bot Lab",
    mobile: false,
    buildOptions: ["armpw"],
  },
  { name: "armpw", fullName: "Peewee", mobile: true },
  {
    name: "corecom",
    fullName: "Core Commander",
    mobile: true,
    buildOptions: ["cormex"],
  },
  { name: "cormex", fullName: "Metal Extractor", mobile: false },
];

const sides: Side[] = [
  { name: "Arm", startUnit: "armcom", startUnitName: "Arm Commander" },
  { name: "Core", startUnit: "corecom", startUnitName: "Core Commander" },
] as Side[];

const pics: Record<string, PicEntry> = {
  armcom: { name: "Arm Commander", icon: "data:image/png;base64,QQ==" },
  armlab: {
    name: "Bot Lab",
    icon: "data:image/jpeg;base64, Qq==".replace(" ", ""),
  },
  // armsolar/armpw intentionally have no pic -> placeholder path exercised
};

function input(
  overrides: Partial<Parameters<typeof buildExportInput>[0]> = {},
) {
  return buildExportInput({
    gameName: "Test Game",
    sides,
    units,
    pics,
    date: "2026-07-21",
    ...overrides,
  });
}

describe("buildExportInput", () => {
  it("builds one faction per side with a reachable graph", () => {
    const inp = input();
    expect(inp.factions.map((f) => f.side)).toEqual(["Arm", "Core"]);
    const arm = inp.factions[0];
    expect(arm.nodes.map((n) => n.id).sort()).toEqual([
      "armcom",
      "armlab",
      "armpw",
      "armsolar",
    ]);
  });

  it("classifies commander/builder/mobile/building by drawer precedence", () => {
    const arm = input().factions[0];
    const kind = (id: string) => arm.nodes.find((n) => n.id === id)?.kind;
    expect(kind("armcom")).toBe("commander");
    expect(kind("armlab")).toBe("builder");
    expect(kind("armpw")).toBe("mobile");
    expect(kind("armsolar")).toBe("building");
  });

  it("splits tree vs extra edges and lays out positions", () => {
    const arm = input().factions[0];
    expect(arm.edges.some((e) => !e.extra)).toBe(true);
    expect(arm.width).toBeGreaterThan(0);
    expect(arm.height).toBeGreaterThan(0);
    // Positions differ (not all stacked at origin).
    const ys = new Set(arm.nodes.map((n) => n.y));
    expect(ys.size).toBeGreaterThan(1);
  });

  it("narrows to the current faction when given one side", () => {
    const inp = input({ sides: [sides[0]] });
    expect(inp.factions.map((f) => f.side)).toEqual(["Arm"]);
  });
});

function html(a: ExportArtifact): string {
  if (a.format !== "html") throw new Error("expected html");
  return a.html;
}

describe("buildExportArtifact html", () => {
  const opts = { scope: "all", wrapper: "neutral", format: "html" } as const;

  it("inlines css, js and pic data URLs into one file", () => {
    const out = html(buildExportArtifact(input(), opts));
    expect(out).toContain("<style>");
    expect(out).toContain("<script>");
    expect(out).toContain("data:image/png;base64,QQ==");
    expect(out).not.toContain('href="assets/tree.css"');
  });

  it("renders a no-pic placeholder rather than a broken image", () => {
    const out = html(buildExportArtifact(input(), opts));
    // armsolar has no pic
    expect(out).toContain("no pic");
  });

  it("marks a unit whose pic coilbox could not read (#1625)", () => {
    const out = html(
      buildExportArtifact(
        input({
          pics: {
            ...pics,
            armsolar: { name: "Solar Collector", iconSkipped: "undecodable" },
          },
        }),
        opts,
      ),
    );
    expect(out).toContain("bad pic");
    expect(out).toMatch(/<title>Coilbox cannot read/);
  });

  it("carries no coilbox/unitsync/react-flow runtime reference", () => {
    const out = html(buildExportArtifact(input(), opts)).toLowerCase();
    expect(out).not.toContain("xyflow");
    expect(out).not.toContain("react-flow");
    expect(out).not.toContain("unitsync");
    expect(out).not.toContain("coilbox://");
  });

  it("isolates the date on a single footer element", () => {
    const out = html(buildExportArtifact(input(), opts));
    const m = out.match(/class="export-date">([^<]+)</);
    expect(m?.[1]).toBe("2026-07-21");
    expect(out.split("2026-07-21").length).toBe(2); // date appears once
  });

  it("shows faction tabs for all-scope, hides them for one faction", () => {
    const all = html(buildExportArtifact(input(), opts));
    expect(all).toContain('role="tablist"');
    const one = html(buildExportArtifact(input({ sides: [sides[0]] }), opts));
    expect(one).not.toContain('role="tablist"');
  });
});

describe("branded vs neutral wrapper", () => {
  const branding = {
    title: "Total Annihilation",
    bannerDataUrl: "data:image/jpeg;base64,YmF=",
    logoDataUrl: "data:image/png;base64,bG8=",
    links: [{ label: "Discord", url: "https://example.test" }],
  };

  it("branded uses catalog title, banner and links", () => {
    const out = html(
      buildExportArtifact(input({ branding }), {
        scope: "all",
        wrapper: "branded",
        format: "html",
      }),
    );
    expect(out).toContain("Total Annihilation");
    expect(out).toContain("data:image/jpeg;base64,YmF");
    expect(out).toContain("https://example.test");
  });

  it("neutral ignores branding and uses the game name", () => {
    const out = html(
      buildExportArtifact(input({ branding }), {
        scope: "all",
        wrapper: "neutral",
        format: "html",
      }),
    );
    expect(out).toContain("Test Game");
    expect(out).not.toContain("data:image/jpeg;base64,YmF");
  });

  it("branded falls back to the game name when no catalog entry", () => {
    const out = html(
      buildExportArtifact(input(), {
        scope: "all",
        wrapper: "branded",
        format: "html",
      }),
    );
    expect(out).toContain("Test Game");
  });
});

describe("buildExportArtifact zip", () => {
  const opts = { scope: "all", wrapper: "neutral", format: "zip" } as const;

  it("emits index.html, assets and per-unit images", () => {
    const a = buildExportArtifact(input(), opts);
    if (a.format !== "zip") throw new Error("expected zip");
    const paths = a.files.map((f) => f.path);
    expect(paths).toContain("index.html");
    expect(paths).toContain("assets/tree.css");
    expect(paths).toContain("assets/tree.js");
    expect(paths.some((p) => p.startsWith("images/armcom."))).toBe(true);
    // Images carry base64 bytes, not text.
    const img = a.files.find((f) => f.path.startsWith("images/armcom."));
    expect(img?.base64).toBe("QQ==");
    expect(img?.text).toBeUndefined();
  });

  it("index.html links assets and uses relative image refs, not data URLs", () => {
    const a = buildExportArtifact(input(), opts);
    if (a.format !== "zip") throw new Error("expected zip");
    const index = a.files.find((f) => f.path === "index.html")?.text ?? "";
    expect(index).toContain('href="assets/tree.css"');
    expect(index).toContain('src="assets/tree.js"');
    expect(index).toContain("images/armcom.png");
    expect(index).not.toContain("data:image/png;base64,QQ==");
  });
});

describe("determinism", () => {
  it("produces byte-identical html for the same input", () => {
    const a = html(
      buildExportArtifact(input(), {
        scope: "all",
        wrapper: "branded",
        format: "html",
      }),
    );
    const b = html(
      buildExportArtifact(input(), {
        scope: "all",
        wrapper: "branded",
        format: "html",
      }),
    );
    expect(a).toBe(b);
  });
});

// Type-only guard: ExportInput is what the bridge returns.
const _typecheck: ExportInput = input();
void _typecheck;
