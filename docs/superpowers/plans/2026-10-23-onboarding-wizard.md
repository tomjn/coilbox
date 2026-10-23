# Onboarding wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A full window first-run wizard that asks only what the profile and install have not answered, with per-page settling so later pages reach existing players once.

**Architecture:** Pure modules decide which pages a launch shows (`settle.ts`, `relevance.ts`). A new `src/onboarding` plugin, appended last so its Provider is innermost, gathers live state, runs the background engine and game downloads, and draws the wizard as a fixed overlay. Pages reuse existing components: `SuggestionsList`, `AddAccountForm`, `RegisterForm`, `signInToHub`, picoframe's `useTheme`.

**Tech Stack:** React 19, TypeScript, picoframe (`@picoframe/frame`, shadcn registry components), Lingui, vitest (`*.test.ts` pure, `*.dom.test.tsx` DOM).

**Spec:** `docs/superpowers/specs/2026-10-23-onboarding-wizard-design.md`

## Global Constraints

- Settled list key: `onboarding.settled`, a JSON array of ids.
- Page ids, in order: `language`, `appearance`, `games`, `hub`, `server`, `done`. Background ids: `engine`, `game`. Ids are permanent.
- Overlay: `fixed inset-0 z-40`. Splash stays above it, Radix popovers (`z-50`) open over it.
- Every user-visible string goes through Lingui (`t` from `useLingui`, or `<Trans>`), English source as the id.
- picoframe components only: `Button`/`Input` from `@picoframe/frame`, everything else from `src/components/ui/`. No native `<select>`, checkbox or textarea.
- No inline help paragraphs (memory: no help text in the UI). One short line under a title at most.
- Escape does nothing in the wizard.
- "Go to Home" never waits for a download.
- Agents must not drive the hub sign in or the server login and register forms in the running app.
- Full check before pushing: `bun run check` (all seven CI commands).

## Review Focus

1. A Radix `Select` inside the wizard (server picker in `AddAccountForm`) must open above the overlay. Check on screen in Task 11.
2. Nothing in the frame (sidebar, top bar, toasts, the downloads indicator) may draw over the wizard. Check on screen in Task 13.
3. The hub account answering `unknown` (keychain did not reply) must not hang the wizard. `pageRelevance` treats it as relevant (test in Task 2).
4. A unitsync scan that errors or is cancelled must not hang the wizard. `scanSettled` counts it as answered, and `decideGames` then sees the file listing only (test in Task 2).
5. Closing the app mid-run must leave unvisited pages unsettled. Settling happens on Continue or Skip only, never on open (test in Task 1).

---

### Task 1: Settled list and run planning

**Files:**
- Create: `src/onboarding/ids.ts`
- Create: `src/onboarding/settle.ts`
- Test: `src/onboarding/settle.test.ts`

**Interfaces:**
- Produces:
  - `ids.ts`: `PAGE_IDS = ["language","appearance","games","hub","server","done"] as const`, `type PageId`, `BACKGROUND_IDS = ["engine","game"] as const`, `type BackgroundId`, `type SettleId = PageId | BackgroundId`, `SETTLED_KEY = "onboarding.settled"`. No React imports, so `main.tsx` can import it.
  - `settle.ts`:
    - `type Relevance = boolean | null`
    - `type AskedPage = Exclude<PageId, "done">`
    - `type RunPlan = { status: "waiting" } | { status: "none"; settleNow: SettleId[] } | { status: "open"; pages: PageId[]; settleNow: SettleId[]; newPagesRun: boolean }`
    - `planRun(args: { settled: readonly string[]; relevance: Record<AskedPage, Relevance>; rerun: boolean }): RunPlan`
    - `addSettled(settled: readonly string[], ids: readonly SettleId[]): string[]` (dedupes, keeps order)
    - `seedExistingInstall(storage: { get(k: string): string | null; set(k: string, v: string): void }, loadedKeyCount: number): void`

- [ ] **Step 1: Write the failing tests**

