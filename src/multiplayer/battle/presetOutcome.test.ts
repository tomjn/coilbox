import { describe, expect, it } from "vitest";
import type { ConfigOption } from "@/content/bindings";
import {
  applyRoomSteps,
  deliveryNotTaken,
  dropUndeclared,
  hostStepNotTaken,
  type NotTakenWhat,
  notTakenMessage,
  refusedOptions,
} from "./presetOutcome";
import type { DeliveryProgress, SlotState } from "./tweakDelivery";

const declared = (...keys: string[]): ConfigOption[] =>
  keys.map((key) => ({ key, name: key }));

const slot = (name: string, state: SlotState, extra = {}) => ({
  slot: {
    name,
    value: "1",
    tagKey: `game/modoptions/${name}`,
    bytes: 10,
  },
  state,
  ...extra,
});

const labels: Record<string, string> = {
  map: "Map",
  teamSize: "Team size",
  nbTeams: "Team count",
  modOptions: "Mod options",
  mapOptions: "Map options",
};
const label = (what: NotTakenWhat) => labels[what] ?? what;

describe("refusedOptions", () => {
  it("finds nothing in tags that can all be sent", () => {
    expect(
      refusedOptions({
        "game/modoptions/maxunits": "2000",
        "game/mapoptions/fog": "1",
      }),
    ).toEqual([]);
  });

  it("names an option whose value holds a tab, under its own part", () => {
    const entries = refusedOptions({
      "game/modoptions/fine": "1",
      "game/modoptions/maxunits": "1\tgame/modoptions/tweakdefs=bHVh",
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].what).toBe("modOptions");
    expect(entries[0].items).toEqual(["maxunits"]);
    expect(notTakenMessage(entries, label)).toContain("Mod options: maxunits");
  });

  it("shows a refused key so its tab can be seen", () => {
    const entries = refusedOptions({
      "game/modoptions/x\tgame/modoptions/tweakdefs": "1",
    });
    expect(entries[0].items).toEqual(['"x\\tgame/modoptions/tweakdefs"']);
  });

  it("gives each reason its own entry", () => {
    const entries = refusedOptions({
      "game/modoptions/a": "1;2",
      "game/modoptions/b": "1\t2",
      "game/mapoptions/c": "1;2",
    });
    expect(entries.map((e) => e.items)).toEqual([["a"], ["b"], ["c"]]);
    expect(entries[0].reason).not.toBe(entries[1].reason);
  });
});

describe("dropUndeclared", () => {
  it("keeps declared options and drops the rest, naming them by part", () => {
    const { kept, notTaken } = dropUndeclared(
      {
        "game/modoptions/maxunits": "8000",
        "game/modoptions/bogus": "1",
        "game/mapoptions/fog": "1",
        "game/mapoptions/wind": "3",
        "game/startpostype": "2",
      },
      { mod: declared("maxunits"), map: declared("fog") },
    );
    expect(Object.keys(kept)).toEqual([
      "game/modoptions/maxunits",
      "game/mapoptions/fog",
      "game/startpostype",
    ]);
    expect(notTaken.map((n) => [n.what, n.items])).toEqual([
      ["modOptions", ["bogus"]],
      ["mapOptions", ["wind"]],
    ]);
  });

  it("drops nothing against a schema that is not read yet", () => {
    const tags = { "game/modoptions/anything": "1" };
    expect(dropUndeclared(tags, { mod: undefined, map: undefined })).toEqual({
      kept: tags,
      notTaken: [],
    });
  });

  it("drops everything against a game that was read and declares no options", () => {
    const { kept, notTaken } = dropUndeclared(
      { "game/modoptions/anything": "1" },
      { mod: [], map: [] },
    );
    expect(kept).toEqual({});
    expect(notTaken).toHaveLength(1);
  });
});

describe("deliveryNotTaken", () => {
  it("lists the failed slot with the host's words and the ones never sent", () => {
    const progress: DeliveryProgress = {
      slots: [
        slot("a", "confirmed"),
        slot("b", "failed", {
          reason: "never came back",
          hostSaid: ["You are not a boss"],
        }),
        slot("c", "skipped"),
      ],
      done: true,
      stoppedAt: 1,
    };
    expect(deliveryNotTaken(progress)).toEqual([
      { what: "modOptions", items: ["b", "c"], reason: "You are not a boss" },
    ]);
  });

  it("says a vote did not pass, not quoting the host's call for it", () => {
    const progress: DeliveryProgress = {
      slots: [
        slot("b", "failed", {
          reason: "The room's vote on b did not pass.",
          vote: "failed",
          hostSaid: ['alice called a vote for command "bSet b 1" [!vote y]'],
        }),
        slot("c", "skipped"),
      ],
      done: true,
      stoppedAt: 0,
    };
    expect(deliveryNotTaken(progress)).toEqual([
      {
        what: "modOptions",
        items: ["b", "c"],
        reason: "The room's vote on b did not pass.",
      },
    ]);
  });

  it("is empty when every option took, and for a room with no paced run", () => {
    expect(
      deliveryNotTaken({
        slots: [slot("a", "confirmed"), slot("b", "already-set")],
        done: true,
        stoppedAt: null,
      }),
    ).toEqual([]);
    expect(deliveryNotTaken(null)).toEqual([]);
  });
});

