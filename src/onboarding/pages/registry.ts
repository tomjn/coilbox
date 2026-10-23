import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { FC } from "react";
import type { PageId } from "../ids";
import AppearancePage from "./AppearancePage";
import DonePage from "./DonePage";
import GamesPage from "./GamesPage";
import HubPage from "./HubPage";
import LanguagePage from "./LanguagePage";
import ServerPage from "./ServerPage";

/**
 * What the shell hands a page. Both settle the current page and move on: a page
 * calls `next()` after its own success, such as a hub sign in, and `skip()`
 * when it offers its own way out.
 *
 * `beforeContinue` is run by the footer's Continue button, and not by Skip, so
 * a page can save a choice the player accepted without changing it. A page sets
 * it in an effect and clears it in that effect's cleanup.
 */
export interface WizardPageProps {
  next(): void;
  skip(): void;
  beforeContinue: { current: (() => void) | null };
}

/**
 * What the shell paints behind a page: one of the bundled tool drawings by its
 * key in `src/home/bundledArt.ts`, or `"setup"` for the profile's setup image
 * with the Home backdrop as its fallback.
 */
export type WizardArtSpec = { drawing: string } | "setup";

/**
 * A page the shell heads with a title, or one that draws its own heading with
 * `WIZARD_TITLE_ID`. `art` is painted by the shell across the whole window
 * above the footer.
 */
export type WizardPageEntry = {
  Component: FC<WizardPageProps>;
  art?: WizardArtSpec;
} & ({ ownHeading?: false; title: MessageDescriptor } | { ownHeading: true });

export const PAGE_COMPONENTS: Record<PageId, WizardPageEntry> = {
  language: {
    Component: LanguagePage,
    title: msg`Choose your language`,
  },
  appearance: {
    Component: AppearancePage,
    title: msg`Appearance`,
  },
  games: {
    Component: GamesPage,
    ownHeading: true,
  },
  hub: {
    Component: HubPage,
    ownHeading: true,
    art: { drawing: "hub.browse" },
  },
  server: {
    Component: ServerPage,
    title: msg`Log in to a server`,
    art: { drawing: "multiplayer.lobby" },
  },
  done: {
    Component: DonePage,
    ownHeading: true,
    art: "setup",
  },
};
