import en from './en.ui.json' with { type: 'json' };
import zh from './zh-CN.ui.json' with { type: 'json' };

export type Lang = 'en' | 'zh';
export type Copy = typeof en;
export const strings = { en, zh } satisfies Record<Lang, Copy>;

export type Localized = Record<Lang, string>;
export const both = (key: keyof Omit<Copy, 'fileErrors'>): Localized => ({
  en: strings.en[key],
  zh: strings.zh[key],
});

export function initialLanguage(): Lang {
  try {
    const saved = localStorage.getItem('route-studio-language');
    if (saved === 'en' || saved === 'zh') return saved;
  } catch {
    /* Browser preferences are optional. */
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
