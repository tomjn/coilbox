/**
 * Which Server admin tool is on screen (issue #2918). The tool lives in the
 * URL as `?tool=`, and the older links into the page (`?player=` from the chat
 * member menu, `?ban=` from the lookup's Ban button) still land on theirs.
 */

import { describe, expect, it } from "vitest";
import { chosenToolId, groupTools, toolSearch, visibleTools } from "./toolNav";

const TOOLS = [
  { id: "players", label: "Players" },
  { id: "bans", label: "Bans" },
  { id: "staff", label: "Staff", adminOnly: true },
];

function params(search: string) {
  return new URLSearchParams(search);
}

describe("visibleTools", () => {
  it("drops admin-only tools for a moderator", () => {
    expect(visibleTools(TOOLS, false).map((t) => t.id)).toEqual([
      "players",
      "bans",
    ]);
  });

  it("keeps them for an admin", () => {
    expect(visibleTools(TOOLS, true).map((t) => t.id)).toEqual([
      "players",
      "bans",
      "staff",
    ]);
  });
});

describe("groupTools", () => {
  it("splits moderation tools from admin-only ones", () => {
    const groups = groupTools(TOOLS);
    expect(groups.moderation.map((t) => t.id)).toEqual(["players", "bans"]);
    expect(groups.admin.map((t) => t.id)).toEqual(["staff"]);
  });
});

describe("chosenToolId", () => {
  it("opens the first tool with nothing in the URL", () => {
    expect(chosenToolId(params(""), TOOLS)).toBe("players");
  });

  it("opens the tool named by ?tool=", () => {
    expect(chosenToolId(params("tool=bans"), TOOLS)).toBe("bans");
  });

  it("ignores a ?tool= that is not on offer", () => {
    expect(chosenToolId(params("tool=nope"), TOOLS)).toBe("players");
    const forModerator = visibleTools(TOOLS, false);
    expect(chosenToolId(params("tool=staff"), forModerator)).toBe("players");
  });

  it("opens Players for a ?player= link", () => {
    expect(chosenToolId(params("player=Alice"), TOOLS)).toBe("players");
  });

  it("prefers ?tool= over ?player=, so switching tool keeps the name", () => {
    expect(chosenToolId(params("player=Alice&tool=bans"), TOOLS)).toBe("bans");
  });

  it("opens Bans for a ?ban= handoff, whatever ?tool= says", () => {
    expect(chosenToolId(params("tool=players&ban=Alice"), TOOLS)).toBe("bans");
  });
});

describe("toolSearch", () => {
  it("sets the tool and keeps the server and player", () => {
    const next = toolSearch(params("server=a&player=Alice"), "bans");
    expect(next.get("tool")).toBe("bans");
    expect(next.get("server")).toBe("a");
    expect(next.get("player")).toBe("Alice");
  });

  it("drops a pending ?ban= so leaving Bans does not bounce back", () => {
    expect(toolSearch(params("ban=Alice"), "players").has("ban")).toBe(false);
  });
});
