import { videoTimeoutSeconds } from "./inference-client";
/**
 * GPU worker entrypoint (ADR-0004). Polls the local task queue
 * (@kelvoy/store, no Redis), calls the local inference service, writes
 * artifacts to local disk, writes status back via @kelvoy/store.
 */
import { consumeLoop } from "./queue/consumer";
import { installShutdownHandlers } from "./queue/shutdown";
import { cleanupIncompleteEpisodeMedia, cleanupStaleEpisodeTemps, cleanupStaleInferenceMedia } from "./storage/cleanup";
import { cleanupDeletedEpisodes } from "./storage/episode-deletion";

videoTimeoutSeconds();

const sweep = () => {
  void cleanupStaleInferenceMedia().catch((error) => {
    console.warn("could not clean stale inference media", error);
  });
  void cleanupStaleEpisodeTemps().catch((error) => {
    console.warn("could not clean stale episode publish temps", error);
  });
  void cleanupIncompleteEpisodeMedia().catch((error) => {
    console.warn("could not clean incomplete episode media", error);
  });
};
sweep();
let deletionSweepActive = false;
const sweepDeletions = async () => {
  if (deletionSweepActive) return;
  deletionSweepActive = true;
  try { await cleanupDeletedEpisodes(); }
  catch { console.warn("could not scan pending episode deletions"); }
  finally { deletionSweepActive = false; }
};
void sweepDeletions();
const deletionSweepTimer = setInterval(() => { void sweepDeletions(); }, 60_000);
const controller = new AbortController();
const uninstall = installShutdownHandlers(controller);
const sweepTimer = setInterval(sweep, 60 * 60 * 1000);
void consumeLoop(controller.signal).finally(() => {
  clearInterval(sweepTimer);
  clearInterval(deletionSweepTimer);
  uninstall();
});
