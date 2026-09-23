import type { Destination, Episode, EpisodeBrief, Persona, Shot } from "../schema";

export interface ScriptProvider {
  generateShots(input: { brief: EpisodeBrief; destination: Destination }): Promise<Shot[]>;
}

export interface IdentityProvider {
  applyPersona(input: { persona: Persona; targetPrompt: string }): Promise<string>; // image path
}

export interface KeyframeProvider {
  generateCandidates(input: {
    shot: Shot;
    persona: Persona;
    destination: Destination;
    count: number;
  }): Promise<string[]>;
}

export interface VideoProvider {
  generateClip(input: { keyframePath: string; motionPrompt: string }): Promise<string>;
}

export interface UpscaleProvider {
  upscale(input: { path: string }): Promise<string>;
}

export interface MusicProvider {
  selectTrack(input: { bpm?: number; tone?: string }): Promise<{
    file: string;
    bpm: number;
    license: string;
  }>;
}

export interface ComposeProvider {
  compose(input: { episode: Episode }): Promise<{ outputPath: string }>;
}
