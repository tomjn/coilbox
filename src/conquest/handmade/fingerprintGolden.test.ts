/**
 * The fingerprint of the sample map, pinned (issue #3512). A challenge code
 * carries this value from one machine to another, so it has to come out the
 * same on Windows, macOS and Linux. The file name holds `Golden.test` so the
 * cross-platform CI job runs it on all three.
 *
 * A change to this value means every challenge code already shared on a
 * hand-made map stops matching its map. Change what is hashed only by leaving
 * a new field out when a map does not use it (see `./fingerprint`).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FINGERPRINT_BITS,
  fingerprintText,
  handmadeMapFingerprint,
} from "./fingerprint";
import { decodePng } from "./png.testhelper";
import { readHandmadeMap } from "./read";

const SAMPLE = fileURLToPath(
  new URL("../../../docs/examples/handmade-map/", import.meta.url),
);

function readSample() {
  const provinces = decodePng(readFileSync(`${SAMPLE}provinces.png`));
  const result = readHandmadeMap({
    manifest: readFileSync(`${SAMPLE}map.json`, "utf8"),
    provinces,
    picture: { width: provinces.width, height: provinces.height },
    urlFor: (name) => `coilbox://sample/${name}`,
    scenarios: {
      "ironcoast-siege.json": readFileSync(
        `${SAMPLE}ironcoast-siege.json`,
        "utf8",
      ),
    },
  });
  if (!result.ok) {
    throw new Error(result.errors.map((e) => e.message).join("\n"));
  }
  return result.doc;
}

describe("the sample map's fingerprint", () => {
  const doc = readSample();

  it("is the pinned value", () => {
    expect(doc.handmade?.fingerprint).toBe("28e347f8df860fd7");
    expect(handmadeMapFingerprint(doc)).toBe("28e347f8df860fd7");
  });

  it("is as many hex digits as its size in bits needs", () => {
    expect(doc.handmade?.fingerprint).toHaveLength(FINGERPRINT_BITS / 4);
  });

  it("is hashed from the pinned text", () => {
    expect(fingerprintText(doc)).toBe(
      readFileSync(
        fileURLToPath(
          new URL(
            "../fixtures/handmade/sample-fingerprint.txt",
            import.meta.url,
          ),
        ),
        "utf8",
      ).trim(),
    );
  });
});
