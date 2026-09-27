/**
 * GPU worker entrypoint (ADR-0004). Polls the local task queue
 * (@kelvoy/store, no Redis), calls the local inference service, writes
 * artifacts to local disk, writes status back via @kelvoy/store.
 */
import { consumeLoop } from "./queue/consumer";
import { cleanupStaleInferenceMedia } from "./storage/cleanup";

const sweep = () => {
  void cleanupStaleInferenceMedia().catch((error) => {
    console.warn("could not clean stale inference media", error);
  });
};
sweep();
setInterval(sweep, 60 * 60 * 1000);
consumeLoop();
