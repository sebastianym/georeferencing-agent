import { latLngToCell, cellToBoundary } from 'h3-js';

export interface DensityCell {
  cellId: string;
  count: number;
  boundary: { lat: number; lng: number }[];
}

// Resolution 8 gives ~0.7 km² hexagons — fine enough to separate barrios in a
// city like Bogotá or Cartagena without fragmenting into one hex per address.
export const DEFAULT_H3_RESOLUTION = 8;

// A dataset can span one barrio or the whole country. A fixed resolution
// either disappears at country zoom or turns into one hex per point at
// barrio zoom, so pick a coarser cell size the wider the points spread.
export function pickResolution(positions: { lat: number; lng: number }[]): number {
  if (positions.length === 0) return DEFAULT_H3_RESOLUTION;
  const lats = positions.map((p) => p.lat);
  const lngs = positions.map((p) => p.lng);
  const span = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lngs) - Math.min(...lngs));
  if (span > 3) return 5;
  if (span > 1) return 6;
  if (span > 0.3) return 7;
  if (span > 0.05) return 8;
  return 9;
}

export function computeDensityCells(
  positions: { lat: number; lng: number }[],
  resolution: number = pickResolution(positions)
): DensityCell[] {
  const counts = new Map<string, number>();
  for (const { lat, lng } of positions) {
    const cellId = latLngToCell(lat, lng, resolution);
    counts.set(cellId, (counts.get(cellId) ?? 0) + 1);
  }

  return Array.from(counts.entries()).map(([cellId, count]) => ({
    cellId,
    count,
    boundary: cellToBoundary(cellId).map(([lat, lng]) => ({ lat, lng })),
  }));
}

export function densityColor(count: number, maxCount: number): string {
  const ratio = maxCount > 0 ? count / maxCount : 0;
  if (ratio > 0.75) return '#b91c1c';
  if (ratio > 0.5) return '#f97316';
  if (ratio > 0.25) return '#facc15';
  return '#86efac';
}
