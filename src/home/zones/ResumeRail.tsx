import type { LucideIcon } from "lucide-react";
import { ArrowRight, LogIn } from "lucide-react";
import { Link } from "react-router";
import {
  allServers,
  type LastLogin,
  type LobbyAccount,
  type LobbyServer,
  rememberedLogins,
  sortAccountsByRecency,
  useCustomServers,
  useLastLogin,
  useLobbyAccounts,
} from "../../lobby-servers/config";
import { serverKeyFor, useMultiplayer } from "../../multiplayer/store";
import { CARD_FOCUS_CLASS } from "../cardShell";
import {
  RESUME_KIND_COPY,
  RESUME_KIND_ICON,
  type ResumeCandidate,
  useResume,
} from "../continue";

/**
 * How many cards the rail will ever show.
 *
 * Three, from the design. Past that the rail stops being "the couple of other
 * things you were doing" and becomes a second tool grid, which the page already
 * has one of.
 */
export const RAIL_CAP = 3;

/** The strings and the icon every rail card draws, whichever way it acts. */
interface RailCardBase {
  /** Unique across the rail, so a React list can key on it. */
  key: string;
  icon: LucideIcon;
  /** The line above the title, saying what sort of thing this is. */
  label: string;
  title: string;
  detail: string;
  /** The action's own words, in the card's foot. */
  action: string;
}

/**
 * One small card. Every card but the combined login offer navigates, so `to`
 * is the default shape. The combined offer acts instead of navigating: its
 * click reconnects every remembered login rather than opening a page. That is
 * why it is the only card with `onClick` and no `to`. The union keeps the two
 * from being set at once, so the renderer's choice of `<Link>` or `<button>`
 * follows from the type rather than from a runtime guess.
 */
export type RailCard =
  | (RailCardBase & { to: string; onClick?: undefined })
  | (RailCardBase & { to?: undefined; onClick: () => void });

/** A remembered login the rail can offer, resolved against the server catalog. */
export interface LoginOffer {
  account: LobbyAccount;
  server: LobbyServer;
}

/**
 * The saved login to offer, or null when there is none worth offering.
 *
 * Most recently used first, by the same {@link sortAccountsByRecency} order the
 * login popover shows, so the rail names the account that panel would put at the
 * top. An account whose server is not in `servers` is skipped rather than
 * offered: passing the profile-filtered catalog is how a distribution that
 * narrows the server list stops a disallowed server being suggested here, which
 * is the same argument `resolveLastLogin` makes for auto-connect.
 *
 * `resolveLastLogin` is not used, because it answers null until the first-ever
 * successful connect. A login added in Settings and never used is still a saved
 * login, and is exactly the person this card helps.
 *
 * `taken` is every server key that already has its own state, live or a
 * connect in flight, so the rail does not offer to log in to an account it
 * is already handling. Each login's own state, not a store-wide "something
 * is connected" flag (issue #2847). Defaults to empty so the
 * profile-narrowed and never-connected cases stay callable without it.
 *
 * Pure, so the profile-narrowed and never-connected cases are unit tests.
 */
export function loginOffer(
  accounts: readonly LobbyAccount[],
  lastLogin: LastLogin | null,
  servers: readonly LobbyServer[],
  taken: ReadonlySet<string> = EMPTY_TAKEN,
): LoginOffer | null {
  for (const account of sortAccountsByRecency([...accounts], lastLogin)) {
    const server = servers.find((s) => s.id === account.serverId);
    if (!server) continue;
    if (taken.has(serverKeyFor(server, account.username))) continue;
    return { account, server };
  }
  return null;
}

const EMPTY_TAKEN: ReadonlySet<string> = new Set();

