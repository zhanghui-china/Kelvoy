/**
 * HTTP client to the local, always-on services/inference process (PRD §9).
 * Same machine/network, called by the worker after pulling a task.
 */
const INFERENCE_BASE_URL = process.env.INFERENCE_BASE_URL ?? "http://127.0.0.1:8100";

export async function callInference(path: string, _body: unknown): Promise<unknown> {
  throw new Error(`not implemented: POST ${INFERENCE_BASE_URL}${path}`);
}
