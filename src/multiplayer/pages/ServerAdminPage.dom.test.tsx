// @vitest-environment happy-dom

/**
 * The Server admin page (issue #2772). Acts on one qualifying connection,
 * carried in the URL as `?server=` the same way chat and the battle room do.
 * With more than one qualifying connection it offers a picker. With one it
 * acts on it without asking.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LobbyState } from "../bindings";

vi.mock("@picoframe/frame", () => ({
  Button: ({
    children,
    ...props
  }: { children?: ReactNode } & Record<string, unknown>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Input: (props: Record<string, unknown>) => <input {...props} />,
  NavGate: ({ children }: { children: ReactNode }) => <>{children}</>,
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
  // ChannelsSection reads the autojoin list through `useJoinedChannels`.
  useSetting: () => [{}, () => {}],
}));

// AccountPicker composes a Radix Select, swapped for plain buttons so a test
// can pick a connection with a click, the same stand-in
// `consoleDrawerPicker.dom.test.tsx` uses.
vi.mock("../AccountPicker", () => ({
  AccountPicker: ({
    keys,
    onChange,
  }: {
    keys: string[];
    value: string;
    onChange: (key: string) => void;
  }) => (
    <div>
      {keys.map((key) => (
        <button key={key} type="button" onClick={() => onChange(key)}>
          pick {key}
        </button>
      ))}
    </div>
  ),
}));

const servers = [
  {
    id: "a",
    name: "Server A",
    host: "uber-a.example",
    port: 8200,
    tls: false,
    allowSelfSigned: false,
    protocol: "tasserver" as const,
  },
  {
    id: "b",
    name: "Server B",
    host: "uber-b.example",
    port: 8200,
    tls: false,
    allowSelfSigned: false,
    protocol: "tasserver" as const,
  },
];

function state(compflags: string[], me: string, access: boolean): LobbyState {
  return {
    myUsername: me,
    compflags,
    users: {
      [me]: {
        name: me,
        country: "",
        userId: "1",
        agent: "",
        status: { ingame: false, away: false, rank: 0, access, bot: false },
        rating: {},
      },
    },
  } as unknown as LobbyState;
}

function connection(
  serverKey: string,
  s: LobbyState,
  adminLevel: "mod" | "admin" = "mod",
) {
  return {
    serverKey,
    live: true,
    direct: false,
    adminLevel,
    mirror: { state: s },
  };
}

const wireConnections = vi.hoisted(() => ({
  connections: {} as Record<string, ReturnType<typeof connection>>,
  activeKey: null as string | null,
}));

vi.mock("../store", () => ({
  useMultiplayer: () => ({
    connections: wireConnections.connections,
    activeKey: wireConnections.activeKey,
    openLoginPopover: () => {},
  }),
  useConnection: (serverKey: string | null) =>
    serverKey ? (wireConnections.connections[serverKey] ?? null) : null,
  useProtocolServers: () => servers,
  serverNameFor: (key: string, list: typeof servers) =>
    list.find((s) => key.endsWith(`@${s.host}:${s.port}`))?.name ?? key,
  usernameFromKey: (key: string) => key.split("@")[0],
}));

import ServerAdminRoute from "./ServerAdminPage";

const KEY_A = "mod@uber-a.example:8200";
const KEY_B = "mod2@uber-b.example:8200";

function setConnections(
  entries: Record<string, ReturnType<typeof connection>>,
) {
  wireConnections.connections = entries;
}

function SearchProbe() {
  return <output data-testid="search">{useLocation().search}</output>;
}

function draw(initialPath = "/admin") {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ServerAdminRoute />
      <SearchProbe />
    </MemoryRouter>,
  );
}

function oneModerator(level: "mod" | "admin" = "mod") {
  setConnections({
    [KEY_A]: connection(KEY_A, state(["u", "sp", "b"], "mod", true), level),
  });
}

function toolNav() {
  return screen.getByRole("navigation", { name: "Server admin tools" });
}

afterEach(() => {
  cleanup();
  wireConnections.connections = {};
  wireConnections.activeKey = null;
});

describe("with no qualifying connection", () => {
  it("says so and offers to connect", () => {
    setConnections({});
    draw();
    expect(
      screen.getByText(/not a moderator or admin on any connected uberserver/),
    ).toBeTruthy();
  });
});

describe("with a single qualifying connection", () => {
  it("titles the page and names the server it acts on, with no picker", () => {
    setConnections({
      [KEY_A]: connection(KEY_A, state(["u", "sp", "b"], "mod", true)),
    });
    draw();
    expect(screen.getByRole("heading", { name: "Server admin" })).toBeTruthy();
    expect(screen.getByText(/Server A/)).toBeTruthy();
    expect(screen.queryByText(/^pick /)).toBeNull();
  });
});

describe("the tool nav", () => {
  it("lists the moderation tools and opens Players first", () => {
    oneModerator();
    draw();
    const nav = toolNav();
    const names = within(nav)
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(names).toEqual([
      "Players",
      "Bans",
      "Email domains",
      "Channels",
      "Bots",
      "Staff activity",
      "Server",
    ]);
    expect(
      within(nav)
        .getByRole("link", { name: "Players" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(screen.getByRole("heading", { name: "Player lookup" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Bans" })).toBeNull();
  });

  it("shows one tool at a time and puts it in the URL", () => {
    oneModerator();
    draw(`/admin?server=${encodeURIComponent(KEY_A)}`);
    fireEvent.click(within(toolNav()).getByRole("link", { name: "Channels" }));
    expect(screen.getByRole("heading", { name: "Channels" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Player lookup" })).toBeNull();
    const search = new URLSearchParams(
      screen.getByTestId("search").textContent ?? "",
    );
    expect(search.get("tool")).toBe("channels");
    expect(search.get("server")).toBe(KEY_A);
  });

  it("opens the tool named by ?tool=", () => {
    oneModerator();
    draw("/admin?tool=server");
    expect(
      screen.getByRole("heading", { name: "Server address" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show server IP" })).toBeTruthy();
  });

  it("opens Players with the name filled for a ?player= link", () => {
    oneModerator();
    draw(`/admin?server=${encodeURIComponent(KEY_A)}&player=Alice`);
    expect(screen.getByRole("heading", { name: "Player lookup" })).toBeTruthy();
    expect(
      (screen.getByLabelText("Player name") as HTMLInputElement).value,
    ).toBe("Alice");
  });

  it("opens Bans with the ban form filled for a ?ban= handoff", () => {
    oneModerator();
    draw("/admin?tool=players&player=Alice&ban=Alice");
    expect(screen.getByRole("heading", { name: "Bans" })).toBeTruthy();
    const form = screen.getByRole("group", { name: "Ban an account" });
    expect(
      (within(form).getByLabelText("Username") as HTMLInputElement).value,
    ).toBe("Alice");
  });

  it("opens a secondary form only on demand", () => {
    oneModerator();
    draw("/admin?tool=bans");
    const name = "Ban a specific username, IP or email";
    expect(screen.queryByRole("group", { name })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ban IP or email…" }));
    expect(screen.getByRole("group", { name })).toBeTruthy();
  });
});

describe("admin-only tools", () => {
  it("hides the admin group, and its tools, from a moderator", () => {
    oneModerator("mod");
    draw("/admin?tool=staff");
    expect(within(toolNav()).queryByText("Admin only")).toBeNull();
    expect(within(toolNav()).queryByRole("link", { name: "Staff" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Staff" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Player lookup" })).toBeTruthy();
  });

  it("shows them to an admin in their own group, more than one of them", () => {
    oneModerator("admin");
    draw("/admin?tool=staff");
    const group = within(toolNav()).getByRole("list", { name: "Admin only" });
    expect(
      within(group).getByRole("link", { name: "Maintenance" }),
    ).toBeTruthy();
    expect(within(group).getByRole("link", { name: "Staff" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Staff" })).toBeTruthy();
  });
});

describe("with two qualifying connections", () => {
  it("offers a picker and acts on whichever is picked", () => {
    setConnections({
      [KEY_A]: connection(KEY_A, state(["u", "sp", "b"], "mod", true)),
      [KEY_B]: connection(KEY_B, state(["u", "sp", "b"], "mod2", true)),
    });
    draw();
    expect(screen.getByText(`pick ${KEY_A}`)).toBeTruthy();
    expect(screen.getByText(`pick ${KEY_B}`)).toBeTruthy();
    expect(screen.getByText(/Server A/)).toBeTruthy();

    fireEvent.click(screen.getByText(`pick ${KEY_B}`));
    expect(screen.getByText(/Server B/)).toBeTruthy();
  });

  it("acts on the connection named by ?server= on load", () => {
    setConnections({
      [KEY_A]: connection(KEY_A, state(["u", "sp", "b"], "mod", true)),
      [KEY_B]: connection(KEY_B, state(["u", "sp", "b"], "mod2", true)),
    });
    draw(`/admin?server=${encodeURIComponent(KEY_B)}`);
    expect(screen.getByText(/Server B/)).toBeTruthy();
  });
});
