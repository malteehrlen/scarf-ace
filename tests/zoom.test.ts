import { describe, expect, it } from 'vitest'
import { PAGE_WIDTH_PX, fitScale, parseZoom, zoomLabel } from '../src/lib/zoom'

describe('zoom', () => {
  it('fits the page to the available width, within limits', () => {
    expect(fitScale(PAGE_WIDTH_PX)).toBe(1)
    expect(fitScale(PAGE_WIDTH_PX * 1.5)).toBe(1.5)
    expect(fitScale(100)).toBe(0.5)
    expect(fitScale(100_000)).toBe(3)
    expect(fitScale(0)).toBe(1)
  })

  it('parses stored values, falling back to 100%', () => {
    expect(parseZoom('fit')).toBe('fit')
    expect(parseZoom('1.25')).toBe(1.25)
    expect(parseZoom('1.3')).toBe(1)
    expect(parseZoom(null)).toBe(1)
    expect(parseZoom('garbage')).toBe(1)
  })

  it('labels levels', () => {
    expect(zoomLabel(1.5)).toBe('150%')
    expect(zoomLabel('fit', 1.437)).toBe('Fit · 144%')
    expect(zoomLabel('fit')).toBe('Fit width')
  })
})
