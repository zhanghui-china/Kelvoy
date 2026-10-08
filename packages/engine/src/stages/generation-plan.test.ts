import { expect, test } from 'bun:test';
import type { Episode, Shot } from '../schema';
import { planStoryboardGeneration } from './generation-plan';
function shot(no: number, status: Shot['status'], extra: Partial<Shot> = {}): Shot {
  return { no, status, candidates: [], kf_selected: null, clip: null, ...extra } as Shot;
}
function episode(shots: Shot[], video_source: Episode['video_source'] = 'keyframe'): Episode {
  return { shots, video_source } as Episode;
}
test('inserting one draft after approved clips only plans that missing image', () => {
  const existing = shot(1, 'approved', { clip: 'clip/old.mp4' });
  const fresh = shot(2, 'draft');
  expect(planStoryboardGeneration(episode([existing, fresh]))).toEqual({ next_status: 'assets', keyframes: [fresh], videos: [] });
});
test('motion-only edit uses selected frame and plans only video', () => {
  const fresh = shot(1, 'kf_selected', { candidates: ['kf/old.png'], kf_selected: 'kf/old.png' });
  expect(planStoryboardGeneration(episode([fresh]))).toEqual({ next_status: 'assets', keyframes: [], videos: [fresh] });
});
test('valid candidates need selection without another image charge', () => {
  expect(planStoryboardGeneration(episode([shot(1, 'kf_ready', { candidates: ['kf/a.png'] })])).next_status).toBe('kf_review');
});
test('caption or order change with approved clips only needs composition', () => {
  expect(planStoryboardGeneration(episode([shot(1, 'approved', { clip: 'clip/old.mp4' })]))).toEqual({ next_status: 'compose_ready', keyframes: [], videos: [] });
});
test('references mode only generates missing video, retains approved and ready clips', () => {
  const fresh = shot(3, 'draft');
  expect(planStoryboardGeneration(episode([shot(1, 'approved', { clip: 'clip/1.mp4' }), shot(2, 'clip_ready', { clip: 'clip/2.mp4' }), fresh], 'references'))).toEqual({ next_status: 'assets', keyframes: [], videos: [fresh] });
});

import { mergeGeneratedShotResult } from './generation-commit';
test('generation result targets stable identity rather than a reused display number', () => {
  const initial = episode([{ ...shot(2, 'generating_kf'), shot_id: 'sh_stable' }]);
  const generated = { ...initial, shots: [{ ...initial.shots[0]!, status: 'kf_ready' as const, candidates: ['kf/stable.png'] }] };
  expect(mergeGeneratedShotResult('keyframe', 'sh_stable', initial, initial, generated)?.shots[0]?.candidates).toEqual(['kf/stable.png']);
  const replaced = { ...initial, shots: [{ ...initial.shots[0]!, shot_id: 'sh_other' }] };
  expect(mergeGeneratedShotResult('keyframe', 'sh_stable', initial, replaced, generated)).toBeNull();
});
