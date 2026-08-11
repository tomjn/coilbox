import { useScanTargetSelection } from "../config";
import { BrowserToolbar } from "./components/BrowserToolbar";
import { ConfigProfilesPanel } from "./components/ConfigProfilesPanel";
import { EmptyState } from "./components/states";

/**
 * Saved copies of a content root's whole engine config, in Engine Settings.
 *
 * It sat at the bottom of the single engine settings page. Splitting that page
 * by category left it with no category to belong to, which is the right answer:
 * it applies to all of them at once. It saves and restores `springsettings.cfg`,
 * `LuaUI/Config/` and `uikeys.txt` together, so it is a page about the whole
 * config rather than about any setting on it.
 *
 * Profiles belong to a content root, not to an engine, but the picker here is
 * the same one the category pages use, because the root is what the reader
 * chose an engine within.
 */
export default function EngineProfilesSection() {
  const { targets, selected, selectedKey, setSelectedKey, loading, refresh } =
    useScanTargetSelection();

  return (
    <div className="space-y-4">
      {/* No intro paragraph. The section's own description sits under the page
          title, and the panel below says what a profile covers. */}
      <BrowserToolbar
        targets={targets}
        selectedKey={selectedKey}
        onSelect={setSelectedKey}
        onRescan={refresh}
        scanning={loading}
      />

      {selected?.rootPath ? (
        <ConfigProfilesPanel rootPath={selected.rootPath} />
      ) : (
        <EmptyState label="No content folder selected, so there is nothing to save a copy of yet." />
      )}
    </div>
  );
}
