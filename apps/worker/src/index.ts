import { videoTimeoutSeconds } from "./inference-client";
/**
 * GPU worker entrypoint (ADR-0004). Polls the local task queue
 * (@kelvoy/store, no Redis), calls the local inference service, writes
 * artifacts to local disk, writes status back via @kelvoy/store.
 */
import { consumeLoop } from "./queue/consumer";
import { installShutdownHandlers } from "./queue/shutdown";
import { cleanupIncompleteEpisodeMedia, cleanupStaleEpisodeTemps, cleanupStaleInferenceMedia } from "./storage/cleanup";

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
const controller = new AbortController();
const uninstall = installShutdownHandlers(controller);
const sweepTimer = setInterval(sweep, 60 * 60 * 1000);
void consumeLoop(controller.signal).finally(() => {
  clearInterval(sweepTimer);
  uninstall();
});
