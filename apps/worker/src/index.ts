/**
 * GPU worker entrypoint (ADR-0004). Polls the local task queue
 * (@kelvoy/store, no Redis), calls the local inference service, writes
 * artifacts to local disk, writes status back via @kelvoy/store.
 */
import { consumeLoop } from "./queue/consumer";
import { cleanupIncompleteEpisodeMedia, cleanupStaleEpisodeTemps, cleanupStaleInferenceMedia } from "./storage/cleanup";

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
setInterval(sweep, 60 * 60 * 1000);
consumeLoop();
