export interface Landmark {
  id: string;
  name: string;
  refs: string[];
  best_time: string;
  must_keep?: string[];
}

export interface Destination {
  destination_id: string;
  name: string;
  city: string;
  type: string; // drives narrative-skeleton selection, FR-02
  season_best: string[];
  landmarks: Landmark[];
  route: string[];
  food: string[];
  transport: string;
  stay: string;
}
