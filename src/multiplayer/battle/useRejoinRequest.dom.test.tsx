// @vitest-environment happy-dom

import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { useRejoinRequest } from "./useRejoinRequest";

function wrapper(state: unknown) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[{ pathname: "/battle", state }]}>
      {children}
    </MemoryRouter>
  );
}

describe("useRejoinRequest", () => {
  it("asks once the room holds the battle that was offered", () => {
    const ask = vi.fn(async () => {});
    const { rerender } = renderHook(
      ({ id }: { id: number | null }) => useRejoinRequest(id, ask),
      {
        wrapper: wrapper({ rejoinBattleId: 42 }),
        initialProps: { id: null as number | null },
      },
    );
    expect(ask).not.toHaveBeenCalled();
    rerender({ id: 42 });
    expect(ask).toHaveBeenCalledTimes(1);
    rerender({ id: 42 });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("does not ask for a different battle", () => {
    const ask = vi.fn(async () => {});
    renderHook(() => useRejoinRequest(7, ask), {
      wrapper: wrapper({ rejoinBattleId: 42 }),
    });
    expect(ask).not.toHaveBeenCalled();
  });

  it("does not ask when the room was opened any other way", () => {
    const ask = vi.fn(async () => {});
    renderHook(() => useRejoinRequest(42, ask), { wrapper: wrapper(null) });
    expect(ask).not.toHaveBeenCalled();
  });

  it("waits for a connection that can ask", () => {
    const ask = vi.fn(async () => {});
    const { rerender } = renderHook(
      ({ f }: { f: (() => Promise<void>) | null }) => useRejoinRequest(42, f),
      {
        wrapper: wrapper({ rejoinBattleId: 42 }),
        initialProps: { f: null as (() => Promise<void>) | null },
      },
    );
    rerender({ f: ask });
    expect(ask).toHaveBeenCalledTimes(1);
  });
});
