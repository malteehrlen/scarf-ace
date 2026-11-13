// Light/dark theme. The saved preference may be "system", which follows the OS setting live.
// index.html applies the same logic inline before first paint so there's no flash.

export type ThemePreference = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

export const THEME_KEY = 'scarfAce:theme'
const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)')

export function readThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

export function saveThemePreference(preference: ThemePreference) {
  try {
    if (preference === 'system') localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, preference)
  } catch {
    // The choice just won't survive a reload.
  }
}

export function resolveTheme(preference: ThemePreference): Theme {
  if (preference !== 'system') return preference
  return darkQuery().matches ? 'dark' : 'light'
}

/**
 * Toolbar color per theme (the --panel token). Installed apps paint their window controls with the
 * page's theme color, so it matches the toolbar the controls sit in. Keep in sync with style.css
 * and the inline script in index.html.
 */
export const THEME_COLORS: Record<Theme, string> = { light: '#f7f6f3', dark: '#19191c' }

export function applyTheme(preference: ThemePreference) {
  const theme = resolveTheme(preference)
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme])
}

/** Calls back when the OS switches between light and dark. Returns a function that stops listening. */
export function onSystemThemeChange(callback: () => void): () => void {
  const query = darkQuery()
  query.addEventListener('change', callback)
  return () => query.removeEventListener('change', callback)
}