/**
 * The saved logins to offer as cards: one per remembered login (open when
 * coilbox last closed, per {@link rememberedLogins}) that is not `taken`, or,
 * when none is remembered, the single {@link loginOffer} invite (issue #2849).
 *
 * The two never mix: `rememberedLogins` itself falls back to `lastLogin` only
 * when nothing is flagged, so a remembered result and the invite fallback
 * never both apply.
 *
 * A remembered result comes back most-recently-used first, by
 * {@link sortAccountsByRecency}. `rememberedLogins` itself only preserves
 * `accounts`' own order, and the card built from this list (issue #2936)
 * names its first entry, so getting that entry right is this function's job
 * rather than the card's.
 *
 * Pure, so the remembered/invite split and the ordering are unit tests
 * without a UI.
 */
export function loginOffers(
  accounts: readonly LobbyAccount[],
  lastLogin: LastLogin | null,
  servers: readonly LobbyServer[],
  taken: ReadonlySet<string> = EMPTY_TAKEN,
): LoginOffer[] {
  const remembered = rememberedLogins([...accounts], lastLogin, [
    ...servers,
  ]).filter(
    ({ account, server }) => !taken.has(serverKeyFor(server, account.username)),
  );
  if (remembered.length > 0) {
    const byAccountId = new Map(remembered.map((o) => [o.account.id, o]));
    return sortAccountsByRecency(
      remembered.map((o) => o.account),
      lastLogin,
    ).map((a) => byAccountId.get(a.id) as LoginOffer);
  }
  const fallback = loginOffer(accounts, lastLogin, servers, taken);
  return fallback ? [fallback] : [];
}

/** A resume candidate as a card, worded by the collector rather than here. */
function candidateCard(c: ResumeCandidate): RailCard {
  const { label, action } = RESUME_KIND_COPY[c.kind];
  return {
    key: c.id,
    icon: RESUME_KIND_ICON[c.kind],
    label,
    title: c.title,
    detail: c.detail,
    action,
    to: c.to,
  };
}

/**
 * "<name> and N other(s)", the wording a card uses to name one login out of
 * several. The same tail `greetingSubject` (`Greeting.tsx`) reaches for once a
 * connected heading passes two names, kept singular-aware here because this
 * card's count starts at one remaining rather than two: with exactly two
 * remembered logins the greeting would still write both names in full, but the
 * issue this card fixes (#2936) asks for a name and a count at every count
 * above one, not a second exception at two.
 */
function nameAndOthers(name: string, othersCount: number): string {
  return `${name} and ${othersCount} other${othersCount === 1 ? "" : "s"}`;
}

/**
 * The remembered logins as a single card, however many there are (issue
 * #2936).
 *
 * Its own copy, and the only copy this zone owns, because a saved login is not
 * a resume candidate: nothing about it comes out of the collector, and no
 * other zone describes it. Everything else the rail says is read from
 * {@link RESUME_KIND_COPY}.
 *
 * One login keeps the card as it always was: a link to `/lobby`, so clicking
 * opens the account list with that login at the top and one click left to
 * make, never a connect straight off the home page. The action is "Log in"
 * rather than "Log in as <name>", because the name is already the card's
 * title and a 16rem card truncates the longer phrase on any username worth
 * having.
 *
 * More than one login turns the card into an action instead of a link: its
 * title names the most recently used login (first in `logins`, by
 * {@link loginOffers}'s ordering) and counts the rest, and its click calls
 * `reconnectAll` on every one of them. That function already skips a login
 * that is connected, a login that would clash with another on the same host,
 * and a Tachyon login that needs a browser sign-in, so this card does not
 * repeat any of that filtering.
 */
function loginCard(
  logins: readonly LoginOffer[],
  reconnectAll: (targets: LoginOffer[]) => Promise<void>,
): RailCard {
  const [{ account, server }] = logins;
  if (logins.length === 1) {
    return {
      key: `login:${account.id}`,
      icon: LogIn,
      label: "Multiplayer",
      title: account.username,
      detail: server.name,
      action: "Log in",
      to: "/lobby",
    };
  }
  return {
    key: "login:all",
    icon: LogIn,
    label: "Multiplayer",
    title: nameAndOthers(account.username, logins.length - 1),
    detail: server.name,
    action: "Reconnect all",
    onClick: () => void reconnectAll([...logins]),
  };
}

