import type { Destination, DestinationDraft, DestinationDraftContent } from "@kelvoy/engine";
import type { ApiResult } from "./client";
async function request<T>(path: string, method = "GET", body?: unknown): Promise<ApiResult<T>> {
  try {
    const multipart = body instanceof FormData;
    const response = await fetch(path, { method, ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body), headers: multipart ? undefined : { "content-type": "application/json" } }) });
    return await response.json().catch(() => ({ ok: false, error: "invalid_response" }));
  } catch { return { ok: false, error: "network_error" }; }
}
const path = (id: string) => `/api/destination-drafts/${encodeURIComponent(id)}`;
export const listDestinationDrafts = () => request<{ drafts: DestinationDraft[] }>("/api/destination-drafts");
export const createDestinationDraft = () => request<{ draft: DestinationDraft }>("/api/destination-drafts", "POST", {});
export const getDestinationDraft = (id: string) => request<{ draft: DestinationDraft }>(path(id));
export const saveDestinationDraft = (draft: DestinationDraft, content: DestinationDraftContent) => request<{ draft: DestinationDraft }>(path(draft.draft_id), "PUT", { edit_version: draft.edit_version, content });
export const deleteDestinationDraft = (draft: DestinationDraft) => request<Record<string, never>>(path(draft.draft_id), "DELETE", { edit_version: draft.edit_version });
export const editDestination = (id: string) => request<{ draft: DestinationDraft }>(`/api/destinations/${encodeURIComponent(id)}/edit`, "POST", {});
export const publishDestinationDraft = (draft: DestinationDraft) => request<{ draft: DestinationDraft; destination: Destination }>(`${path(draft.draft_id)}/publish`, "POST", { edit_version: draft.edit_version });
export function uploadDestinationPhotos(draft: DestinationDraft, landmarkId: string, files: File[]) {
  const form = new FormData();
  form.append("edit_version", String(draft.edit_version));
  files.forEach(file => form.append("files", file));
  return request<{ draft: DestinationDraft }>(`${path(draft.draft_id)}/landmarks/${encodeURIComponent(landmarkId)}/photos`, "POST", form);
}
export const removeDestinationPhoto = (draft: DestinationDraft, landmarkId: string, key: string) => request<{ draft: DestinationDraft }>(`${path(draft.draft_id)}/landmarks/${encodeURIComponent(landmarkId)}/photos`, "DELETE", { edit_version: draft.edit_version, key });
export const destinationDraftAssetUrl = (id: string, key: string) => `${path(id)}/assets/${key.split("/").map(encodeURIComponent).join("/")}`;
