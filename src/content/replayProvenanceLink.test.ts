import { describe, expect, it } from "vitest";
import { provenanceLink } from "./replayProvenanceLink";
import type { ReplayProvenance } from "./replayUserState";

describe("provenanceLink", () => {
  it("links a conquest replay to its galaxy with the node preselected", () => {
    const p: ReplayProvenance = {
      mode: "conquest",
      galaxyId: "g1",
      nodeId: "n1",
    };
    expect(provenanceLink(p)).toEqual({
      to: "/conquest/g1?node=n1",
      label: "Back to conquest galaxy",
    });
  });

  it("links a conquest replay to just the galaxy when there is no node", () => {
    const p: ReplayProvenance = { mode: "conquest", galaxyId: "g1" };
    expect(provenanceLink(p)).toEqual({
      to: "/conquest/g1",
      label: "Back to conquest galaxy",
    });
  });

  it("links a warpath replay to its run with the node preselected", () => {
    const p: ReplayProvenance = { mode: "warpath", runId: "r1", nodeId: "n2" };
    expect(provenanceLink(p)).toEqual({
      to: "/warpath/r1?node=n2",
      label: "Back to warpath run",
    });
  });

  it("links a warpath replay to just the run when there is no node", () => {
    const p: ReplayProvenance = { mode: "warpath", runId: "r1" };
    expect(provenanceLink(p)).toEqual({
      to: "/warpath/r1",
      label: "Back to warpath run",
    });
  });

  it("returns null for a warpath replay with no run id", () => {
    const p: ReplayProvenance = { mode: "warpath", nodeId: "n2" };
    expect(provenanceLink(p)).toBeNull();
  });

  it("encodes ids that need it", () => {
    const p: ReplayProvenance = {
      mode: "warpath",
      runId: "r 1",
      nodeId: "n 2",
    };
    expect(provenanceLink(p)).toEqual({
      to: "/warpath/r%201?node=n%202",
      label: "Back to warpath run",
    });
  });

  it("links a campaign replay to its mission", () => {
    const p: ReplayProvenance = {
      mode: "campaign",
      campaignId: "c1",
      missionId: "m1",
    };
    expect(provenanceLink(p)).toEqual({
      to: "/campaign/c1/m1",
      label: "Back to mission",
    });
  });

  it("returns null when a replay carries no useful provenance", () => {
    expect(provenanceLink({ mode: "skirmish" })).toBeNull();
  });
});
