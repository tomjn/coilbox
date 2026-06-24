import { AppFrame } from "@picoframe/frame";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { plugins } from "./app.plugins";
import { createTauriSettingsStorage } from "./settings-storage";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

// Hydrate the settings cache from app-data before first render, so useSetting
// reads return persisted values synchronously on mount.
const settingsStorage = await createTauriSettingsStorage();

createRoot(root).render(
  <StrictMode>
    <AppFrame plugins={plugins} title="Coilbox" settingsStorage={settingsStorage} />
  </StrictMode>,
);