/** `railCards`' default when the rail has no logins to offer and so never calls it. */
const NOOP_RECONNECT = async () => {};

/**
 * The rail's contents: the runners-up the hero did not take, plus the single
 * login card, capped at {@link RAIL_CAP}.
 *
 * The login card comes last and holds its slot rather than competing for one.
 * The issue asks for the login card to be "one of them", and a logged-out
 * install with four things to resume would otherwise never see it: the hero
 * takes one and three runners-up fill the rail exactly. So the runners-up get
 * whatever slots the login card leaves, which is every slot but one whenever
 * there is a login to offer at all.
 *
 * There is never more than one login card, whatever `logins` holds (issue
 * #2936): several remembered logins collapse into the one card
 * {@link loginCard} builds for "more than one", rather than each claiming a
 * slot of its own.
 *
 * Pure, so every count from four down to none, and any number of logins, is a
 * unit test without a UI.
 */
export function railCards(
  candidates: readonly ResumeCandidate[],
  logins: readonly LoginOffer[],
  reconnectAll: (targets: LoginOffer[]) => Promise<void> = NOOP_RECONNECT,
): RailCard[] {
  const offer = logins.length > 0 ? [loginCard(logins, reconnectAll)] : [];
  const runnersUp = candidates.slice(1).map(candidateCard);
  return [
    ...runnersUp.slice(0, Math.max(0, RAIL_CAP - offer.length)),
    ...offer,
  ];
}

/**
 * Secondary text on a rail card.
 *
 * The same token the hero and the tool cards use. This was
 * `hsl(var(--card-foreground)/0.65)` while the token itself failed AA in the light
 * ramp (#1019), which put a bespoke ink on the rail and the shared one on the
 * hero directly above it, at nearly the same colour. The token is fixed in
 * `src/index.css` and now measures 5.11:1 at worst on a card surface, better than
 * the workaround's 4.98:1, so the rail goes back to it.
 */
export const RAIL_DIM_CLASS = "text-muted-foreground";

/**
 * The card surface. `bg-card`, with no `hover:bg-*`, so the contrast
 * `resumeRail.test.ts` measures is true in every state rather than only at rest.
 * The hover cue is the accent-coloured border and a lift instead.
 *
 * No `bg-primary/5` either. The tint is legible now the token is fixed, but the
 * rail is the quiet half of the hero above it and a tint would compete with the
 * hero's own accent border for the same "look here" job.
 *
 * Width adjusts from `sm`: a 10rem base so three cards fit beside the hero on
 * lines a fixed 16rem card pushed onto a second row, growing back to the tool
 * cards' 16rem cap whenever the line has the room, so a wide page looks as it
 * did before.
 *
 * ## The padding is paired with the hero's
 *
 * `p-2.5` here and `p-4` on the Continue hero put both cards at the same height
 * on one line. They are different cards with different contents, so that is an
 * agreement between two numbers rather than something either one computes: at
 * `p-3` and `p-5` the row measured 101px and 105px and the hero stood proud of
 * its neighbours.
 *
 * The row aligns at `items-start` and must keep doing so (#1074), so this cannot
 * be left to `stretch`. Measured in the running app rather than worked out on
 * paper, and worth measuring again rather than adjusting by eye if either card
 * gains or loses a line.
 */
export const RAIL_CARD_CLASS =
  "group flex w-full flex-col gap-0.5 rounded-lg border border-border bg-card p-2.5 text-card-foreground transition-colors hover:border-ring hover:shadow-sm sm:max-w-64 sm:grow sm:basis-40 " +
  CARD_FOCUS_CLASS;

