import { useLayoutEffect, useState } from 'react';

export type Theme = 'system' | 'light' | 'dark';
export type ColorScheme = Exclude<Theme, 'system'>;
const preferenceKey = 'route-studio-theme';

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(preferenceKey);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Appearance remains usable when browser storage is unavailable.
  }
  return 'system';
}

function resolveTheme(theme: Theme): ColorScheme {
  return theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
}

function applyTheme(scheme: ColorScheme) {
  document.documentElement.dataset.theme = scheme;
  document.documentElement.style.colorScheme = scheme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', scheme === 'dark' ? '#111113' : '#ffffff');
}

// Apply the saved appearance before mounting the editor or loading a recovery draft.
export function initializeTheme() {
  const theme = readTheme();
  applyTheme(resolveTheme(theme));
  window.routeStudioDesktop?.setTheme(theme);
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [scheme, setScheme] = useState<ColorScheme>(() => resolveTheme(theme));
  useLayoutEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => {
      const next = resolveTheme(theme);
      applyTheme(next);
      setScheme(next);
    };
    window.routeStudioDesktop?.setTheme(theme);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [theme]);

  function changeTheme(next: Theme) {
    setTheme(next);
    try {
      localStorage.setItem(preferenceKey, next);
    } catch {
      // Saving preferences is optional; the current session still changes theme.
    }
  }
  return { theme, scheme, changeTheme };
}
