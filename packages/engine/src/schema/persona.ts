export interface PersonaStyle {
  lut: string; // e.g. "lut/warm_film.cube"
  title_style: string; // e.g. "serif-center"
}

export interface Persona {
  persona_id: string;
  owner_id: string;
  version: number; // bumped on every edit; episodes snapshot the version they were generated with
  name: string;
  desc: string;
  locked: string[]; // e.g. ["脸型", "发型", "体态"]
  default_outfit: string;
  refs: string[]; // object-storage paths; user-uploaded, real photos allowed (PRD v0.2 §3)
  style: PersonaStyle;
}
