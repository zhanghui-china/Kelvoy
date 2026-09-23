import type { DestinationType } from "./destination";

// FR-10: skeleton + visual style. owner_id null = official built-in.
export interface Template {
  template_id: string;
  owner_id: string | null;
  name: string;
  skeleton: DestinationType;
  lut: string;
  intro: string | null;
  outro: string | null;
  title_style: string;
}