```ts
const all = (r: Relevance) => ({ language: r, appearance: r, games: r, hub: r, server: r });

it("waits while an unsettled page is unknown", () => {
  expect(planRun({ settled: [], relevance: { ...all(true), hub: null }, rerun: false }).status).toBe("waiting");
});
it("ignores unknown relevance on a settled page", () => {
  expect(planRun({ settled: ["hub"], relevance: { ...all(false), hub: null }, rerun: false }).status).toBe("none");
});
it("settles irrelevant pages without opening", () => {
  expect(planRun({ settled: [], relevance: all(false), rerun: false }))
    .toEqual({ status: "none", settleNow: ["language","appearance","games","hub","server","done"] });
});
it("opens a first run with relevant pages and done, settling only irrelevant ones", () => {
  expect(planRun({ settled: [], relevance: { ...all(false), language: true, server: true }, rerun: false }))
    .toEqual({ status: "open", pages: ["language","server","done"], settleNow: ["appearance","games","hub"], newPagesRun: false });
});
it("leaves out done and marks a new pages run once done is settled", () => {
  const plan = planRun({ settled: ["language","appearance","games","hub","done"], relevance: all(true), rerun: false });
  expect(plan).toEqual({ status: "open", pages: ["server"], settleNow: [], newPagesRun: true });
});
it("keeps done for a first run closed partway", () => {
  const plan = planRun({ settled: ["language"], relevance: { ...all(false), server: true }, rerun: false });
  expect(plan.status === "open" && plan.pages).toEqual(["server","done"]);
});
it("rerun ignores the settled list and includes done", () => {
  const plan = planRun({ settled: ["language","appearance","games","hub","server","done"], relevance: { ...all(false), hub: true }, rerun: true });
  expect(plan).toMatchObject({ status: "open", pages: ["hub","done"], newPagesRun: false });
});
it("addSettled dedupes", () => {
  expect(addSettled(["language"], ["language","hub"])).toEqual(["language","hub"]);
});
it("seeds every id on an existing install", () => {
  const m = new Map<string, string>();
  seedExistingInstall({ get: k => m.get(k) ?? null, set: (k, v) => m.set(k, v) }, 3);
  expect(JSON.parse(m.get(SETTLED_KEY)!)).toEqual([...PAGE_IDS, ...BACKGROUND_IDS]);
});
it("does not seed a fresh install or overwrite an existing list", () => { /* loadedKeyCount 0 leaves the key unset, and an existing ["hub"] stays ["hub"] */ });
```

- [ ] **Step 2: Run** `bunx vitest run src/onboarding/settle.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `ids.ts` and `settle.ts`**

`planRun`: candidates are the asked pages not in `settled` (all of them when `rerun`). Any candidate `null` gives `waiting`. Candidates answering `false` go in `settleNow`. If none answer `true`, return `none` with `settleNow` plus `"done"` when `done` is unsettled (or on rerun). Otherwise `pages` is the `true` candidates in `PAGE_IDS` order, plus `"done"` when `rerun` or `done` is unsettled. `newPagesRun` is `!rerun && settled.includes("done")`. Nothing that is shown goes in `settleNow`.

`seedExistingInstall`: if `loadedKeyCount > 0` and `storage.get(SETTLED_KEY) === null`, set it to `JSON.stringify([...PAGE_IDS, ...BACKGROUND_IDS])`.

- [ ] **Step 4: Run** the test file again. Expected: PASS.

- [ ] **Step 5: Commit** `git add src/onboarding/ids.ts src/onboarding/settle.ts src/onboarding/settle.test.ts && git commit -m "Add onboarding run planning"`

### Task 2: Relevance rules and the games decision

**Files:**
- Create: `src/onboarding/relevance.ts`
- Test: `src/onboarding/relevance.test.ts`

**Interfaces:**
- Consumes: `Relevance`, `AskedPage` from Task 1. `SuggestedGame` from `src/content/branding.ts`.
- Produces:
  - `type GamesDecision = { kind: "none" } | { kind: "auto"; game: SuggestedGame } | { kind: "pick"; games: SuggestedGame[] }`
  - `decideGames(args: { candidates: SuggestedGame[] | null; hasGameFilter: boolean }): GamesDecision | null`, where `candidates` is `getStartedCandidates(...)?.games` (already scoped to the filter and empty once any game is installed), `null` while unknown.
  - `interface WizardContext { languageStored: boolean; profileMode: boolean; profileColours: boolean; hubEnabled: boolean; hub: { loading: boolean; signedIn: boolean; unknown: boolean }; lobbyAccountCount: number; games: GamesDecision | null }`
  - `pageRelevance(ctx: WizardContext): Record<AskedPage, Relevance>`

- [ ] **Step 1: Write the failing tests**

```ts
const g = (name: string) => ({ name } as SuggestedGame);
it("games: unknown while candidates are unknown", () => expect(decideGames({ candidates: null, hasGameFilter: false })).toBeNull());
it("games: none when nothing is offered (installed, or filter matched nothing)", () =>
  expect(decideGames({ candidates: [], hasGameFilter: true })).toEqual({ kind: "none" }));
