export type ShotSize = "wide" | "medium" | "close" | "detail" | "pov";
export type ShotCamera = "static" | "pan" | "push" | "follow";
export type ShotStatus = "draft" | "kf_ready" | "clip_ready" | "approved" | "rejected";

export interface Scene {
  id: string;
  name: string;
  time: string; // e.g. "morning" — free-form per PRD example
  landmarks: string[]; // Landmark.id[]
}

export interface ShotModelRef {
  image?: string;
  video?: string;
}

export interface Shot {
  no: number;
  scene: string; // Scene.id
  size: ShotSize;
  beat: string;
  camera: ShotCamera;
  landmark: string | null; // Landmark.id
  kf_prompt: string;
  motion_prompt: string;
  duration_s: number;
  candidates: string[];
  kf_selected: string | null;
  clip: string | null;
  trim_start_s: number | null;
  status: ShotStatus;
  cost_usd: number;
  model: ShotModelRef;
}

export interface EpisodeBrief {
  season: string;
  aspect: string; // "9:16"
  duration_s: number;
  tone: string;
  outfit_override: string | null;
  banned: string[];
}

export interface EpisodeShare {
  enabled: boolean;
  slug: string;
}

export interface EpisodeMusic {
  file: string;
  bpm: number;
  license: string;
}

export interface EpisodeRender {
  res: string;
  fps: number;
  title: string;
  ai_label: boolean;
}

export interface Episode {
  episode_id: string;
  persona_id: string;
  destination_id: string;
  series_id: string;
  credits_used: number;
  share: EpisodeShare;
  brief: EpisodeBrief;
  template: string;
  scenes: Scene[];
  shots: Shot[];
  music: EpisodeMusic;
  render: EpisodeRender;
}
