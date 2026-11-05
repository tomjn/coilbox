import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { i18n } from "@lingui/core";
import { afterEach, describe, expect, it } from "vitest";
import type { Metric, MetricRatio } from "./bindings";
import {
  labelOfMetric,
  labelOfRatio,
  METRIC_LABEL,
  RATIO_LABEL,
} from "./metricLabels";

/**
 * The words for the registry's metrics and ratios live in `metricLabels.ts`. The
 * registry itself is Rust, so these read its source for the keys it publishes,
 * as `metricRegistry.test.ts` does, and fail when a key has no entry here.
 */

const METRICS_RS = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "crates/tauri-plugin-coilbox-content/src/metrics.rs",
);

const source = readFileSync(METRICS_RS, "utf8");

/** Every key the Rust registry publishes, from the entries after `<marker>`. */
function publishedKeys(marker: string, call: string): string[] {
  const table = source.slice(source.indexOf(marker));
  return (
    [...table.matchAll(new RegExp(`\\b${call}\\(\\s*"([A-Za-z]+)"`, "g"))]
      .map((m) => m[1])
      // The helper's own definition is `const fn ratio(` and never has a string.
      .sort()
  );
}

/** The English label the Rust registry gives each key. */
function publishedLabels(marker: string, call: string): Map<string, string> {
  const table = source.slice(source.indexOf(marker));
  return new Map(
    [
      ...table.matchAll(
        new RegExp(`\\b${call}\\(\\s*"([A-Za-z]+)",\\s*"([^"]+)"`, "g"),
      ),
    ].map((m) => [m[1], m[2]]),
  );
}

afterEach(() => {
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

describe("the metric label table", () => {
  it("has an entry for every metric the registry publishes, and no others", () => {
    const keys = publishedKeys("pub const METRICS", "metric");
    expect(keys.length, "the registry parse found nothing").toBeGreaterThan(0);
    expect(Object.keys(METRIC_LABEL).sort()).toEqual(keys);
  });

  it("has an entry for every ratio the registry publishes, and no others", () => {
    const keys = publishedKeys("pub const RATIOS", "ratio");
    expect(keys.length, "the registry parse found nothing").toBeGreaterThan(0);
    expect(Object.keys(RATIO_LABEL).sort()).toEqual(keys);
  });

  it("reads the same English as the registry, so the fallback and the table agree", () => {
    const labels = publishedLabels("pub const METRICS", "metric");
    for (const [key, descriptor] of Object.entries(METRIC_LABEL))
      expect(descriptor.message, key).toBe(labels.get(key));
    const ratios = publishedLabels("pub const RATIOS", "ratio");
    for (const [key, descriptor] of Object.entries(RATIO_LABEL))
      expect(descriptor.message, key).toBe(ratios.get(key));
  });
});

describe("labelOfMetric and labelOfRatio", () => {
  const key = Object.keys(METRIC_LABEL)[0] as Metric["key"];
  const metric = { key, label: "Registry English" };
  const ratioKey = Object.keys(RATIO_LABEL)[0];
  const ratio = { key: ratioKey, label: "Registry English" } as Pick<
    MetricRatio,
    "key" | "label"
  >;

  it("answers from the active catalog", () => {
    i18n.loadAndActivate({
      locale: "fr",
      messages: {
        [METRIC_LABEL[key].id as string]: "Metric in French",
        [RATIO_LABEL[ratioKey].id as string]: "Ratio in French",
      },
    });
    expect(labelOfMetric(metric)).toBe("Metric in French");
    expect(labelOfRatio(ratio)).toBe("Ratio in French");
  });

  it("answers in the table's English when the catalog has no entry", () => {
    expect(labelOfMetric(metric)).toBe(METRIC_LABEL[key].message);
    expect(labelOfRatio(ratio)).toBe(RATIO_LABEL[ratioKey].message);
  });

  it("falls back to the registry's label for a key the table does not have", () => {
    const unknown = {
      key: "notInTheTable" as Metric["key"],
      label: "From Rust",
    };
    expect(labelOfMetric(unknown)).toBe("From Rust");
    expect(labelOfRatio({ key: "notInTheTable", label: "From Rust" })).toBe(
      "From Rust",
    );
  });
});
