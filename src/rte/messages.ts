import { english } from '../i18n/en-US.rte';
import chinese from '../i18n/zh-CN.rte.json' with { type: 'json' };

type MessageKey = keyof typeof english;
type Language = 'en' | 'zh';
const catalogs = { en: english, zh: chinese } satisfies Record<Language, Record<MessageKey, string>>;

interface RteMessage {
  key: MessageKey;
  values?: Record<string, number | RteText>;
}

// Format names like META and GIDX can be passed directly in either language.
export type RteText = string | RteMessage;
type Tokens<S extends string> = S extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Tokens<Rest>
  : never;

/** Keep validation on large node arrays cheap by formatting only when a check fails. */
export function msg<K extends MessageKey>(
  key: K,
  ...args: [Tokens<(typeof english)[K]>] extends [never]
    ? []
    : [values: Record<Tokens<(typeof english)[K]>, number | RteText>]
): RteMessage {
  return { key, values: args[0] };
}

export function formatMessage(text: RteText, language: Language): string {
  if (typeof text === 'string') return text;
  const template = catalogs[language][text.key];
  if (!text.values) return template;
  const values = text.values;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = values[name];
    return typeof value === 'number' ? String(value) : formatMessage(value, language);
  });
}