/**
 * The runners-up the Continue hero did not take, as small cards.
 *
 * Capped at three, shrinks to whatever exists, and renders nothing at all when
 * there is nothing. It waits on the same `loading` flag the hero waits on, so the
 * two arrive together rather than the rail filling in under a settled hero.
 *
 * Layout-agnostic: no page-level spacing of its own, because the `stacked`
 * layout is a compatibility contract and a later layout has to be able to put
 * the rail somewhere else. Beside the hero (#1041) it is `flex-1 min-w-0`, so
 * it takes the rest of the hero's line and wraps its own cards inside that
 * space, rather than sizing to three full cards and dropping whole onto a
 * second row whenever they did not fit.
 *
 * ## The log-in card
 *
 * At most one, whatever coilbox remembers (issue #2936): with one remembered
 * login (open when coilbox last closed, issue #2849) the card names it, and
 * with several it names the most recently used and counts the rest. With
 * nothing remembered, the single most-recently-used saved login is offered
 * instead, as an invite. Either way, an account already connected or
 * connecting is left out. One login's card is a link to the login screen at
 * `/lobby`, not a connect: clicking it opens the account list with that user
 * at the top and one click left to make. Several logins' card instead calls
 * `reconnectAll`, which does the connecting itself. Neither ever reads the
 * keychain directly, so this card alone cannot raise a macOS password prompt
 * from the home page. The saved logins come from the recency-sorted list of
 * #458 rather than through the collector, because a login is not something
 * you were doing.
 *
 * Each login's own state decides whether it is offered, not a store-wide
 * "something is connected" flag (issue #2847): a second saved account is
 * still counted while a different one is live, and a connect already in
 * flight for that specific account leaves it out, so an install with
 * auto-connect on does not flash a login offer during boot and then withdraw
 * it.
 */
export default function ResumeRail() {
  const { candidates, loading } = useResume();
  const { connections, busyKeys, reconnectAll } = useMultiplayer();
  const [accountsCfg] = useLobbyAccounts();
  const [lastLogin] = useLastLogin();
  const [customCfg] = useCustomServers();

  const taken = new Set(busyKeys);
  for (const key of Object.keys(connections)) {
    if (connections[key].live) taken.add(key);
  }
  const logins = loginOffers(
    accountsCfg.accounts,
    lastLogin,
    allServers(customCfg.servers),
    taken,
  );
  const cards = railCards(candidates, logins, reconnectAll);
  if (loading || cards.length === 0) return null;

  return (
    // Labelled rather than headed: the rail is the small half of the hero it
    // shares a row with, and a heading between the two would split one block in
    // half. The label gives assistive tech the grouping a sighted reader gets
    // from the layout.
    <section
      aria-label="More to pick up"
      className="flex min-w-0 flex-1 flex-wrap gap-3"
    >
      {cards.map((card) => {
        const { key, icon: Icon, label, title, detail, action } = card;
        const content = (
          <>
            <span
              className={`flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide ${RAIL_DIM_CLASS}`}
            >
              <Icon className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{label}</span>
            </span>
            {/* Wraps to two lines rather than truncating: a run's name is the
                one line worth the room, and it reads better broken than
                clipped. */}
            <span className="line-clamp-2 text-sm font-medium">{title}</span>
            <span className={`truncate text-xs ${RAIL_DIM_CLASS}`}>
              {detail}
            </span>
            {/* Pinned to the foot, so the actions line up across a row whose
                cards stretched to the depth of a title that wrapped. */}
            <span className="mt-auto flex items-center gap-1 pt-1 text-xs font-medium">
              {action}
              <ArrowRight
                className="size-3.5 transition-transform motion-safe:group-hover:translate-x-0.5"
                aria-hidden
              />
            </span>
          </>
        );
        // The combined login offer acts rather than navigates (issue #2936),
        // so it is the one card drawn as a `<button>` instead of a `<Link>`.
        return card.to !== undefined ? (
          <Link key={key} to={card.to} className={RAIL_CARD_CLASS}>
            {content}
          </Link>
        ) : (
          <button
            key={key}
            type="button"
            onClick={card.onClick}
            className={RAIL_CARD_CLASS}
          >
            {content}
          </button>
        );
      })}
    </section>
  );
}
