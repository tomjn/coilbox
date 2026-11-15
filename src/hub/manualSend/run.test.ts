import { afterEach, describe, expect, it, vi } from "vitest";
import type { PictureSweepReport } from "../assets/pictureSweep";
import {
  forgetRunningUploads,
  readRunningUploads,
  updateUploadRun,
} from "../assets/runningUploads";
import type { SweepReport } from "../maps/catalogSweep";
import type { MapPictureSweepReport } from "../maps/pictureSweep";
import { type ManualSendTools, startManualSend } from "./run";

const HUB = { hubUrl: "https://hub.test", enginePath: "/e", dataDir: "/d" };
const GAME = {
  ...HUB,
  subject: { kind: "game", shortname: "sf" } as const,
  label: "Splinter Faction",
};
const MAP = {
  ...HUB,
  subject: { kind: "map", map_name: "Tabula 3" } as const,
  label: "Tabula 3",
};

const gameSent: PictureSweepReport = {
  found: 1,
  games: [
    {
      game: "SF 1.0",
      shortname: "sf",
      units: 3,
      wanted: 3,
      covered: 3,
      written: 9,
    },
  ],
  skipped: [],
  failed: [],
  errors: [],
};

const mapFactsSent: SweepReport = {
  read: 1,
  asked: 1,
  wanted: 1,
  sent: 1,
  refused: 0,
  problems: [],
  skipped: [],
  errors: [],
};

const mapPictureSent: MapPictureSweepReport = {
  read: 1,
  wanted: 1,
  sent: 1,
  left: 0,
  skipped: [],
  errors: [],
};

function kit(overrides: Partial<ManualSendTools> = {}) {
  const tools: ManualSendTools = {
    begin: vi.fn(async () => "grant-1"),
    end: vi.fn(async () => {}),
    sweepGame: vi.fn(async () => gameSent),
    sweepMap: vi.fn(async () => mapFactsSent),
    sweepMapPicture: vi.fn(async () => mapPictureSent),
    notify: vi.fn(),
    ...overrides,
  };
  return tools;
}

afterEach(() => forgetRunningUploads());

