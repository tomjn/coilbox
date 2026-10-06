import type { GalaxyDoc } from "../model";

/**
 * Whether the view paints towns, the fields round them and the roads between
 * provinces' towns. A generated map does, because it has its own picture
 * pixels. A hand-made map does only when its manifest asked, since its
 * author's picture may already show towns. Performance mode goes without.
 */
export function paintsTowns(
  galaxy: Pick<GalaxyDoc, "handmade">,
  generatedPixels: boolean,
  performanceMode: boolean,
): boolean {
  if (performanceMode) return false;
  return generatedPixels || galaxy.handmade?.towns === true;
}