it("games: auto when the filter resolves to one game", () =>
  expect(decideGames({ candidates: [g("SF")], hasGameFilter: true })).toEqual({ kind: "auto", game: g("SF") }));
it("games: pick when the filter resolves to several", () =>
  expect(decideGames({ candidates: [g("A"), g("B")], hasGameFilter: true })).toEqual({ kind: "pick", games: [g("A"), g("B")] }));
it("games: pick for one featured game with no filter", () =>
  expect(decideGames({ candidates: [g("A")], hasGameFilter: false })).toEqual({ kind: "pick", games: [g("A")] }));

const base: WizardContext = { languageStored: false, profileMode: false, profileColours: false, hubEnabled: true,
  hub: { loading: false, signedIn: false, unknown: false }, lobbyAccountCount: 0, games: { kind: "pick", games: [g("A")] } };
it("everything relevant on a bare install", () =>
  expect(pageRelevance(base)).toEqual({ language: true, appearance: true, games: true, hub: true, server: true }));
it("language: stored value", () => expect(pageRelevance({ ...base, languageStored: true }).language).toBe(false));
it("appearance: only when the profile sets both", () => {
  expect(pageRelevance({ ...base, profileMode: true }).appearance).toBe(true);
  expect(pageRelevance({ ...base, profileMode: true, profileColours: true }).appearance).toBe(false);
});
it("games: auto and none are not pages, unknown is unknown", () => {
  expect(pageRelevance({ ...base, games: { kind: "auto", game: g("SF") } }).games).toBe(false);
  expect(pageRelevance({ ...base, games: { kind: "none" } }).games).toBe(false);
  expect(pageRelevance({ ...base, games: null }).games).toBeNull();
});
it("hub: off, signed in, loading, unknown", () => {
  expect(pageRelevance({ ...base, hubEnabled: false }).hub).toBe(false);
  expect(pageRelevance({ ...base, hub: { loading: false, signedIn: true, unknown: false } }).hub).toBe(false);
  expect(pageRelevance({ ...base, hub: { loading: true, signedIn: false, unknown: false } }).hub).toBeNull();
  expect(pageRelevance({ ...base, hub: { loading: false, signedIn: false, unknown: true } }).hub).toBe(true);
});
it("hub: disabled hub is irrelevant even while loading", () =>
  expect(pageRelevance({ ...base, hubEnabled: false, hub: { loading: true, signedIn: false, unknown: false } }).hub).toBe(false));
it("server: any saved login", () => expect(pageRelevance({ ...base, lobbyAccountCount: 1 }).server).toBe(false));
```

- [ ] **Step 2: Run** `bunx vitest run src/onboarding/relevance.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** both functions in `src/onboarding/relevance.ts`.
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Add onboarding relevance rules"` with the two files.

### Task 3: Profile `base` field

**Files:**
- Modify: `src/profile/profile.ts` (`Profile` near line 306, `StoredTheme`, `ThemeBeforeProfile`, `parseBeforeProfile`, `planProfileTheme`, `forceProfileTheme`, lines 577-716)
- Test: `src/profile/profile.test.ts` (the `planProfileTheme` describe at line 56)
- Modify: the profile docs page if one documents `accent` (`grep -rn '"accent"' docs/` to find it)