describe("sending one game", () => {
  it("sends that game alone under its grant, then ends the grant", async () => {
    const tools = kit();
    await startManualSend(GAME, tools);

    expect(tools.begin).toHaveBeenCalledWith({ kind: "game", shortname: "sf" });
    expect(vi.mocked(tools.sweepGame).mock.calls[0][0]).toEqual({
      ...HUB,
      only: "sf",
    });
    expect(tools.end).toHaveBeenCalledWith("grant-1");
    expect(tools.notify).toHaveBeenCalledWith({
      title: "Sent Splinter Faction to the hub",
      level: "success",
    });
    expect(readRunningUploads()).toEqual([]);
  });

  it("shows the send in the top bar by its name while it runs", async () => {
    let shown: unknown;
    const tools = kit({
      sweepGame: vi.fn(async () => {
        shown = readRunningUploads().map(({ kind, subject, key, phase }) => ({
          kind,
          subject,
          key,
          phase,
        }));
        return gameSent;
      }),
    });
    await startManualSend(GAME, tools);

    expect(shown).toEqual([
      {
        kind: "game",
        subject: "Splinter Faction",
        key: "sf",
        phase: "reading",
      },
    ]);
  });

  it("ends the grant and says why when the sweep throws", async () => {
    const tools = kit({
      sweepGame: vi.fn(async () => {
        throw new Error("The hub could not be reached.");
      }),
    });
    await startManualSend(GAME, tools);

    expect(tools.end).toHaveBeenCalledWith("grant-1");
    expect(tools.notify).toHaveBeenCalledWith({
      title: "Splinter Faction was not sent to the hub",
      body: "The hub could not be reached.",
      level: "error",
    });
    expect(readRunningUploads()).toEqual([]);
  });

  it("stops at the facts when the hub refuses them, and says so", async () => {
    const tools = kit({
      sweepGame: vi.fn(async (_target, bound) => {
        await bound.publishFacts("h", {} as never).catch(() => {});
        // The sweep carries on to the pictures, and the bound tools refuse.
        expect(() => bound.ask("h", [])).toThrow("The hub refused the game.");
        return gameSent;
      }),
    });
    const refusing = vi.fn(async () => {
      throw new Error("The hub refused the game.");
    });
    const live = await import("../assets/pictureSweep");
    vi.spyOn(live.livePictureSweepTools, "publishFacts").mockImplementation(
      refusing,
    );
    await startManualSend(GAME, tools);
    vi.restoreAllMocks();

    expect(tools.notify).toHaveBeenCalledWith({
      title: "Splinter Faction was not sent to the hub",
      body: "The hub refused the game.",
      level: "error",
    });
  });

  it("says part was sent when the hour's allowance ran out", async () => {
    const tools = kit({
      sweepGame: vi.fn(async () => ({
        ...gameSent,
        games: [{ ...gameSent.games[0], stopped: "Out of pictures for sf." }],
      })),
    });
    await startManualSend(GAME, tools);

    expect(tools.notify).toHaveBeenCalledWith({
      title: "Sent part of Splinter Faction to the hub",
      body: "Out of pictures for sf.",
      level: "warning",
    });
  });

  it("says it stopped when somebody pressed Stop", async () => {
    const tools = kit({
      sweepGame: vi.fn(async () => {
        const run = readRunningUploads()[0];
        updateUploadRun(run.opId, { stopping: true });
        return gameSent;
      }),
    });
    await startManualSend(GAME, tools);

    expect(tools.notify).toHaveBeenCalledWith({
      title: "Stopped sending Splinter Faction",
      body: "What had already gone stays on the hub.",
    });
    expect(tools.end).toHaveBeenCalledWith("grant-1");
  });

  it("does nothing for a second press while the first send runs", async () => {
    let release = () => {};
    const tools = kit({
      sweepGame: vi.fn(
        () =>
          new Promise<PictureSweepReport>((resolve) => {
            release = () => resolve(gameSent);
          }),
      ),
    });
    const first = startManualSend(GAME, tools);
    await startManualSend(
      { ...GAME, subject: { kind: "game", shortname: "SF" } },
      tools,
    );
    release();
    await first;

    expect(tools.begin).toHaveBeenCalledTimes(1);
  });

  it("shows no run and sends nothing when the grant is refused", async () => {
    const tools = kit({
      begin: vi.fn(async () => {
        throw new Error(
          "This copy of coilbox has been set up not to send anything to the hub.",
        );
      }),
    });
    await startManualSend(GAME, tools);

    expect(tools.sweepGame).not.toHaveBeenCalled();
    expect(tools.end).not.toHaveBeenCalled();
    expect(readRunningUploads()).toEqual([]);
    expect(tools.notify).toHaveBeenCalledWith(
      expect.objectContaining({ level: "error" }),
    );
  });
});

describe("sending one map", () => {
  it("sends its facts and then its minimap, both for that map alone", async () => {
    const tools = kit();
    await startManualSend(MAP, tools);

    expect(vi.mocked(tools.sweepMap).mock.calls[0][0]).toEqual({
      ...HUB,
      only: "Tabula 3",
    });
    expect(vi.mocked(tools.sweepMapPicture).mock.calls[0][0]).toEqual({
      ...HUB,
      only: "Tabula 3",
    });
    expect(tools.notify).toHaveBeenCalledWith({
      title: "Sent Tabula 3 to the hub",
      level: "success",
    });
  });

  it("does not send the minimap when the hub refused the facts", async () => {
    const tools = kit({
      sweepMap: vi.fn(async () => ({
        ...mapFactsSent,
        sent: 0,
        refused: 1,
        problems: [
          {
            map_name: "Tabula 3",
            outcome: "conflict" as const,
            said: "A different archive has this name.",
          },
        ],
      })),
    });
    await startManualSend(MAP, tools);

    expect(tools.sweepMapPicture).not.toHaveBeenCalled();
    expect(tools.notify).toHaveBeenCalledWith({
      title: "Tabula 3 was not sent to the hub",
      body: "A different archive has this name.",
      level: "error",
    });
  });

  it("says so when the map could not be read", async () => {
    const tools = kit({
      sweepMap: vi.fn(async () => ({ ...mapFactsSent, read: 0 })),
    });
    await startManualSend(MAP, tools);

    expect(tools.sweepMapPicture).not.toHaveBeenCalled();
    expect(tools.notify).toHaveBeenCalledWith({
      title: "Tabula 3 was not sent to the hub",
      body: "Coilbox could not read the map.",
      level: "error",
    });
  });
});