describe("notTakenMessage", () => {
  it("is null when everything took", () => {
    expect(notTakenMessage([], label)).toBeNull();
  });

  it("names the map, the team size and the options that did not take", () => {
    const message = notTakenMessage(
      [
        ...hostStepNotTaken(
          [
            { step: "map", reason: "The room did not answer." },
            { step: "teamSize", reason: "The room is set to 8." },
          ],
          "Comet",
        ),
        { what: "modOptions", items: ["maxunits"], reason: "Not declared" },
      ],
      label,
    );
    expect(message).toBe(
      "Map: Comet (The room did not answer.). Team size (The room is set to 8.). Mod options: maxunits (Not declared)",
    );
  });
});

describe("applyRoomSteps", () => {
  const progress = (...slots: ReturnType<typeof slot>[]): DeliveryProgress => ({
    slots,
    done: true,
    stoppedAt: null,
  });

  function fakeRoom(
    over: {
      hostFailures?: Parameters<typeof hostStepNotTaken>[0];
      delivery?: DeliveryProgress | null;
      left?: boolean;
    } = {},
  ) {
    const calls: string[] = [];
    const sentTags: Record<string, string>[] = [];
    return {
      calls,
      sentTags,
      runHostSteps: async () => {
        calls.push("host");
        return { failures: over.hostFailures ?? [], left: over.left ?? false };
      },
      applyOptionTags: async (tags: Record<string, string>) => {
        calls.push("options");
        sentTags.push(tags);
        return over.delivery ?? null;
      },
      afterOptions: () => calls.push("boxes"),
    };
  }

  const args = {
    hostSteps: { map: "New Map", teamSize: 4, nbTeams: 2 },
    tags: { "game/modoptions/maxunits": "8000" },
    schemas: { mod: declared("maxunits"), map: [] },
    mapName: "New Map",
  };

  it("sends the map and team shape first, the options next, the boxes last", async () => {
    const room = fakeRoom();
    await applyRoomSteps({ ...args, ...room });
    expect(room.calls).toEqual(["host", "options", "boxes"]);
  });

  it("reports nothing when every step took", async () => {
    const room = fakeRoom();
    expect(await applyRoomSteps({ ...args, ...room })).toEqual([]);
  });

  it("names a map change and a team size the room did not take", async () => {
    const room = fakeRoom({
      hostFailures: [
        { step: "map", reason: "The room did not answer." },
        { step: "teamSize", reason: "The room is set to 8." },
      ],
    });
    const entries = await applyRoomSteps({ ...args, ...room });
    expect(notTakenMessage(entries, label)).toBe(
      "Map: New Map (The room did not answer.). Team size (The room is set to 8.)",
    );
  });

  it("names an option the autohost refused, from the paced run", async () => {
    const room = fakeRoom({
      delivery: progress(
        slot("maxunits", "failed", {
          reason: "never came back",
          hostSaid: ["You are not a boss"],
        }),
      ),
    });
    const entries = await applyRoomSteps({ ...args, ...room });
    expect(notTakenMessage(entries, label)).toBe(
      "Mod options: maxunits (You are not a boss)",
    );
  });

  it("skips an option the game does not declare and keeps sending the rest", async () => {
    const room = fakeRoom();
    const entries = await applyRoomSteps({
      ...args,
      ...room,
      tags: {
        "game/modoptions/bogus": "1",
        "game/modoptions/maxunits": "8000",
      },
    });
    expect(room.sentTags).toEqual([{ "game/modoptions/maxunits": "8000" }]);
    expect(notTakenMessage(entries, label)).toBe(
      "Mod options: bogus (Not declared)",
    );
  });

  it("sends no options or boxes once the player has left the room", async () => {
    const room = fakeRoom({
      left: true,
      hostFailures: [{ step: "map", reason: "The room did not answer." }],
    });
    const entries = await applyRoomSteps({ ...args, ...room });
    expect(room.calls).toEqual(["host"]);
    expect(entries.map((e) => e.what)).toEqual(["map"]);
  });

  it("drops nothing against a schema that is not read yet, and everything against an empty one", async () => {
    const unread = fakeRoom();
    await applyRoomSteps({
      ...args,
      ...unread,
      schemas: { mod: undefined, map: undefined },
    });
    expect(unread.sentTags).toEqual([args.tags]);
    const empty = fakeRoom();
    const entries = await applyRoomSteps({
      ...args,
      ...empty,
      schemas: { mod: [], map: [] },
    });
    expect(empty.sentTags).toEqual([{}]);
    expect(entries.map((e) => [e.what, e.items])).toContainEqual([
      "modOptions",
      ["maxunits"],
    ]);
  });

  it("sends the boxes even when an option failed", async () => {
    const room = fakeRoom({
      delivery: progress(slot("maxunits", "failed", { reason: "lost" })),
    });
    await applyRoomSteps({ ...args, ...room });
    expect(room.calls).toEqual(["host", "options", "boxes"]);
  });
});
