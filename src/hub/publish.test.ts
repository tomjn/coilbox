import { beforeEach, describe, expect, it, vi } from "vitest";

/** What the mocked `hub_publish` command was handed, and what it answers with. */
const sent: unknown[] = [];
const answer: { value: unknown; throws: string | null } = {
  value: { status: 201, body: null },
  throws: null,
};

vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async (args: unknown) => {
    sent.push(args);
    if (answer.throws) throw new Error(answer.throws);
    return answer.value;
  },
}));

import { makeContainer } from "@/container/container";
import {
  hubItemPageUrl,
  publishFailureMessage,
  publishToHub,
  splitTags,
  whyNotPublishable,
} from "./publish";

const BASE = "https://hub.example";

/** A share code as the drawer would hand one over. Raw JSON rather than a
 * base64 code: `identify()` reads either, and this keeps the test readable. */
function code(kind: "preset" | "campaign", payload: unknown = {}): string {
  return JSON.stringify(makeContainer(kind, 1, payload));
}

const PRESET = code("preset", {
  gameName: "Beyond All Reason test-1",
  mapName: "Comet Catcher Remake",
  participants: [],
});

function publication(overrides: Partial<{ code: string; title: string }> = {}) {
  return {
    code: PRESET,
    title: "A title",
    description: "",
    tags: [],
    ...overrides,
  };
}

beforeEach(() => {
  sent.length = 0;
  answer.value = { status: 201, body: null };
  answer.throws = null;
});

describe("whyNotPublishable", () => {
  it("takes a container of a kind the hub carries", () => {
    expect(whyNotPublishable(publication())).toBeNull();
  });

  it("refuses something coilbox did not make", () => {
    expect(whyNotPublishable(publication({ code: "hello" }))).toContain(
      "not something coilbox made",
    );
  });

  it("names the kinds the hub does not carry, rather than sending them", () => {
    expect(whyNotPublishable(publication({ code: code("campaign") }))).toBe(
      "The hub does not carry campaigns yet.",
    );
  });

  it("refuses an untitled publication", () => {
    expect(whyNotPublishable(publication({ title: "  " }))).toContain(
      "Give it a title",
    );
  });

  it("refuses a container past the size the app would import", () => {
    const big = code("preset", {
      gameName: "g",
      mapName: "m",
      participants: [],
      notes: "x".repeat(600 * 1024),
    });
    expect(whyNotPublishable(publication({ code: big }))).toContain(
      "too large to share",
    );
  });
});

describe("splitTags", () => {
  it("splits on commas and drops the blanks", () => {
    expect(splitTags(" 1v1, cheese ,, ")).toEqual(["1v1", "cheese"]);
  });
});

describe("publishFailureMessage", () => {
  it("names the hourly limit behind a 429", () => {
    const said = publishFailureMessage(429, {
      error: "Could not publish it: Too many published in the last hour.",
    });
    expect(said).toContain("20 things in the last hour");
  });

  it("names the cold start behind a 5xx, in the wording the read side uses", () => {
    expect(publishFailureMessage(503, null)).toContain("waking up");
  });

  it("sends a rejected sign-in back to the settings section", () => {
    expect(publishFailureMessage(401, { error: "..." })).toContain("Settings");
  });

  it("passes the hub's own refusal through, since it is already a sentence", () => {
    expect(
      publishFailureMessage(422, {
        error: "That share code could not be read.",
      }),
    ).toBe("That share code could not be read.");
  });
});

describe("publishToHub", () => {
  it("never reaches the hub with something it would refuse", async () => {
    const result = await publishToHub(BASE, publication({ title: "" }));
    expect(result).toEqual({
      ok: false,
      reason: "Give it a title so people know what it is.",
    });
    expect(sent).toHaveLength(0);
  });

  it("sends the trimmed publication and the hub address", async () => {
    answer.value = {
      status: 201,
      body: {
        format: "coilbox-hub-item",
        version: 1,
        item: { id: "abc", container_url: `${BASE}/i/abc` },
      },
    };
    const result = await publishToHub(BASE, {
      ...publication({ title: "  Padded  " }),
      description: " words ",
      tags: ["one"],
    });
    expect(result).toEqual({
      ok: true,
      value: { id: "abc", container_url: `${BASE}/i/abc` },
    });
    expect(sent[0]).toEqual({
      hubUrl: BASE,
      code: PRESET,
      title: "Padded",
      description: "words",
      tags: ["one"],
    });
  });

  it("turns a refusal into a sentence", async () => {
    answer.value = { status: 429, body: null };
    const result = await publishToHub(BASE, publication());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("20 things");
  });

  it("passes on what Rust said when it could not get that far", async () => {
    answer.throws = "You are not signed in to the hub at hub.example.";
    const result = await publishToHub(BASE, publication());
    expect(result).toEqual({
      ok: false,
      reason: "You are not signed in to the hub at hub.example.",
    });
  });
});

describe("hubItemPageUrl", () => {
  it("builds the page a person reads, under the configured base", () => {
    expect(hubItemPageUrl(`${BASE}/`, "abc")).toBe(`${BASE}/item/abc`);
  });
});
