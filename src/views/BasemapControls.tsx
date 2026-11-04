import {
  Badge,
  Button,
  Callout,
  Checkbox,
  Flex,
  IconButton,
  Link,
  Popover,
  Text,
  TextField,
} from '@radix-ui/themes';
import { useId, useRef, useState } from 'react';
import { ChevronDown, Eye, EyeOff, Layers } from 'lucide-react';
import { Choice } from '../app/Choice';
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

  return (
    <div className="rv-basemap-tools">
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          if (next) {
            setDraft({ ...preferences });
            setShowKey(false);
            setMissingKey(false);
          }
          setOpen(next);
        }}
      >
        <Flex className="rv-basemap-bar" align="center" gap="2" wrap="wrap">
          <Popover.Trigger>
            <Button type="button" variant="surface" color="gray" className="rv-basemap-trigger">
              <Layers aria-hidden="true" />
              <span>
                {t.basemap}: {providerName}
                {!preferences.enabled ? ` · ${t.off}` : ''}
              </span>
              <ChevronDown aria-hidden="true" />
            </Button>
          </Popover.Trigger>
          {failure && (
            <Flex align="center" gap="2">
              <Badge color="amber" variant="solid" role="status">
                {t.basemapUnavailable}
              </Badge>
              {failure !== 'key' && (
                <Button type="button" size="1" variant="surface" color="gray" onClick={onRetry}>
                  {t.basemapRetry}
                </Button>
              )}
            </Flex>
          )}
        </Flex>
        <Popover.Content
          className="rv-basemap-panel"
          aria-label={t.basemapSettings}
          align="start"
          sideOffset={8}
          collisionPadding={12}
          width="320px"
          maxWidth="calc(100vw - 24px)"
          maxHeight="var(--radix-popover-content-available-height)"
        >
          <Flex direction="column" gap="3" asChild>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (draft.enabled && draft.provider === 'tianditu' && !draft.tiandituKey.trim()) {
                  setMissingKey(true);
                  keyInput.current?.focus();
                  return;
                }
                onApply({ ...draft, tiandituKey: draft.tiandituKey.trim() });
                setOpen(false);
              }}
            >
              <Flex direction="column" gap="1">
                <Text as="label" htmlFor={`${id}-provider`} size="2" weight="medium">
                  {t.basemapProvider}
                </Text>
                <Choice
                  id={`${id}-provider`}
                  value={draft.provider}
                  onValueChange={(value) => {
                    setDraft({ ...draft, provider: value as BasemapProvider });
                    setMissingKey(false);
                  }}
                  options={[
                    { value: 'openfreemap', label: 'OpenFreeMap' },
                    { value: 'tianditu', label: t.tianditu },
                  ]}
                />
              </Flex>
              {draft.provider === 'tianditu' && (
                <Flex direction="column" gap="1">
                  <Text as="label" htmlFor={`${id}-key`} size="2" weight="medium">
                    {t.basemapApiKey}
                  </Text>
                  <TextField.Root
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
                  >
                    <TextField.Slot side="right" pr="2">
                      <IconButton
                        size="1"
                        variant="ghost"
                        color="gray"
                        type="button"
                        aria-label={showKey ? t.basemapHideKey : t.basemapShowKey}
                        onClick={() => setShowKey(!showKey)}
                      >
                        {showKey ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                      </IconButton>
                    </TextField.Slot>
                  </TextField.Root>
                  {missingKey && (
                    <Text as="p" id={`${id}-error`} size="1" color="red" role="alert">
                      {t.basemapKeyRequired}
                    </Text>
                  )}
                  <Flex align="center" justify="between" gap="2" mt="1">
                    <Link
                      size="1"
                      href="https://console.tianditu.gov.cn/"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t.basemapGetKey}
                    </Link>
                    {draft.tiandituKey && (
                      <Button
                        size="1"
                        variant="surface"
                        color="gray"
                        type="button"
                        onClick={() => setDraft({ ...draft, tiandituKey: '' })}
                      >
                        {t.basemapClearKey}
                      </Button>
                    )}
                  </Flex>
                </Flex>
              )}
              <Text as="label" size="2">
                <Flex align="center" gap="2">
                  <Checkbox
                    checked={draft.enabled}
                    onCheckedChange={(checked) => {
                      setDraft({ ...draft, enabled: checked === true });
                      setMissingKey(false);
                    }}
                  />
                  {t.basemapShow}
                </Flex>
              </Text>
              {message && (
                <Text as="p" size="1" color="red">
                  {message}
                </Text>
              )}
              <Text as="p" size="1" color="gray">
                {t.basemapLocalSettings}
              </Text>
              <Flex justify="end" gap="2">
                <Popover.Close>
                  <Button type="button" variant="surface" color="gray">
                    {t.cancel}
                  </Button>
                </Popover.Close>
                <Button type="submit">{t.basemapApply}</Button>
              </Flex>
            </form>
          </Flex>
        </Popover.Content>
      </Popover.Root>
      {storageFailed && (
        <Callout.Root className="rv-basemap-warning" size="1" color="amber" role="status">
          <Callout.Text>{t.basemapStorageFailed}</Callout.Text>
        </Callout.Root>
      )}
    </div>
  );
}
