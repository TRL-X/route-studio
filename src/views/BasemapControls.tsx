import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Eye, EyeOff, Layers } from 'lucide-react';
import { strings, type Lang } from '../app/strings';
import type { BasemapFailure, BasemapPreferences, BasemapProvider } from '../maps/basemap';

export function BasemapControls({
  lang,
  preferences,
  failure,
  storageFailed,
  onApply,
  onRetry,
}: {
  lang: Lang;
  preferences: BasemapPreferences;
  failure: BasemapFailure | 'key' | null;
  storageFailed: boolean;
  onApply: (preferences: BasemapPreferences) => void;
  onRetry: () => void;
}) {
  const t = strings[lang];
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(preferences);
  const [showKey, setShowKey] = useState(false);
  const [missingKey, setMissingKey] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const provider = useRef<HTMLSelectElement>(null);
  const keyInput = useRef<HTMLInputElement>(null);
  const id = useId();
  const providerName = preferences.provider === 'tianditu' ? t.tianditu : 'OpenFreeMap';
  const message = failure
    ? {
        key: t.basemapKeyRequired,
        unavailable: t.basemapLoadFailed,
        access: t.basemapAccessDenied,
        quota: t.basemapQuotaExceeded,
        graphics: t.basemapGraphicsUnavailable,
        timeout: t.basemapTimedOut,
      }[failure]
    : null;

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    provider.current?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!host.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  return (
    <div
      className="rv-basemap-tools"
      ref={host}
      onKeyDown={(event) => {
        if (!open) return;
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          close();
        }
      }}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <div className="rv-basemap-bar">
        <button
          type="button"
          className="rv-basemap-trigger"
          ref={trigger}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={() => {
            if (open) close();
            else {
              setDraft({ ...preferences });
              setShowKey(false);
              setMissingKey(false);
              setOpen(true);
            }
          }}
        >
          <Layers aria-hidden="true" />
          <span>
            {t.basemap}: {providerName}
            {!preferences.enabled ? ` · ${t.off}` : ''}
          </span>
          <ChevronDown aria-hidden="true" />
        </button>
        {failure && (
          <div className="rv-basemap-status">
            <span role="status">{t.basemapUnavailable}</span>
            {failure !== 'key' && (
              <button type="button" onClick={onRetry}>
                {t.basemapRetry}
              </button>
            )}
          </div>
        )}
      </div>
      {storageFailed && (
        <p className="rv-basemap-warning" role="status">
          {t.basemapStorageFailed}
        </p>
      )}
      {open && (
        <form
          id={id}
          className="rv-basemap-panel"
          role="dialog"
          aria-label={t.basemapSettings}
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.enabled && draft.provider === 'tianditu' && !draft.tiandituKey.trim()) {
              setMissingKey(true);
              keyInput.current?.focus();
              return;
            }
            onApply({ ...draft, tiandituKey: draft.tiandituKey.trim() });
            close();
          }}
        >
          <label className="rv-basemap-field">
            {t.basemapProvider}
            <select
              ref={provider}
              value={draft.provider}
              onChange={(event) => {
                setDraft({ ...draft, provider: event.target.value as BasemapProvider });
                setMissingKey(false);
              }}
            >
              <option value="openfreemap">OpenFreeMap</option>
              <option value="tianditu">{t.tianditu}</option>
            </select>
          </label>
          {draft.provider === 'tianditu' && (
            <div className="rv-basemap-field">
              <label htmlFor={`${id}-key`}>{t.basemapApiKey}</label>
              <div className="rv-basemap-key">
                <input
                  id={`${id}-key`}
                  ref={keyInput}
                  type={showKey ? 'text' : 'password'}
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="none"
                  value={draft.tiandituKey}
                  aria-invalid={missingKey || undefined}
                  aria-describedby={missingKey ? `${id}-error` : undefined}
                  onChange={(event) => {
                    setDraft({ ...draft, tiandituKey: event.target.value });
                    setMissingKey(false);
                  }}
                />
                <button
                  type="button"
                  aria-label={showKey ? t.basemapHideKey : t.basemapShowKey}
                  onClick={() => setShowKey(!showKey)}
                >
                  {showKey ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                </button>
              </div>
              {missingKey && (
                <p id={`${id}-error`} className="rv-basemap-error" role="alert">
                  {t.basemapKeyRequired}
                </p>
              )}
              <div className="rv-basemap-key-actions">
                <a href="https://console.tianditu.gov.cn/" target="_blank" rel="noopener noreferrer">
                  {t.basemapGetKey}
                </a>
                {draft.tiandituKey && (
                  <button type="button" onClick={() => setDraft({ ...draft, tiandituKey: '' })}>
                    {t.basemapClearKey}
                  </button>
                )}
              </div>
            </div>
          )}
          <label className="rv-basemap-toggle">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => {
                setDraft({ ...draft, enabled: event.target.checked });
                setMissingKey(false);
              }}
            />
            {t.basemapShow}
          </label>
          {message && <p className="rv-basemap-error">{message}</p>}
          <p className="rv-basemap-note">{t.basemapLocalSettings}</p>
          <div className="rv-basemap-actions">
            <button type="button" onClick={close}>
              {t.cancel}
            </button>
            <button type="submit">{t.basemapApply}</button>
          </div>
        </form>
      )}
    </div>
  );
}
