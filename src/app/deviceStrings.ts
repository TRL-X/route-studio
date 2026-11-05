import { DeviceError } from '../device/mcumgr';
import type { Lang } from './strings';
import en from '../i18n/en.device.json';
import zh from '../i18n/zh-CN.device.json';

export const deviceStrings = { en, zh } satisfies Record<Lang, typeof en>;
export function deviceError(error: unknown, lang: Lang) {
  const t = deviceStrings[lang];
  if (!(error instanceof DeviceError))
    return t.failed.replace('{error}', error instanceof Error ? error.message : String(error));
  if (error.kind !== 'device') return t[error.kind];
  const routeErrors = [
    t.deviceError,
    t.deviceError,
    t.notFound,
    t.exists,
    t.inUseError,
    t.noSpace,
    t.limit,
    t.incomplete,
    t.invalidRoute,
    t.unsupportedFormat,
    t.expired,
    t.stale,
    t.busy,
    t.storage,
    t.cancelled,
    t.argument,
  ];
  return ((error.group === 64 && routeErrors[error.rc]) || t.deviceError)
    .replace('{group}', String(error.group))
    .replace('{code}', String(error.rc));
}
