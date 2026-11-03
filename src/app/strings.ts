import en from '../i18n/en.ui.json' with { type: 'json' };
import zh from '../i18n/zh-CN.ui.json' with { type: 'json' };

export type Lang = 'en' | 'zh';
export type Copy = typeof en;
export const strings = { en, zh } satisfies Record<Lang, Copy>;

export function initialLanguage(): Lang {
  try {
    const saved = localStorage.getItem('route-studio-language');
    if (saved === 'en' || saved === 'zh') return saved;
  } catch {
    /* Browser preferences are optional. */
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
