export function focusedShot(shotNos: number[], currentNo: number | null): number | null {
  if (currentNo !== null && shotNos.includes(currentNo)) return currentNo;
  return shotNos[0] ?? null;
}

export function neighboringShot(shotNos: number[], currentNo: number | null, direction: -1 | 1): number | null {
  const index = shotNos.indexOf(currentNo ?? NaN);
  return shotNos[index + direction] ?? null;
}