**Interfaces:**
- Produces: `Profile.base?: Base` (type `Base` from `@picoframe/frame`), forced into localStorage key `picoframe.base` exactly as `accent` is forced into `picoframe.accent`. `planProfileTheme(stored: StoredTheme, profile: Pick<Profile, "mode" | "accent" | "base">)`, with `StoredTheme.base: string | null`.

- [ ] **Step 1: Write failing tests** in the existing describe, mirroring the existing accent cases. A profile `base: "slate"` writes `{ key: "picoframe.base", value: "\"slate\"" }` and records the player's previous base in `coilbox.theme.beforeProfile`. A later launch with no `base` restores it.
- [ ] **Step 2: Run** `bunx vitest run src/profile/profile.test.ts`. Expected: the new cases FAIL.
- [ ] **Step 3: Implement** by adding `base` as a third entry in the `fields` array and to `parseBeforeProfile`'s field list. Add `const BASE_KEY = "picoframe.base"`.
- [ ] **Step 4: Run** again. Expected: PASS, including all existing cases.
- [ ] **Step 5: Commit** `git commit -m "Let a distribution profile force the base colour"`.

### Task 4: Shared pieces moved out for reuse

Pure moves. No behaviour change, so the existing tests are the check.

**Files:**
- Create: `src/lobby-servers/AddAccountForm.tsx`, holding `AddAccountForm` moved from `src/lobby-servers/pages/SettingsSection.tsx:747-857`, plus any helpers only it uses (`AddFooter`, and whichever of `loginTaken`, `serverOptions` and `identifierFieldProps` are local to that file). Helpers still used by `SettingsSection.tsx` are exported from the new file and imported back.
- Modify: `src/lobby-servers/pages/SettingsSection.tsx` to import it.
- Modify: `src/content/pages/components/SuggestionsList.tsx` to export `suggestionRequest` (line 53).
- Create: `src/content/engineDownloadRequest.ts`.
- Modify: `src/content/pages/components/SetupCard.tsx:110-141` so `downloadEngine` calls it.

**Interfaces:**
- Produces:
  - `export function AddAccountForm(props: { draft: LobbyAccount; accounts: LobbyAccount[]; servers: LobbyServer[]; onAdd: (a: LobbyAccount) => void; onCancel: () => void })`, unchanged props.
  - `export async function suggestionRequest(dl: SuggestedDownload, kind: "game" | "map", label: string, writePath: string, repos: GameRepo[]): Promise<EnqueueInput>`
  - `export async function engineDownloadRequest(writePath: string, label: (version: string) => string): Promise<EnqueueInput | null>`, which calls `fetchNewestRecoil`. It returns the `engineRecoil` input `SetupCard` builds today, or `null` when no release exists for this platform.

- [ ] **Step 1: Make the moves** listed above.
- [ ] **Step 2: Run** `bun run typecheck && bunx vitest run src/lobby-servers src/content`. Expected: PASS with no test changes.
- [ ] **Step 3: Commit** `git commit -m "Move the add-login form, suggestion request and engine request out for reuse"`.

### Task 5: The onboarding plugin, state hook and wizard shell

