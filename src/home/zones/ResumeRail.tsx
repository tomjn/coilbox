import type { LucideIcon } from "lucide-react";
import { ArrowRight, LogIn } from "lucide-react";
import { Link } from "react-router";
import {
  allServers,
  type LastLogin,
  type LobbyAccount,
  type LobbyServer,
  sortAccountsByRecency,
  useCustomServers,
  useLastLogin,
  useLobbyAccounts,
} from "../../lobby-servers/config";
import { useMultiplayer } from "../../multiplayer/store";
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

/** One small card, already reduced to the strings and the icon it draws. */
export interface RailCard {
  /** Unique across the rail, so a React list can key on it. */
  key: string;
  icon: LucideIcon;
  /** The line above the title, saying what sort of thing this is. */
  label: string;
  title: string;
  detail: string;
  /** The action's own words, in the card's foot. */
  action: string;
  /** Router path the card goes to. */
  to: string;
}

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
 * Pure, so the profile-narrowed and never-connected cases are unit tests.
 */
export function loginOffer(
  accounts: readonly LobbyAccount[],
  lastLogin: LastLogin | null,
  servers: readonly LobbyServer[],
): LoginOffer | null {
  for (const account of sortAccountsByRecency([...accounts], lastLogin)) {
    const server = servers.find((s) => s.id === account.serverId);
    if (server) return { account, server };
  }
  return null;
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
 * The remembered login as a card.
 *
 * Its own copy, and the only copy this zone owns, because a saved login is not a
 * resume candidate: nothing about it comes out of the collector, and no other
 * zone describes it. Everything else the rail says is read from
 * {@link RESUME_KIND_COPY}.
 *
 * The action is "Log in" rather than "Log in as <name>", because the name is
 * already the card's title and a 16rem card truncates the longer phrase on any
 * username worth having.
 */
function loginCard({ account, server }: LoginOffer): RailCard {
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

/**
 * The rail's contents: the runners-up the hero did not take, plus the saved
 * login when there is one, capped at {@link RAIL_CAP}.
 *
 * The login card is last and holds its slot rather than competing for one. The
 * issue asks for it to be "one of them", and a logged-out install with four
 * things to resume would otherwise never see it: the hero takes one and three
 * runners-up fill the rail exactly. So the runners-up get the slots the offer
 * leaves, and the offer is the card that goes when the cap is already met by
 * things you actually did.
 *
 * Pure, so every count from four down to none is a unit test without a UI.
 */
export function railCards(
  candidates: readonly ResumeCandidate[],
  login: LoginOffer | null,
): RailCard[] {
  const offer = login ? [loginCard(login)] : [];
  const runnersUp = candidates.slice(1).map(candidateCard);
  return [...runnersUp.slice(0, RAIL_CAP - offer.length), ...offer];
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
 * Width matches the tool cards below, so the page has one card width rather than
 * two, and the rail wraps and shrinks to whatever exists instead of stretching
 * cards to fill a grid.
 */
export const RAIL_CARD_CLASS =
  "group flex w-full flex-col gap-0.5 rounded-lg border border-border bg-card p-3 text-card-foreground transition-colors hover:border-ring hover:shadow-sm sm:w-64";

/**
 * The runners-up the Continue hero did not take, as small cards.
 *
 * Capped at three, shrinks to whatever exists, and renders nothing at all when
 * there is nothing. It waits on the same `loading` flag the hero waits on, so the
 * two arrive together rather than the rail filling in under a settled hero.
 *
 * Layout-agnostic: no page-level spacing or width of its own, because the
 * `stacked` layout is a compatibility contract and a later layout has to be able
 * to put the rail somewhere else. Beside the hero (#1041) it needs no width
 * class at all: a flex item sizes to its content and does not grow by default,
 * which is already what the rail wants.
 *
 * ## The log-in card
 *
 * Offered when the lobby is logged out and there is a login saved, and it is a
 * link to the login screen at `/lobby`, not a connect. Clicking it opens the
 * account list with that user at the top and one click left to make. It never
 * reads the keychain, so it cannot raise a macOS password prompt from the home
 * page. The saved logins come from the recency-sorted list of #458 rather than
 * through the collector, because a login is not something you were doing.
 *
 * A connect already in flight suppresses it, so an install with auto-connect on
 * does not flash a login offer during boot and then withdraw it.
 */
export default function ResumeRail() {
  const { candidates, loading } = useResume();
  const { connected, busy } = useMultiplayer();
  const [accountsCfg] = useLobbyAccounts();
  const [lastLogin] = useLastLogin();
  const [customCfg] = useCustomServers();

  const login =
    connected || busy
      ? null
      : loginOffer(
          accountsCfg.accounts,
          lastLogin,
          allServers(customCfg.servers),
        );
  const cards = railCards(candidates, login);
  if (loading || cards.length === 0) return null;

  return (
    // Labelled rather than headed: the rail is the small half of the hero it
    // shares a row with, and a heading between the two would split one block in
    // half. The label gives assistive tech the grouping a sighted reader gets
    // from the layout.
    <section aria-label="More to pick up" className="flex flex-wrap gap-3">
      {cards.map(({ key, icon: Icon, label, title, detail, action, to }) => (
        <Link key={key} to={to} className={RAIL_CARD_CLASS}>
          <span
            className={`flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide ${RAIL_DIM_CLASS}`}
          >
            <Icon className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{label}</span>
          </span>
          {/* Wraps to two lines rather than truncating: a run's name is the one
              line worth the room, and it reads better broken than clipped. */}
          <span className="line-clamp-2 text-sm font-medium">{title}</span>
          <span className={`truncate text-xs ${RAIL_DIM_CLASS}`}>{detail}</span>
          {/* Pinned to the foot, so the actions line up across a row whose
              cards stretched to the depth of a title that wrapped. */}
          <span className="mt-auto flex items-center gap-1 pt-1 text-xs font-medium">
            {action}
            <ArrowRight
              className="size-3.5 transition-transform motion-safe:group-hover:translate-x-0.5"
              aria-hidden
            />
          </span>
        </Link>
      ))}
    </section>
  );
}
