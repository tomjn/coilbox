import { beforeEach, describe, expect, it, vi } from "vitest";

/** What the mocked commands were handed, and what they answer with. */
const sent: Record<string, unknown[]> = { hub_upload_assets: [] };
const answer: { value: unknown; throws: string | null } = {
  value: { outcomes: [] },
  throws: null,
};

vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand:
    (_plugin: string, command: string) => async (args: unknown) => {
      sent[command] ??= [];
      sent[command].push(args);
      if (answer.throws) throw new Error(answer.throws);
      return answer.value;
    },
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: ((sample: unknown) => void) | null = null;
  },
}));

/** Every notification the run produced. */
const notified: { title: string; body: string; level?: string }[] = [];
vi.mock("@/notify/notify", () => ({
  notify: async (input: { title: string; body: string; level?: string }) => {
    notified.push(input);
  },
}));

import type { AssetOutcome } from "../uploadOutcomes";
import { type AssetUpload, uploadAssetsToHub } from "./upload";

function asset(unit: string): AssetUpload {
  return {
    keyed_on: "unit",
    game: "bar",
    unit_name: unit,
    variant: "buildpic",
    source_hash: `src-${unit}`,
    encode_profile: "webp-q80-512",
    origin: "extracted",
    mime: "image/webp",
    source_archive: "Beyond All Reason test-1",
    path: `/cache/${unit}.webp`,
  };
}

function outcome(over: Partial<AssetOutcome>): AssetOutcome {
  return {
    result: "uploaded",
    status: 201,
    said: null,
    verdict: null,
    ...over,
  };
}

beforeEach(() => {
  for (const key of Object.keys(sent)) sent[key] = [];
  notified.length = 0;
  answer.value = { outcomes: [] };
  answer.throws = null;
});

describe("the only door to hub_upload_assets", () => {
  it("asks nobody for an empty set", async () => {
    const run = await uploadAssetsToHub("https://hub.example", [], {
      startedBy: "user",
    });
    expect(run).toEqual({ outcomes: [], written: 0, error: null });
    expect(sent.hub_upload_assets).toEqual([]);
  });

  it("counts what the hub now holds, taken and replaced alike", async () => {
    answer.value = {
      outcomes: [
        outcome({ result: "uploaded" }),
        outcome({ result: "replaced" }),
        outcome({ result: "already_had", status: null }),
        outcome({ result: "not_attempted", status: null }),
      ],
    };
    const run = await uploadAssetsToHub(
      "https://hub.example",
      [asset("a"), asset("b"), asset("c"), asset("d")],
      { startedBy: "user" },
    );
    expect(run.written).toBe(2);
    expect(run.error).toBeNull();
  });

  /** #1679: the whole point of there being one door. A terminal rejection used
   *  to be returned to nobody. */
  it("reports a rejection rather than swallowing it", async () => {
    answer.value = {
      outcomes: [
        outcome({
          result: "refused",
          status: 400,
          said: "The hub refused bar's armsolar buildpic: not square.",
          verdict: "terminal",
        }),
      ],
    };
    await uploadAssetsToHub("https://hub.example", [asset("armsolar")], {
      startedBy: "user",
    });
    expect(notified).toHaveLength(1);
    expect(notified[0].title).toBe("The hub would not take a picture");
    expect(notified[0].body).toContain("not square");
  });

  /** #1708: the plugin says the hub takes a vocabulary this build does not hold,
   *  so the reader is told the one thing they can act on. */
  it("passes the plugin's out of date answer through to the wording", async () => {
    answer.value = {
      outcomes: [
        outcome({
          result: "refused",
          status: 400,
          said: "The hub refused bar's armsolar buildpic: unknown variant.",
          verdict: "terminal",
        }),
      ],
      outOfDate: true,
    };
    await uploadAssetsToHub("https://hub.example", [asset("armsolar")], {
      startedBy: "user",
    });
    expect(notified).toHaveLength(1);
    expect(notified[0].title).toBe("Coilbox is out of date");
  });

  /** An older plugin, or one that never asked, sends no field at all. Absent is
   *  not a mismatch (#1708), so the wording stays as #1634 wrote it. */
  it("treats a missing out of date answer as nobody knowing", async () => {
    answer.value = {
      outcomes: [
        outcome({
          result: "refused",
          status: 400,
          said: "The hub refused bar's armsolar buildpic: not square.",
          verdict: "terminal",
        }),
      ],
    };
    await uploadAssetsToHub("https://hub.example", [asset("armsolar")], {
      startedBy: "user",
    });
    expect(notified[0].title).toBe("The hub would not take a picture");
  });

  it("says nothing about a run where everything worked", async () => {
    answer.value = { outcomes: [outcome({}), outcome({})] };
    await uploadAssetsToHub("https://hub.example", [asset("a"), asset("b")], {
      startedBy: "user",
    });
    expect(notified).toEqual([]);
  });

  /** A run that never started has no outcomes to summarise, and used to be the
   *  case that reached nobody at all. */
  it("reports a run the command refused, and does not throw", async () => {
    answer.throws =
      "Coilbox has not been given permission to send pictures to the hub.";
    const run = await uploadAssetsToHub(
      "https://hub.example",
      [asset("a"), asset("b")],
      { startedBy: "user" },
    );

    expect(run.error).toContain("permission");
    expect(run.written).toBe(0);
    expect(run.outcomes).toEqual([]);
    expect(notified).toHaveLength(1);
    expect(notified[0].title).toBe("Picture uploads stopped early");
    expect(notified[0].body).toContain("2 pictures were not sent.");
  });

  it("carries the op id through so the run can be cancelled", async () => {
    await uploadAssetsToHub("https://hub.example", [asset("a")], {
      startedBy: "user",
      opId: "run-1",
    });
    expect(sent.hub_upload_assets[0]).toMatchObject({
      hubUrl: "https://hub.example",
      opId: "run-1",
    });
  });

  /** #1690: the door still reports, and a run nobody asked for still uploads.
   *  What changes is that the report does not interrupt anybody. */
  it("sends a run coilbox started, and does not toast its rejection", async () => {
    const logged = vi.spyOn(console, "warn").mockImplementation(() => {});
    answer.value = {
      outcomes: [
        outcome({
          result: "refused",
          status: 403,
          said: "The hub has no recorded permission to redistribute pictures for that game.",
          verdict: "terminal",
        }),
      ],
    };
    const run = await uploadAssetsToHub(
      "https://hub.example",
      [asset("armsolar")],
      { startedBy: "coilbox" },
    );

    expect(sent.hub_upload_assets).toHaveLength(1);
    expect(run.error).toBeNull();
    expect(notified).toEqual([]);
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });

  it("does not toast a run coilbox started that never started at all", async () => {
    const logged = vi.spyOn(console, "warn").mockImplementation(() => {});
    answer.throws =
      "The hub has no recorded permission to redistribute pictures for that game.";
    const run = await uploadAssetsToHub(
      "https://hub.example",
      [asset("a"), asset("b")],
      { startedBy: "coilbox" },
    );

    expect(run.error).toContain("no recorded permission");
    expect(notified).toEqual([]);
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });
});
