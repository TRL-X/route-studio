import { formatMessage, msg, type RteText } from './messages';
export type RteTarget =
  { type: 'route' } | { type: 'sample'; index: number } | { type: 'station' | 'vertex'; id: string };

/** TRL-X-ROUTE-SPEC initial edition (2026-11-01), §§2, 7, 10. */
export class RteError extends Error {
  readonly messageZh: string;
  readonly code: 'invalid' | 'unsupported' | 'limit';
  readonly target?: RteTarget;
  constructor(message: RteText, code: RteError['code'] = 'invalid', target?: RteTarget) {
    super(formatMessage(message, 'en'));
    this.messageZh = formatMessage(message, 'zh');
    this.name = 'RteError';
    this.code = code;
    this.target = target;
  }
}

export function check(condition: unknown, message: RteText, target?: RteTarget): asserts condition {
  if (!condition) throw new RteError(message, 'invalid', target);
}

export function limit(condition: boolean, message: RteText) {
  if (!condition) throw new RteError(message, 'limit');
}

export const UINT = 4294967295;
export const INT_MIN = -2147483648;
export const INT_MAX = 2147483647;
export const LAT = 900000000;
export const LON = 1800000000;
export const MAX_NODES = 1_000_000;

export function integer(
  value: unknown,
  min: number,
  max: number,
  label: RteText,
  target?: RteTarget,
): number {
  check(
    typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max,
    msg('validation.integerRange', { label, min, max }),
    target,
  );
  return value;
}

export function named(value: unknown, maxBytes: number, label: RteText, target?: RteTarget): string {
  check(typeof value === 'string' && value.length > 0, msg('validation.requiredValue', { label }), target);
  // Unicode mode matches lone surrogates but leaves valid surrogate pairs intact.
  check(
    !/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value),
    msg('validation.invalidCharacters', { label }),
    target,
  );
  check(
    new TextEncoder().encode(value).length <= maxBytes,
    msg('validation.textLength', { label, maxBytes }),
    target,
  );
  return value;
}

export const quantize = (value: number) => Math.sign(value) * Math.floor(Math.abs(value) + 0.5);
