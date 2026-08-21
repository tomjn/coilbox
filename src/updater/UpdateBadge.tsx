import { Download, RefreshCw } from "lucide-react";
import { Link } from "react-router";
import { useUpdater } from "./UpdaterProvider";

/**
 * topbar.right slot: what the state of a coilbox update is, shown only when
 * there is one.
 *
 * It says nothing about the download, which is the topbar download indicator's
 * job now that an app update reports there (issue #1790). Two pills about the
 * same transfer is exactly the clutter that indicator exists to avoid, so this
 * one steps aside while the bytes are moving and picks the update back up at
 * the install.
 */
export default function UpdateBadge() {
  const { update, progress, installed } = useUpdater();
  if (!update || progress.status === "downloading") return null;

  const restart = installed;
  const label = restart
    ? "Restart to update"
    : progress.status === "installing"
      ? "Installing update"
      : "Update available";
  return (
    <Link
      to="/settings/updates"
      className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20"
    >
      {restart ? <RefreshCw size={14} /> : <Download size={14} />}
      {label}
    </Link>
  );
}
