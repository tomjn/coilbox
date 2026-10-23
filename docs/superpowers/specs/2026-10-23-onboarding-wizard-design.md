# Onboarding wizard

A full window setup wizard that runs after the startup splash. It asks only what the install and the distribution profile have not already answered, every page can be skipped, and pages added in later releases are shown to existing players once.

The interactive mockup is in `docs/reports/onboarding/mockup.html`, which is gitignored and local to this machine. Its game sizes and server addresses are placeholders.

## Goals

- A new player reaches Home with a language, an appearance, an engine, a game, a hub sign in and a server login, or has skipped each of them.
- No page asks a question the profile or the install has already answered.
- Every page can be skipped, and the whole wizard can be skipped from any page.
- A page added later reaches existing players once, without replaying the pages they have already dealt with.

## Out of scope

- A content folder page. The engine download uses the folder detection finds, or creates the default one.
- A profile field that names a game download. The game comes from the branding catalog (see Games).
- Tutorials or feature tours.

## Shell

The wizard covers the whole window, sidebar included, like an installer.

- It mounts in `main.tsx` as a sibling of `LocalisedAppFrame`, beside `Splash`. The splash stacks above it, so the wizard is already in place when the splash fades.
- It renders inside the theme and i18n providers, so the appearance and language pages apply live.
- Layout, top to bottom: a progress bar with one segment per visible page, an eyebrow line, the page title, the page body, and a footer.
- Footer: "Skip setup" on the left. "Back", "Skip" and "Continue" on the right. The last page has "Go to Home" only.
- Escape does nothing. Leaving goes through "Skip setup", so an accidental key press cannot lose the flow.
- Background downloads show as a pill in the title bar area, one entry per item with its percentage and a cancel control.
- Components come from picoframe per `CLAUDE.md`. No inline help paragraphs.

## Pages

Each page is an entry in one ordered list:

```ts
interface WizardPage {
  id: string;                 // stable forever, used in onboarding.settled
  relevant(ctx: WizardContext): boolean | null;  // null while still unknown
  Component: React.FC<WizardPageProps>;
}
```

Order and relevance:

| id | Shows when | Settles on |
|---|---|---|
| `language` | `general.language` has no stored value | Continue or Skip |
| `appearance` | the profile leaves `mode` unset, or leaves the colours unset | Continue or Skip |
| `games` | no game installed, and the profile's game filter does not resolve to exactly one catalog game | Continue or Skip |
| `hub` | `profile.hub` is not false and `useHubAccount` reports signed out | sign in, Continue or Skip |
| `server` | `lobbyServers.accounts` holds no saved login | log in, register, Continue or Skip |
| `done` | `done` is unsettled and at least one other page shows | Go to Home |

### Language

Lists the eight locales in `src/i18n/locales.ts` by native name, with the system locale preselected. Picking one writes `general.language` immediately, so the rest of the wizard renders in that language. The title follows the highlighted language.

### Appearance

Three rows: mode (light, dark, system), base swatches from picoframe's `BASES`, accent swatches from `ACCENTS`. The mode row hides when the profile sets `mode`. The two colour rows hide when the profile sets the colours. Picks apply to the whole window at once through picoframe's `useTheme`.

The profile gains a `base` field next to `accent`, applied the same way `accent` is today (the `coilbox.theme.beforeProfile` handling in `profile.ts`). "The profile sets the colours" means it sets `accent` or `base`.

### Games

What happens depends on the profile's `gameFilter` run through `filterSuggestedGamesByFilter` against the catalog's suggested games, the same narrowing `useCollectGetStartedOffer` does:

1. A game is already installed (unitsync scan): no page, no download.
2. The filter resolves to exactly one uninstalled game: no page. The game queues automatically when the wizard opens, beside the engine.
3. The filter resolves to several games: the page shows only those.
4. No filter: the page shows the featured list.
5. The filter resolves to nothing in the catalog: no page, no download.

