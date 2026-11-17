import { useEffect, useState } from "react";
import { unitsyncUploadFacts } from "@/content/bindings";
import { describeError } from "@/i18n/uiError";
import type { ArchiveFacts } from "../archiveUploads";

/** The one archive to read the upload facts of. Give a map or a game, not both. */
export interface FactsRequest {
  enginePath: string;
  dataDir: string;
  /** A map's unitsync name. */
  map?: string;
  /** A game's primary archive name. */
  game?: string;
}

export interface UploadFactsState {
  /** True until the read has answered. */
  loading: boolean;
  facts?: ArchiveFacts;
  /** A sentence for the player: why this archive cannot be uploaded. */
  problem?: string;
  /** The read itself failed, as opposed to answering that it cannot be done. */
  failed?: string;
}

const IDLE: UploadFactsState = { loading: false };
const LOADING: UploadFactsState = { loading: true };

/**
 * Read the facts of one archive, when `request` is given, and again when `again`
 * changes. Reading hashes the file the first time, which is why a page asks only
 * when it needs the answer: the unitsync side caches the hash on the file, so
 * the second ask reads no bytes.
 */
export function useUploadFacts(
  request: FactsRequest | null,
  again = 0,
): UploadFactsState {
  const [state, setState] = useState<UploadFactsState>(IDLE);
  const { enginePath, dataDir, map, game } = request ?? {};
  const wanted = request !== null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `again` is the signal to read again
  useEffect(() => {
    if (!wanted || !enginePath || !dataDir) {
      setState(IDLE);
      return;
    }
    let live = true;
    setState(LOADING);
    unitsyncUploadFacts({ enginePath, dataDir, map, game })
      .then((answer) => {
        if (!live) return;
        setState(
          answer.facts
            ? { loading: false, facts: answer.facts }
            : {
                loading: false,
                problem: answer.problem,
                failed: answer.problem ? undefined : answer.errors[0],
              },
        );
      })
      .catch((e: unknown) => {
        if (live) setState({ loading: false, failed: describeError(e) });
      });
    return () => {
      live = false;
    };
  }, [wanted, enginePath, dataDir, map, game, again]);
  return state;
}
