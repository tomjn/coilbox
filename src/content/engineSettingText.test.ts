import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { i18n } from "@lingui/core";
import { afterEach, describe, expect, it } from "vitest";
import type { EngineConfigSetting } from "./bindings";
import {
  ENGINE_SETTING_HINT,
  ENGINE_SETTING_LABEL,
  ENGINE_SETTING_OPTION,
  translateEngineSetting,
} from "./engineSettingText";

/**
 * The words for the worker's engine settings live in `engineSettingText.ts`.
 * The catalog itself is Rust, so these read its source, as
 * `metricLabels.test.ts` does, and fail when the two disagree.
 */

const CONFIG_RS = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "crates/coilbox-unitsync-worker/src/config.rs",
);

interface Entry {
  key: string;
  label: string;
  hint?: string;
  options: Record<string, string>;
}

function catalog(): Entry[] {
  const source = readFileSync(CONFIG_RS, "utf8");
  const table = source.slice(
    source.indexOf("const CATALOG"),
    source.indexOf("const fn cv("),
  );
  return table
    .split(/\bcv\(/)
    .slice(1)
    .map((chunk) => {
      const [key, label] = [...chunk.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
      const hint = chunk.match(/Some\("([^"]*)"\)/)?.[1];
      const options = Object.fromEntries(
        [...chunk.matchAll(/\((-?\d+),\s*"([^"]+)"\)/g)].map((m) => [
          m[1],
          m[2],
        ]),
      );
      return { key, label, hint, options };
    });
}

afterEach(() => {
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

describe("the engine setting text tables", () => {
  const entries = catalog();

  it("has a label for every catalog key, in the same English", () => {
    expect(entries.length, "the catalog parse found nothing").toBeGreaterThan(
      0,
    );
    expect(Object.keys(ENGINE_SETTING_LABEL).sort()).toEqual(
      entries.map((e) => e.key).sort(),
    );
    for (const e of entries)
      expect(ENGINE_SETTING_LABEL[e.key].message, e.key).toBe(e.label);
  });

  it("has the same hints as the catalog", () => {
    const hinted = entries.filter((e) => e.hint);
    expect(Object.keys(ENGINE_SETTING_HINT).sort()).toEqual(
      hinted.map((e) => e.key).sort(),
    );
    for (const e of hinted)
      expect(ENGINE_SETTING_HINT[e.key].message, e.key).toBe(e.hint);
  });

  it("has the same choices as the catalog", () => {
    const withOptions = entries.filter((e) => Object.keys(e.options).length);
    expect(Object.keys(ENGINE_SETTING_OPTION).sort()).toEqual(
      withOptions.map((e) => e.key).sort(),
    );
    for (const e of withOptions) {
      const ours = Object.fromEntries(
        Object.entries(ENGINE_SETTING_OPTION[e.key]).map(([v, d]) => [
          v,
          d.message,
        ]),
      );
      expect(ours, e.key).toEqual(e.options);
    }
  });
});

describe("translateEngineSetting", () => {
  const setting: EngineConfigSetting = {
    key: "VSync",
    label: "VSync from Rust",
    category: "Display",
    type: "enum",
    value: "-1",
    default: "-1",
    hint: "Hint from Rust",
    options: [
      { value: "-1", label: "Adaptive from Rust" },
      { value: "7", label: "7" },
    ],
  };

  it("answers from the active catalog", () => {
    i18n.loadAndActivate({
      locale: "fr",
      messages: {
        [ENGINE_SETTING_LABEL.VSync.id as string]: "Synchro verticale",
        [ENGINE_SETTING_OPTION.VSync["-1"].id as string]: "Adaptative",
      },
    });
    const shown = translateEngineSetting(setting);
    expect(shown.label).toBe("Synchro verticale");
    expect(shown.options?.[0].label).toBe("Adaptative");
  });

  it("keeps the worker's words for anything the tables do not have", () => {
    const shown = translateEngineSetting({ ...setting, key: "NotInTheTable" });
    expect(shown.label).toBe("VSync from Rust");
    expect(shown.hint).toBe("Hint from Rust");
    expect(shown.options?.map((o) => o.label)).toEqual([
      "Adaptive from Rust",
      "7",
    ]);
  });
});