**Files:**
- Create: `src/onboarding/index.ts`: plugin `{ id: "onboarding", Provider: OnboardingProvider }`. Copy the plugin shape from `src/notify/index.ts`.
- Create: `src/onboarding/rerun.ts`
- Create: `src/onboarding/useWizardContext.ts`
- Create: `src/onboarding/OnboardingProvider.tsx`
- Create: `src/onboarding/Wizard.tsx`
- Create: `src/onboarding/pages/registry.ts`
- Create: `src/onboarding/pages/DonePage.tsx`
- Modify: `src/app.plugins.ts`. Import `onboardingPlugin` inside the `picoframe:imports` markers, and append it as the last entry in `plugins`.
- Modify: `src/settings-storage.ts`. `createTauriSettingsStorage` returns `FlushableSettingsStorage & { loadedKeyCount: number }`, the number of entries loaded from disk.
- Modify: `src/main.tsx:48`. Directly after `createTauriSettingsStorage()`, call `seedExistingInstall(settingsStorage, settingsStorage.loadedKeyCount)`.
- Test: `src/onboarding/wizard.dom.test.tsx`. Base the provider setup on `src/account/pages/accountSettings.dom.test.tsx`.

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces:
  - `rerun.ts`: `requestOnboardingRerun(): void`, `useOnboardingRerun(): { rerun: boolean; clear(): void }` (a `useSyncExternalStore` module store).
  - `useWizardContext(): { ctx: WizardContext; candidates: SuggestedGame[] | null }`. It builds the context from `readStoredSetting(LANGUAGE_KEY, null) !== null`, `getProfile().mode`, `getProfile().accent || getProfile().base`, `isHubEnabled()`, `useHubAccount(useHubUrl())`, `useLobbyAccounts()[0].accounts.length`, and `decideGames`. Candidates come from `getStartedCandidates({ installed, scanned, scopedGames, entries, suggestedMaps })`, with the same inputs `useCollectGetStartedOffer` gathers (`src/content/getStartedOffer.ts:101-143`) but without its setup gate. `scanned` is `null` until `scanSettled(...)` is true. When there is no scan target, pass empty `games` and `maps` so a missing engine still answers.
  - `interface WizardPageProps { next(): void }`. A page calls `next()` after its own success, for example a hub sign in.
  - `registry.ts`: `PAGE_COMPONENTS: Record<PageId, { Component: React.FC<WizardPageProps>; eyebrow: MessageDescriptor; title: MessageDescriptor }>`. Later tasks fill their entries. Until then an entry points to a stub returning `null`.
  - `Wizard({ pages, newPagesRun, onSettle, onClose, downloads })`: the shell from the spec's Shell section. `onSettle(id)` fires on Continue or Skip for the current page. "Skip setup" settles every remaining page in the run, then closes. The progress bar has one segment per page. The eyebrow is "New in Coilbox" when `newPagesRun`. `downloads` is the pill's item list, `QueueItem[]`.
  - `OnboardingProvider({ children })`: renders `children`, then the wizard. It reads `SETTLED_KEY` with `useSetting<string[]>(SETTLED_KEY, [])`. It calls `planRun` until the result is not `waiting`, then freezes that plan in state for the rest of the run, and writes `settleNow` once with `addSettled`. It opens the `Wizard` when the plan is `open`. A rerun request re-plans with `rerun: true`.

- [ ] **Step 1: Write failing DOM tests**:
  - With every page irrelevant except `done`, nothing renders.
  - With `server` relevant, the wizard renders its title and a `done` step.
  - "Skip" settles `server` in `onboarding.settled`.
  - "Skip setup" settles every page in the run and removes the overlay.
  - Pressing Escape leaves the wizard open.
  - The overlay element has classes `fixed inset-0 z-40`.

  Stub `useWizardContext` with `vi.mock` so each test sets relevance directly.
- [ ] **Step 2: Run** `bunx vitest run src/onboarding/wizard.dom.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the files above. The Done page shows one row each for language, appearance and games, plus a `QueueProgress` row (`src/downloads/pages/components/ProgressBar`) per background download.
- [ ] **Step 4: Run** the DOM test and `bun run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Add the onboarding plugin and wizard shell"`.

### Task 6: Background engine and game downloads

**Files:**
- Create: `src/onboarding/useBackgroundDownloads.ts`
- Create: `src/onboarding/DownloadsPill.tsx`
- Modify: `src/onboarding/OnboardingProvider.tsx`. It calls the hook whether or not the wizard opens, and passes `items` to `Wizard`.
- Test: `src/onboarding/backgroundDownloads.dom.test.tsx`

**Interfaces:**
- Consumes: `engineDownloadRequest` and `suggestionRequest` (Task 4), `GamesDecision` (Task 2), `useSetupStatus`, `useBundledEngine`, `useDefaultWriteRoot`, `useWriteRootPath`, `contentCreateStandardRoot`, `useDownloadQueue` (`enqueue`, `cancel`, `items`).
- Produces: `useBackgroundDownloads(args: { settled: readonly string[]; games: GamesDecision | null; onSettle(id: BackgroundId): void }): { items: QueueItem[]; cancel(id: string): void; retry(id: string): void }`

