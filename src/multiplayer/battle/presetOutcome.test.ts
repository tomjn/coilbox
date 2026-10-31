import { describe, expect, it } from "vitest";
import type { ConfigOption } from "@/content/bindings";
import {
  applyRoomSteps,
  deliveryNotTaken,
  dropUndeclared,
  hostStepNotTaken,
  type NotTakenWhat,
  notTakenMessage,
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
    expect(dropUndeclared(tags, { mod: [], map: [] })).toEqual({
      kept: tags,
      notTaken: [],
    });
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
    } = {},
  ) {
    const calls: string[] = [];
    const sentTags: Record<string, string>[] = [];
    return {
      calls,
      sentTags,
      runHostSteps: async () => {
        calls.push("host");
        return over.hostFailures ?? [];
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

  it("sends the boxes even when an option failed", async () => {
    const room = fakeRoom({
      delivery: progress(slot("maxunits", "failed", { reason: "lost" })),
    });
    await applyRoomSteps({ ...args, ...room });
    expect(room.calls).toEqual(["host", "options", "boxes"]);
  });
});
