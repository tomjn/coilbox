import { afterEach, describe, expect, it } from "vitest";
import type { PictureSweepTools } from "../assets/pictureSweep";
import {
  forgetRunningUploads,
  showUploadRun,
  updateUploadRun,
} from "../assets/runningUploads";
import type { SweepTools } from "../maps/catalogSweep";
import type { MapPictureSweepTools } from "../maps/pictureSweep";
import {
  bindGameTools,
  bindMapPictureTools,
  bindMapTools,
  SendStopped,
} from "./bind";

const RUN = { grant: "g1", opId: "op1" };

/** A stub whose every call is recorded with its arguments. */
function recorder() {
  const calls: { name: string; args: unknown[] }[] = [];
  const stub =
    (name: string, answer: unknown = []) =>
    async (...args: unknown[]) => {
      calls.push({ name, args });
      return answer as never;
    };
  return { calls, stub };
}

afterEach(() => forgetRunningUploads());

describe("a game send's tools", () => {
  function base() {
    const r = recorder();
    const tools = {
      ask: r.stub("ask"),
      upload: r.stub("upload", { outcomes: [], written: 0, error: null }),
      publishFacts: r.stub("publishFacts"),
      fill: r.stub("fill", { units: 0, written: 0 }),
      backfill: {
        ask: r.stub("backfill.ask"),
        upload: r.stub("backfill.upload"),
      },
    } as unknown as PictureSweepTools;
    return { r, tools };
  }

  it("carries the grant on every call that reaches the hub", async () => {
    const { r, tools } = base();
    const bound = bindGameTools(RUN, tools);
    await bound.ask("h", []);
    await bound.publishFacts("h", {} as never);
    await bound.backfill.ask("h", []);
    expect(r.calls).toEqual([
      { name: "ask", args: ["h", [], "g1"] },
      { name: "publishFacts", args: ["h", {}, "g1"] },
      { name: "ask", args: ["h", [], "g1"] },
    ]);
  });

  it("sends every upload under the run's op id, so Stop can cancel it", async () => {
    const { r, tools } = base();
    const bound = bindGameTools(RUN, tools);
    await bound.upload("h", [], { startedBy: "user", opId: "random" });
    await bound.backfill.upload("h", [], { startedBy: "user" });
    expect(r.calls.map((call) => call.args[2])).toEqual([
      { startedBy: "user", opId: "op1", grant: "g1" },
      { startedBy: "user", opId: "op1", grant: "g1" },
    ]);
  });

  it("points the picture fill at the run's own row", async () => {
    const { r, tools } = base();
    await bindGameTools(RUN, tools).fill(
      { game: "sf" } as never,
      [],
      5,
      {} as never,
    );
    expect(r.calls[0].args[0]).toEqual({ game: "sf", opId: "op1" });
  });

  it("stops at the next call once somebody has pressed Stop", async () => {
    const { r, tools } = base();
    const bound = bindGameTools(RUN, tools);
    showUploadRun({ opId: "op1", subject: "sf", total: 0 });
    updateUploadRun("op1", { stopping: true });
    expect(() => bound.ask("h", [])).toThrow(SendStopped);
    expect(() => bound.publishFacts("h", {} as never)).toThrow(SendStopped);
    expect(r.calls).toEqual([]);
  });
});

describe("a map send's tools", () => {
  it("carries the grant on the facts calls", async () => {
    const r = recorder();
    const tools = {
      catalog: r.stub("catalog"),
      ask: r.stub("ask"),
      send: r.stub("send"),
    } as unknown as SweepTools;
    const bound = bindMapTools(RUN, tools);
    const progress = () => {};
    await bound.ask("h", [], progress);
    await bound.send("h", [], progress);
    expect(r.calls).toEqual([
      { name: "ask", args: ["h", [], progress, "g1"] },
      { name: "send", args: ["h", [], progress, "g1"] },
    ]);
  });

  it("carries the grant and op id on the minimap calls", async () => {
    const r = recorder();
    const tools = {
      ask: r.stub("ask"),
      upload: r.stub("upload"),
    } as unknown as MapPictureSweepTools;
    const bound = bindMapPictureTools(RUN, tools);
    await bound.ask("h", []);
    await bound.upload("h", [], { startedBy: "user", opId: "random" });
    expect(r.calls).toEqual([
      { name: "ask", args: ["h", [], "g1"] },
      {
        name: "upload",
        args: ["h", [], { startedBy: "user", opId: "op1", grant: "g1" }],
      },
    ]);
  });
});
