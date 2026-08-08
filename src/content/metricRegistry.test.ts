import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The metric registry crosses a language boundary, and both halves of it are
 * hand-written: the registry and the decoded sample in Rust, the `Metric` and
 * `TeamStatSample` types in `bindings.ts`. Nothing in either compiler checks the
 * other, so these read both sources and compare them.
 *
 * The last test is the one that matters. Four surfaces are about to show these
 * metrics, and a surface that writes its own list of keys is exactly the drift
 * the registry exists to prevent, so a key spelled out anywhere but the bindings
 * fails here.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(REPO, "src");
const MODEL_RS = join(REPO, "crates/tauri-plugin-coilbox-content/src/model.rs");
const METRICS_RS = join(
  REPO,
  "crates/tauri-plugin-coilbox-content/src/metrics.rs",
);
const BINDINGS = join(SRC, "content/bindings.ts");

/** Files allowed to name a metric: the published bindings, and this test. */
const MAY_NAME_METRICS = [
  "src/content/bindings.ts",
  "src/content/metricRegistry.test.ts",
];

/** The x axis, which is a sample field but not a metric. */
const X_AXIS = "frame";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/** The body of `<keyword> <name> {` ... `}` at the first `}` in column zero. */
function block(source: string, opening: RegExp): string {
  const start = source.search(opening);
  expect(start, `${opening} is not there any more`).toBeGreaterThan(-1);
  const rest = source.slice(start);
  const end = rest.search(/\n\}/);
  expect(end, "the block never closes").toBeGreaterThan(-1);
  return rest.slice(0, end);
}

const camel = (snake: string) =>
  snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** `TeamStatSample`'s fields as the frontend receives them (serde camelCase). */
function rustSampleFields(): string[] {
  const body = block(read(MODEL_RS), /^pub struct TeamStatSample \{/m);
  return [...body.matchAll(/^\s*pub ([a-z][a-z0-9_]*):/gm)].map((m) =>
    camel(m[1]),
  );
}

/** Every key in the Rust registry, in registry order. */
function rustMetricKeys(): string[] {
  const source = read(METRICS_RS);
  const table = source.slice(source.indexOf("pub const METRICS"));
  return [...table.matchAll(/\bmetric\(\s*"([A-Za-z]+)"/g)].map((m) => m[1]);
}

/** `TeamStatSample`'s fields as `bindings.ts` declares them. */
function tsSampleFields(): string[] {
  const body = block(read(BINDINGS), /^export interface TeamStatSample \{/m);
  return [...body.matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9]*)\??:/gm)].map(
    (m) => m[1],
  );
}

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, found);
    else if (/\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

describe("the metric registry", () => {
  it("describes the sample the decoder actually produces", () => {
    const fields = rustSampleFields();
    expect(fields.length, "TeamStatistics is 20 fields").toBe(20);
    expect(rustMetricKeys()).toEqual(fields.filter((f) => f !== X_AXIS));
  });

  it("reaches the frontend under the same names", () => {
    const fields = tsSampleFields();
    expect(fields.length, "the bindings lost the sample type").toBe(20);
    expect(fields).toEqual(rustSampleFields());
  });

  it("is the only place in the frontend that names a metric", () => {
    const keys = rustMetricKeys();
    expect(keys.length, "the registry parse found nothing").toBe(19);
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const rel = relative(REPO, file).split("\\").join("/");
      if (MAY_NAME_METRICS.includes(rel)) continue;
      const source = read(file);
      const named = keys.filter((k) =>
        new RegExp(`(['"\`])${k}\\1`).test(source),
      );
      if (named.length > 0) offenders.push(`${rel}: ${named.join(", ")}`);
    }
    expect(
      offenders,
      "build this surface from contentMetricRegistry instead of a list of its own",
    ).toEqual([]);
  });
});
