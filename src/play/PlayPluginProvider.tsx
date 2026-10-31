import type { ReactNode } from "react";
import { FollowedPacksStartRefresh } from "./followedPacks";
import { PlayProvider } from "./PlayProvider";

/**
 * What the play plugin mounts for the life of the app: the shared game run, and
 * the refresh of followed preset packs at app start. Kept out of `PlayProvider`,
 * which is mounted bare wherever a test needs a launch, because the refresh reads
 * the frame's settings.
 */
export function PlayPluginProvider({ children }: { children: ReactNode }) {
  return (
    <PlayProvider>
      <FollowedPacksStartRefresh />
      {children}
    </PlayProvider>
  );
}
