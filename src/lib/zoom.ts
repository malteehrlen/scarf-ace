// Page zoom: a fixed level, or "fit" (the page fills the width of the writing area).
// The page is 8.5in wide; CSS renders an inch as 96px.

export type Zoom = 'fit' | number

export const ZOOM_LEVELS = [0.75, 1, 1.25, 1.5, 2] as const
export const PAGE_WIDTH_PX = 8.5 * 96
const FIT_MIN = 0.5
const FIT_MAX = 3

/** Scale that makes the page exactly fill `availableWidth` CSS pixels. */
export function fitScale(availableWidth: number): number {
  if (!(availableWidth > 0)) return 1
  // Rounded down so sub-pixel rounding can't make the page a hair too wide (a horizontal scrollbar).
  const scale = Math.floor((availableWidth / PAGE_WIDTH_PX) * 1000) / 1000
  return Math.min(FIT_MAX, Math.max(FIT_MIN, scale))
}

export function parseZoom(value: string | null): Zoom {
  if (value === 'fit') return 'fit'
  const n = Number(value)
  return (ZOOM_LEVELS as readonly number[]).includes(n) ? n : 1
}

export function zoomLabel(zoom: Zoom, effective?: number): string {
  if (zoom === 'fit') return effective ? `Fit · ${Math.round(effective * 100)}%` : 'Fit width'
  return `${Math.round(zoom * 100)}%`
}
