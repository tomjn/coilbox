/**
 * The scenario editor's write path, which is the shared one in
 * `@/lib/documentSaver` bound to a scenario. See there for why writes queue.
 */

import { createDocumentSaver, type DocumentSaver } from "@/lib/documentSaver";
import type { Scenario } from "../../model";

export type ScenarioSaver = DocumentSaver<Scenario>;

export const createScenarioSaver = createDocumentSaver<Scenario>;
