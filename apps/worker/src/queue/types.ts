import type { StageName } from "@kelvoy/engine";

export interface Task {
  episode_id: string;
  stage: StageName;
  shot_no?: number;
}