Downloads go through the existing download queue and the `SuggestedDownload` kinds, so they carry on after the wizard closes.

### Engine

Not a page. When the wizard opens and no engine is found, it calls `fetchNewestRecoil` and queues the install. If the wizard does not open at all, the same check still runs at that launch, so an install with nothing to ask still gets an engine.

### Hub

A short list of what the hub gives the player and a "Sign in with Discord" button that calls `signInToHub`. Success moves to the next page.

### Server

Servers from `allServers`, with the profile's official server first. Log in and Register tabs, where Register reuses `RegisterForm`. A successful login or registration saves the account through the existing lobby account path and moves on.

### Done

One row each for language, appearance and games, plus a progress row for each background download. "Go to Home" never waits for downloads.

## Which pages a launch shows

One setting, `onboarding.settled`, holds a list of page ids.

1. At launch, after the splash decision, each page whose id is not in the list has `relevant` worked out.
2. The wizard waits while any unsettled page answers `null`, for example while the unitsync scan runs. The splash covers that wait on branded builds. On vanilla builds the wizard shows a blank frame in the theme background.
3. Pages that answer `false` are added to the list at once. A page irrelevant when it was checked is never asked later, so signing out of the hub months later does not bring the hub page back.
4. If any page answers `true`, the wizard opens with those pages. The list of pages is fixed for the rest of the run, so signing in on one page cannot make another vanish.
5. A page is added to the list when the player continues past it or skips it. "Skip setup" adds every page in the run.
6. Closing the app mid-run leaves the remaining pages unsettled, so they show next launch.

A run that opens with `done` already settled is a "new pages" run: the player has finished setup before, or the install was seeded at rollout. It uses "New in Coilbox" as the eyebrow and has no Done page. A first run closed partway leaves `done` unsettled, so its next launch still ends on Done.

### Existing installs at rollout

The first time a build with the wizard runs on an install that already has settings, it writes every current page id to `onboarding.settled` without showing anything. Pages added in later releases are the only ones that reach those players.

An install counts as existing when the settings store holds any key other than `onboarding.settled` at boot, read in `main.tsx` before first render, the same way `SPLASH_ENABLED_KEY` is read today. The implementation plan has to confirm that nothing writes a setting earlier in boot on a fresh install.

### Run setup again

A "Run setup again" button in Settings, General opens the wizard with every relevant page, ignoring `onboarding.settled` for that run, `done` included. Pages it shows are settled again as normal.

## Relationship to the home page cards

- `SetupCard` stays on Home for the case the wizard does not cover: a player who skipped setup and has no engine or content folder.
- `GetStartedCard` stays as the fallback for players who skipped the games page. It already hides once it has nothing to offer.
- The profile's `onboarding` placement keeps controlling those cards only. It does not turn the wizard off.

## Error handling

- Engine or game download fails: the pill shows the failure with a retry control. The wizard keeps going, and the download queue shows the same failure.
- Hub sign in fails or is cancelled in the browser: the page shows the error from `signInToHub` and stays open. Skip still works.
- Server login or registration fails: the server's message shows on the form, as it does in the lobby drawer.
- Catalog unavailable: the games page treats it as "resolves to nothing" and settles as irrelevant. Players can still use `GetStartedCard` later.

## Testing

- Unit tests for the relevance rules: one test per row of the pages table, over a plain `WizardContext`.
- Unit tests for settling: irrelevant pages settle without showing, skip and continue settle, "Skip setup" settles the whole run, an unfinished run leaves pages unsettled, the rollout seeding writes every id.
- Unit tests for the games decision, one per numbered case.
- A DOM test that the wizard renders above the frame and that "Skip setup" reaches Home.
- On screen check in a seeded portable instance with an empty `onboarding.settled`, and again with a profile that sets `mode`, `accent` and a single game `gameFilter`.

Agents must not drive the hub sign in or the server login and register forms in the app. Those steps are covered by unit tests and checked by hand.
