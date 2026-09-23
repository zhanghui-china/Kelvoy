/**
 * Object storage push + signed URL (PRD §9: OSS/MinIO — SDK not chosen yet,
 * open question). Worker pushes artifacts here after each stage; the
 * browser fetches them via signed URLs.
 */
export async function pushArtifact(_localPath: string, _remoteKey: string): Promise<void> {
  throw new Error("not implemented");
}

export async function signUrl(_remoteKey: string): Promise<string> {
  throw new Error("not implemented");
}