Rules:
- **Engine.** Runs while `engine` is unsettled, `needsEngine` is true and the bundled engine does not cover it (the same `bundleCovers` test as `SetupCard.tsx:50-53`). When `needsFolder` is true and there is no `missingRoot`, it first creates the standard folder the way `SetupCard.createFolder` does. If `engine` is unsettled and an engine is found, it settles `engine` at once.
- **Game.** Runs while `game` is unsettled and `games?.kind === "auto"`. It queues `suggestionRequest(game.downloads[0] ...)` once a write path exists. Copy how `SuggestionsList` picks a game's download and label. Any other decision settles `game` at once.
- **Settling.** Each id settles when its queue item reaches `done`, `error` or `canceled`.
- **Retry.** Re-enqueues the same input.

- [ ] **Step 1: Write failing tests** with `vi.mock` on the download queue and the content hooks:
  - Engine queued once when missing.
  - Not queued when the bundled engine is `copying`.
  - Not queued when `engine` is settled.
  - `engine` settles when the item turns `canceled`.
  - Game queued for `auto`.
  - `game` settles at once for `pick`.
- [ ] **Step 2: Run** `bunx vitest run src/onboarding/backgroundDownloads.dom.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the hook and `DownloadsPill`. The pill sits at the top right of the wizard, with one entry per item showing its label and percentage. An active item gets a cancel `Button`, and a failed item gets a retry `Button` and its error text.
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Download the engine and a distribution's game in the background on first run"`.

### Task 7: Language page

**Files:** Create `src/onboarding/pages/LanguagePage.tsx`. Register it in `registry.ts`. Test: `src/onboarding/pages/languagePage.dom.test.tsx`.

**Interfaces:** Consumes `pickerLocales()`, `localeDisplayName(code)` and `resolveLocaleTag(navigator.language)` from `src/i18n/locales.ts`, and `useLanguageSetting()` from `src/i18n/language.ts`.

- [ ] **Step 1: Failing tests:**
  - One option per `pickerLocales()` entry, named by `localeDisplayName`.
  - The system locale starts selected.
  - Choosing `de` writes `"de"` to `general.language` straight away.
  - Continue with nothing changed writes the preselected code.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement.** Use a grid of selectable option buttons with a visible selected state (`aria-pressed`). Continue writes the selection before calling `next`.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Add the onboarding language page"`.

### Task 8: Appearance page

**Files:** Create `src/onboarding/pages/AppearancePage.tsx`. Register it. Test: `src/onboarding/pages/appearancePage.dom.test.tsx`.

**Interfaces:** Consumes `useTheme()` (`mode`, `setMode`, `accent`, `setAccent`, `base`, `setBase`) and `ACCENTS`/`BASES`. Import those from `@picoframe/frame` if exported there. Otherwise use whatever the Appearance settings section imports, found with `grep -rn "ACCENTS" src node_modules/@picoframe/frame/dist/index.d.ts`. Also consumes `getProfile()`.

- [ ] **Step 1: Failing tests:**
  - The mode row hides when the profile sets `mode`.
  - The colour rows hide when the profile sets `accent` or `base`.
  - Clicking a swatch calls `setAccent` with its value.
  - Every swatch has an accessible name, its value's label.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement.** Mode uses a segmented control from the registry `radio-group`. Swatches are buttons at least 24x24 px.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Add the onboarding appearance page"`.

### Task 9: Games page

**Files:** Create `src/onboarding/pages/GamesPage.tsx`. Register it. Test: `src/onboarding/pages/gamesPage.dom.test.tsx`.

**Interfaces:** Consumes the `pick` decision's games, read through a context the provider exposes as `useWizardGames(): SuggestedGame[]`. Add that to `OnboardingProvider.tsx`. Renders `SuggestionsList` with `kind="game"`, `items` and `writeRoot` from `useWriteRoot` (whatever `GetStartedCard` passes).

- [ ] **Step 1: Failing test:** renders one card per game in the decision.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement** the page.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Add the onboarding games page"`.

