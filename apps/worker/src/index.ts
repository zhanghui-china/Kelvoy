/**
 * GPU worker entrypoint (ADR-0004). Polls the local task queue
 * (@kelvoy/store, no Redis), calls the local inference service, writes
 * artifacts to local disk, writes status back via @kelvoy/store.
 */
import { consumeLoop } from "./queue/consumer";

consumeLoop();
