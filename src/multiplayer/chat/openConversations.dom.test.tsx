// @vitest-environment happy-dom

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { isConversationOpen, useOpenConversation } from "./openConversations";

describe("useOpenConversation", () => {
  it("marks a conversation open only while a view shows it", () => {
    const view = renderHook(() => useOpenConversation("srv", "channel:main"));
    expect(isConversationOpen("srv", "channel:main")).toBe(true);
    expect(isConversationOpen("other", "channel:main")).toBe(false);
    view.unmount();
    expect(isConversationOpen("srv", "channel:main")).toBe(false);
  });

  it("stays open until the last of two views showing it closes", () => {
    const page = renderHook(() => useOpenConversation("srv", "channel:b"));
    const room = renderHook(() => useOpenConversation("srv", "channel:b"));
    page.unmount();
    expect(isConversationOpen("srv", "channel:b")).toBe(true);
    room.unmount();
    expect(isConversationOpen("srv", "channel:b")).toBe(false);
  });
});
