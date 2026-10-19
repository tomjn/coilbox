// @vitest-environment happy-dom

import { msg } from "@lingui/core/macro";
import { beforeEach, describe, expect, it } from "vitest";
import { i18n } from ".";
import {
  describeError,
  parseUiError,
  UI_ERROR_CODES,
  uiErrorMessage,
} from "./uiError";

const exists = JSON.stringify({
  code: UI_ERROR_CODES.packageTargetExists,
  params: { path: "/games/a.sdd" },
  fallback:
    "/games/a.sdd already exists; confirm a replace before packaging over it",
});

// A fixture catalog stands in for a real translation. Lingui keys it by a hash
// of the English source, so the key comes from the same `msg` text.
const path = "";
const { id } =
  msg`${path} already exists; confirm a replace before packaging over it`;
const FIXTURE = { [id]: [["path"] as [string], " existe deja (fixture)"] };

beforeEach(() => {
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

describe("parseUiError", () => {
  it("reads the JSON a UiError becomes", () => {
    expect(parseUiError(exists)).toEqual({
      code: "workshop.package.target_exists",
      params: { path: "/games/a.sdd" },
      fallback:
        "/games/a.sdd already exists; confirm a replace before packaging over it",
    });
  });

  it("wraps a plain string as a fallback-only error", () => {
    expect(parseUiError("could not write the file")).toEqual({
      code: null,
      params: {},
      fallback: "could not write the file",
    });
  });

  it("treats JSON of another shape as plain text", () => {
    for (const text of [
      '{"error":"x"}',
      '{"code":1,"fallback":"x"}',
      "{broken",
      "[1]",
    ]) {
      expect(parseUiError(text)).toEqual({
        code: null,
        params: {},
        fallback: text,
      });
    }
  });
});

describe("describeError", () => {
  it("fills a known code's params into the English source under en", () => {
    expect(describeError(new Error(exists))).toBe(
      "/games/a.sdd already exists; confirm a replace before packaging over it",
    );
  });

  it("uses the active catalog's translation for a known code", () => {
    i18n.loadAndActivate({ locale: "fr", messages: FIXTURE });
    expect(describeError(new Error(exists))).toBe(
      "/games/a.sdd existe deja (fixture)",
    );
  });

  it("shows the fallback for a code the table does not know", () => {
    i18n.loadAndActivate({ locale: "fr", messages: FIXTURE });
    const unknown = JSON.stringify({
      code: "nothing.like.this",
      params: {},
      fallback: "English text",
    });
    expect(describeError(new Error(unknown))).toBe("English text");
  });

  it("passes a plain string, an Error and another value through", () => {
    expect(describeError("plain")).toBe("plain");
    expect(describeError(new Error("boom"))).toBe("boom");
    expect(describeError(42)).toBe("42");
  });
});

/**
 * Every code the Rust crates raise for issue #4596. `english` is the `fallback`
 * the crate sends, so it also pins that the table and the crate say the same
 * sentence. `translated` is a fixture catalog entry in Lingui's compiled form.
 */
const CASES: {
  code: string;
  params: Record<string, string>;
  english: string;
  translated: unknown[];
}[] = [
  {
    code: "play.autohost.not_connected",
    params: {},
    english: "The game has not connected to coilbox.",
    translated: ["Le jeu (fixture) ne s'est pas connecte."],
  },
  {
    code: "play.autohost.not_started",
    params: {},
    english: "The game has not started yet.",
    translated: ["Le jeu (fixture) n'a pas demarre."],
  },
  {
    code: "play.autohost.no_answer",
    params: { seconds: "10" },
    english: "The game did not answer within 10 seconds. Its infolog says why.",
    translated: ["Pas de reponse (fixture) en ", ["seconds"], " secondes."],
  },
  {
    code: "multiplayer.login.refused",
    params: {},
    english: "the server refused the login",
    translated: ["connexion refusee (fixture)"],
  },
  {
    code: "multiplayer.login.ended",
    params: {},
    english: "the connection ended before the login finished",
    translated: ["connexion terminee (fixture)"],
  },
  {
    code: "multiplayer.login.timeout",
    params: { seconds: "20" },
    english: "the login did not finish within 20s",
    translated: ["connexion non terminee (fixture) en ", ["seconds"], "s"],
  },
  {
    code: "downloads.fetch.https_only",
    params: {},
    english: "Import URLs must be https.",
    translated: ["https seulement (fixture)"],
  },
  {
    code: "downloads.fetch.timeout",
    params: {},
    english: "The host took too long to respond.",
    translated: ["delai depasse (fixture)"],
  },
  {
    code: "downloads.fetch.unreachable",
    params: {},
    english: "Could not reach the host.",
    translated: ["hote injoignable (fixture)"],
  },
  {
    code: "downloads.fetch.status",
    params: { status: "404" },
    english: "The host returned an error (404).",
    translated: ["erreur (fixture) ", ["status"]],
  },
  {
    code: "downloads.fetch.too_large",
    params: {},
    english: "That import is too large to be a coilbox import.",
    translated: ["trop grand (fixture)"],
  },
  {
    code: "downloads.fetch.interrupted",
    params: {},
    english: "The download failed part way through.",
    translated: ["interrompu (fixture)"],
  },
  {
    code: "downloads.fetch.not_an_import",
    params: {},
    english: "That import is not a coilbox import.",
    translated: ["pas un import (fixture)"],
  },
  {
    code: "hub.endpoint.not_a_hub",
    params: {},
    english: "That address answered, but it is not a coilbox hub.",
    translated: ["pas un hub (fixture)"],
  },
  {
    code: "hub.endpoint.stopped_answering",
    params: {},
    english: "The hub stopped answering part way through.",
    translated: ["hub muet (fixture)"],
  },
  {
    code: "workshop.test.no_edits",
    params: {},
    english:
      "This project has no edits a mutator archive can carry, so there is nothing to test.",
    translated: ["rien a tester (fixture)"],
  },
  {
    code: "workshop.package.no_edits",
    params: {},
    english:
      "This project has no edits a mutator archive can carry, so there is nothing to package.",
    translated: ["rien a empaqueter (fixture)"],
  },
  {
    code: "workshop.tweak_slots.explosion_effect",
    params: {},
    english:
      "This project has a custom explosion effect. A tweak slot cannot carry the effects file it needs, so packing it into a lobby chat line would silently break it. Use the mutator or edit-in-place route instead.",
    translated: ["effet d'explosion (fixture)"],
  },
  {
    code: "workshop.tweak_slots.no_edits",
    params: {},
    english:
      "This project has no edits, so there is nothing to pack for a lobby.",
    translated: ["rien a emballer (fixture)"],
  },
];

describe("the codes the Rust crates raise", () => {
  for (const { code, params, english, translated } of CASES) {
    const error = JSON.stringify({ code, params, fallback: english });

    it(`${code} reads as the crate's English under en`, () => {
      expect(describeError(new Error(error))).toBe(english);
    });

    it(`${code} uses the active catalog's translation`, () => {
      const descriptor = uiErrorMessage(parseUiError(error));
      expect(descriptor).toBeDefined();
      i18n.loadAndActivate({
        locale: "fr",
        messages: { [descriptor?.id ?? ""]: translated as never },
      });
      const text = describeError(new Error(error));
      expect(text).not.toBe(english);
      expect(text).toContain("(fixture)");
      for (const value of Object.values(params)) expect(text).toContain(value);
    });
  }
});

describe("the workshop blocker counts", () => {
  const blockers = "supercom: two clones share a key; armcom: no model";
  const english = (code: string, count: number, tail: string) =>
    JSON.stringify({
      code,
      params: { count: String(count), blockers },
      fallback: `${count} blocker${count === 1 ? "" : "s"} ${tail}: ${blockers}`,
    });

  it("says blocker for one and blockers for two", () => {
    expect(
      describeError(
        new Error(
          english(
            "workshop.package.blockers",
            1,
            "would reach whoever plays this broken, so it was not packaged",
          ),
        ),
      ),
    ).toBe(
      `1 blocker would reach whoever plays this broken, so it was not packaged: ${blockers}`,
    );
    expect(
      describeError(
        new Error(
          english(
            "workshop.tweak_slots.blockers",
            2,
            "would reach the lobby broken, so it was not packed",
          ),
        ),
      ),
    ).toBe(
      `2 blockers would reach the lobby broken, so it was not packed: ${blockers}`,
    );
  });

  it("takes its plural from the active catalog", () => {
    const error = english("workshop.package.blockers", 2, "x");
    const descriptor = uiErrorMessage(parseUiError(error));
    i18n.loadAndActivate({
      locale: "fr",
      messages: {
        [descriptor?.id ?? ""]: [
          [
            "count",
            "plural",
            {
              one: ["#", " bloqueur (fixture) ", ["blockers"]],
              other: ["#", " bloqueurs (fixture) ", ["blockers"]],
            },
          ],
        ] as never,
      },
    });
    expect(describeError(new Error(error))).toBe(
      `2 bloqueurs (fixture) ${blockers}`,
    );
  });
});
