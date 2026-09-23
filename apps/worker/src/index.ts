/**
 * GPU worker entrypoint (PRD §9). Runs on DGX: pulls the queue (outbound
 * only, no inbound port), calls the local inference service, pushes
 * artifacts to object storage, writes status back.
 */
import { consumeLoop } from "./queue/consumer";

consumeLoop();
