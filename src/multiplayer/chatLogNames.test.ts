// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

vi.mock("./store", () => ({
  serverNameFor: (serverKey: string) => serverKey.split("@")[1],
}));

import { accountLabel, sanitizeKey } from "./chatLogNames";

describe("sanitizeKey", () => {
  it("turns the @ and : of a server key into underscores, as the Rust side does", () => {
    expect(sanitizeKey("NAME@LOBBY.RECOILENGINE.ORG:8200")).toBe(
      "NAME_LOBBY.RECOILENGINE.ORG_8200",
    );
  });
});

describe("accountLabel", () => {
  it("keeps underscores that belong to the username", () => {
    expect(accountLabel("my_name_lobby.example_8200", [])).toBe(
      "my_name on lobby.example:8200",
    );
  });

  it("shows a folder name it cannot read as it is", () => {
    expect(accountLabel("odd", [])).toBe("odd");
  });
});
