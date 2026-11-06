import { Button, Callout, Flex, Spinner, Text } from '@radix-ui/themes';
import { useId, useLayoutEffect, useMemo, useState } from 'react';
import { distances, type RouteDocument } from '../../domain/model';
import {
  defaultResampleOptions,
  validResampleOptions,
  type ResampleErrorCode,
  type ResampleResult,
} from '../../domain/resample';
import type { BasemapPreferences } from '../../maps/basemap';
import { MapView } from '../../views/MapView';
import { Modal } from '../../ui/Modal';
import { NumberInput } from '../../ui/NumberInput';
import { runIO } from '../../workers/io';
import { strings, type Lang } from '../../i18n/index';
import type { ColorScheme } from '../../ui/theme';
import en from '../../i18n/en.resample.json';
import zh from '../../i18n/zh-CN.resample.json';
import './resample.css';

export const resampleStrings = { en, zh } satisfies Record<Lang, typeof en>;
const noop = () => {};

export function ResampleDialog({
  doc,
  lang,
  scheme,
  basemap,
  onClose,
  onApply,
}: {
  doc: RouteDocument;
  lang: Lang;
  scheme: ColorScheme;
  basemap: BasemapPreferences;
  onClose: () => void;
  onApply: (next: RouteDocument) => void;
}) {
  const copy = resampleStrings[lang];
  const id = useId();
  const [values, setValues] = useState({
    minSpacingM: String(defaultResampleOptions.minSpacingM),
    maxSpacingM: String(defaultResampleOptions.maxSpacingM),
    toleranceM: String(defaultResampleOptions.toleranceM),
  });
  const options = useMemo(
    () => ({
      minSpacingM: values.minSpacingM === '' ? NaN : Number(values.minSpacingM),
      maxSpacingM: values.maxSpacingM === '' ? NaN : Number(values.maxSpacingM),
      toleranceM: values.toleranceM === '' ? NaN : Number(values.toleranceM),
    }),
    [values],
  );
  const valid = validResampleOptions(options);
  const [result, setResult] = useState<ResampleResult | null>(null);
  const [error, setError] = useState<ResampleErrorCode | 'failed' | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [shortIndex, setShortIndex] = useState(0);
  const [focus, setFocus] = useState<{ index: number; nonce: number }>();
  const axis = useMemo(() => distances(doc.vertices), [doc]);
  useLayoutEffect(() => {
    setResult(null);
    setError(null);
    setShortIndex(0);
    setFocus(undefined);
    if (!valid) return;
    const request = new AbortController();
    const timer = window.setTimeout(() => {
      void runIO({ type: 'resample', doc, options }, request.signal)
        .then((response) => {
          if (request.signal.aborted) return;
          if (response.type === 'resampled') setResult(response.result);
          else setError(response.type === 'resample-error' ? response.code : 'failed');
        })
        .catch(() => {
          if (!request.signal.aborted) setError('failed');
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      request.abort();
    };
  }, [doc, options, valid, attempt]);
  const problem = !valid ? 'options' : error;
  const exception = result?.shortSegments[shortIndex];
  const comparison = useMemo(
    () =>
      result
        ? {
            vertices: result.document.vertices,
            shortSegments: result.shortSegments.map((segment) => segment.index),
            focus,
          }
        : undefined,
    [result, focus],
  );
  function locate(index: number) {
    const segment = result?.shortSegments[index];
    if (!segment) return;
    setShortIndex(index);
    setFocus((previous) => ({ index: segment.index, nonce: (previous?.nonce ?? 0) + 1 }));
  }
  return (
    <Modal title={copy.title} onClose={onClose} maxWidth="1000px" className="resample-dialog">
      <Flex direction="column" gap="3" className="resample-content">
        <Flex direction="column" gap="3" className="resample-body">
          <div className="resample-fields">
            {(['minSpacingM', 'maxSpacingM', 'toleranceM'] as const).map((key, i) => {
              const label = [copy.minSpacing, copy.maxSpacing, copy.tolerance][i];
              return (
                <div className="field" key={key}>
                  <label htmlFor={`${id}-${key}`}>{label}</label>
                  <NumberInput
                    id={`${id}-${key}`}
                    label={label}
                    aria-label={label}
                    unit="m"
                    aria-describedby={`${id}-help`}
                    aria-invalid={!valid || undefined}
                    min={0}
                    value={values[key]}
                    onChange={(event) => setValues({ ...values, [key]: event.target.value })}
                    onStep={(value) => setValues({ ...values, [key]: String(value) })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                    }}
                  />
                </div>
              );
            })}
          </div>
          <Text as="p" size="2" color="gray" id={`${id}-help`}>
            {copy.help}
          </Text>
          <div className="resample-map">
            <MapView
              doc={doc}
              lang={lang}
              scheme={scheme}
              basemap={basemap}
              axis={axis}
              readOnly
              comparison={comparison}
              tool="select"
              revealSelection={0}
              selectedVertexId={null}
              selectedStationId={null}
              storageFailed={false}
              onOpenSettings={noop}
              onSelectVertex={noop}
              onSelectStation={noop}
              onMoveVertex={noop}
              onAddVertex={noop}
              onPickAnchor={noop}
              onPickLocation={noop}
            />
          </div>
          <div className="resample-legend" aria-label={copy.title}>
            <span>
              <i className="resample-original" />
              {copy.original}
            </span>
            {result && (
              <span>
                <i className="resample-candidate" />
                {copy.preview}
              </span>
            )}
            {!!result?.shortSegments.length && (
              <span>
                <i className="resample-short" />
                {copy.short}
              </span>
            )}
          </div>
          <Text as="p" size="1" color="gray">
            {copy.mapHelp}
          </Text>
          {problem ? (
            <Callout.Root color="red" role="alert">
              <Callout.Text>{copy[problem]}</Callout.Text>
            </Callout.Root>
          ) : !result ? (
            <Flex gap="2" align="center" role="status">
              <Spinner />
              <Text size="2">{copy.reading}</Text>
            </Flex>
          ) : (
            <div role="status">
              <dl className="resample-stats">
                <div>
                  <dt>{copy.points}</dt>
                  <dd>
                    {doc.vertices.length.toLocaleString()} →{' '}
                    {result.document.vertices.length.toLocaleString()}
                  </dd>
                </div>
                <div>
                  <dt>{copy.length}</dt>
                  <dd>
                    {(result.originalLengthM / 1000).toFixed(3)} → {(result.lengthM / 1000).toFixed(3)} km{' '}
                    <small>({(result.lengthM - result.originalLengthM).toFixed(2)} m)</small>
                  </dd>
                </div>
                <div>
                  <dt>{copy.spacing}</dt>
                  <dd>
                    {result.minSpacingM.toFixed(2)}–{result.maxSpacingM.toFixed(2)} m
                  </dd>
                </div>
                <div>
                  <dt>{copy.deviation}</dt>
                  <dd>{result.maxDeviationM.toFixed(2)} m</dd>
                </div>
              </dl>
              <Text size="2" color="gray">
                {copy.coverage} ·{' '}
                {((1 - result.shortSegments.length / (result.document.vertices.length - 1)) * 100).toFixed(1)}
                %
              </Text>
            </div>
          )}
          {exception && result && (
            <Callout.Root color="orange">
              <div>
                <Callout.Text>
                  <strong>{copy.exceptions.replace('{count}', String(result.shortSegments.length))}</strong>
                </Callout.Text>
                <Callout.Text>
                  {copy.exceptionPosition
                    .replace('{current}', String(shortIndex + 1))
                    .replace('{total}', String(result.shortSegments.length))
                    .replace('{distance}', (exception.startM / 1000).toFixed(3))
                    .replace('{spacing}', exception.spacingM.toFixed(2))}{' '}
                  · {copy[exception.reason]}
                </Callout.Text>
                <Flex gap="2" wrap="wrap" mt="2">
                  <Button
                    size="1"
                    variant="soft"
                    color="gray"
                    disabled={shortIndex === 0}
                    onClick={() => locate(shortIndex - 1)}
                  >
                    {copy.previous}
                  </Button>
                  <Button size="1" variant="soft" color="gray" onClick={() => locate(shortIndex)}>
                    {copy.locate}
                  </Button>
                  <Button
                    size="1"
                    variant="soft"
                    color="gray"
                    disabled={shortIndex === result.shortSegments.length - 1}
                    onClick={() => locate(shortIndex + 1)}
                  >
                    {copy.next}
                  </Button>
                </Flex>
              </div>
            </Callout.Root>
          )}
        </Flex>
        <Flex gap="2" justify="end" className="resample-actions">
          <Button variant="soft" color="gray" onClick={onClose}>
            {strings[lang].cancel}
          </Button>
          {error === 'failed' && (
            <Button variant="surface" onClick={() => setAttempt((n) => n + 1)}>
              {copy.retry}
            </Button>
          )}
          <Button disabled={!valid || !result || !!error} onClick={() => result && onApply(result.document)}>
            {copy.apply}
          </Button>
        </Flex>
      </Flex>
    </Modal>
  );
}