### Task 10: Hub page

**Files:** Create `src/onboarding/pages/HubPage.tsx`. Register it. Test: `src/onboarding/pages/hubPage.dom.test.tsx`.

**Interfaces:** Consumes `useHubAccount(useHubUrl())`, which provides `signIn` and `problem`.

- [ ] **Step 1: Failing tests,** with `signInToHub` mocked:
  - Pressing "Sign in with Discord" calls it.
  - Success calls `next`.
  - A rejection shows its message in a `role="alert"` element and keeps the page.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement.** Use a three-item list (publish maps, scenarios and presets, import from hub links, keep uploads under one name) and the Discord button.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Add the onboarding hub page"`.

### Task 11: Server page

**Files:** Create `src/onboarding/pages/ServerPage.tsx`. Register it. Test: `src/onboarding/pages/serverPage.dom.test.tsx`.

**Interfaces:** Consumes `AddAccountForm` (Task 4), `RegisterForm`, `allServers(customServers)` from `src/lobby-servers/config.ts`, `profileOfficialServer()`, `useCustomServers()` and `useLobbyAccounts()`.

- [ ] **Step 1: Failing tests:**
  - The Log in tab renders `AddAccountForm`, with the profile's official server first in `servers`.
  - `onAdd` appends to `lobbyServers.accounts` and calls `next`.
  - The Register tab renders `RegisterForm`, whose `onSuccess` calls `next`.
  - `onCancel` on either one calls the wizard's skip.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement.** Use the registry `tabs` if installed, otherwise two `Button`s with `aria-pressed`. Build the draft the way `SettingsSection.tsx:204` does (`crypto.randomUUID()`, first server's id, empty username).
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Check on screen** (Task 13 instance) that the server `Select` opens above the overlay.
- [ ] **Step 6: Commit** `git commit -m "Add the onboarding server page"`.

### Task 12: Run setup again

**Files:** Modify `src/general/pages/SettingsSection.tsx`. Test: add a case to a new `src/general/pages/SettingsSection.setup.dom.test.tsx`, modelled on `SettingsSection.language.dom.test.tsx`.

**Interfaces:** Consumes `requestOnboardingRerun()` (Task 5).

- [ ] **Step 1: Failing test:** a "Run setup again" button exists and calls `requestOnboardingRerun` (mocked).
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement.** Use a row with the label "Setup" and the button, using `Field` from `src/components/Field.tsx`.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Add Run setup again to General settings"`.

### Task 13: Strings, full check and on-screen verification

**Files:** `src/locales/*/messages.po`, regenerated.

- [ ] **Step 1: Run** `bun run i18n:extract`. Expected: new English ids in every catalog. Leave the other languages untranslated. Lingui falls back to English.
- [ ] **Step 2: Run** `bun run check`. Expected: all seven commands pass, with outputs in `check-output/`.
- [ ] **Step 3: On screen.** Start a seeded portable instance on its own port and MCP socket (see `CLAUDE.md`, Driving the app). Delete `onboarding.settled`, `general.language` and `lobbyServers.accounts` from its copied settings, then confirm:
  - The wizard covers the sidebar.
  - The language and appearance pages apply live.
  - The pill shows the engine download when the copied profile has no engine.
  - Nothing in the frame draws over the wizard.
  - "Skip setup" lands on Home.
  - A relaunch does not reopen the wizard.

  Do not use the hub sign in or the login and register forms.
- [ ] **Step 4: On screen with a profile.** Add `.coilbox/profile.json` with `"mode": "dark"`, `"accent": "rose"` and `"gameFilter": { "names": ["SplinterFaction"] }`, then reset as in step 3. Confirm:
  - The appearance page is gone.
  - No games page shows.
  - The pill lists Splinter Faction, or nothing if it is installed.
- [ ] **Step 5: Seeding check.** Relaunch the instance with its original copied settings and no `onboarding.settled`. Confirm the wizard does not open and the key now holds all eight ids.
- [ ] **Step 6: Commit** `git commit -m "Extract onboarding strings"`. Revert the local MCP socket and port edits before committing.
