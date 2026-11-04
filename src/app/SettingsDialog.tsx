import { Button, Checkbox, Flex, IconButton, Link, Tabs, Text, TextField } from '@radix-ui/themes';
import { Eye, EyeOff } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { BasemapPreferences, BasemapProvider } from '../maps/basemap';
import en from '../i18n/en.settings.json' with { type: 'json' };
import zh from '../i18n/zh-CN.settings.json' with { type: 'json' };
import { Choice } from './Choice';
import { Modal } from './Modal';
import { strings, type Lang } from './strings';
import type { Theme } from './theme';

export interface SettingsValues {
  lang: Lang;
  theme: Theme;
  basemap: BasemapPreferences;
}

export function SettingsDialog({
  lang,
  theme,
  basemap,
  initialTab,
  onApply,
  onClose,
}: SettingsValues & {
  initialTab: 'general' | 'map';
  onApply: (values: SettingsValues) => void;
  onClose: () => void;
}) {
  const t = strings[lang];
  const copy = { en, zh }[lang];
  const id = useId();
  const [tab, setTab] = useState(initialTab);
  const [draft, setDraft] = useState<SettingsValues>(() => ({ lang, theme, basemap: { ...basemap } }));
  const [showKey, setShowKey] = useState(false);
  const [missingKey, setMissingKey] = useState(false);
  const keyInput = useRef<HTMLInputElement>(null);
  const changeMap = (patch: Partial<BasemapPreferences>) => {
    setDraft((value) => ({ ...value, basemap: { ...value.basemap, ...patch } }));
    setMissingKey(false);
  };
  useEffect(() => {
    if (missingKey) keyInput.current?.focus();
  }, [missingKey, tab]);
  return (
    <Modal title={copy.title} maxWidth="480px" onClose={onClose}>
      <Flex asChild direction="column" gap="4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const map = { ...draft.basemap, tiandituKey: draft.basemap.tiandituKey.trim() };
            if (map.enabled && map.provider === 'tianditu' && !map.tiandituKey) {
              setTab('map');
              setMissingKey(true);
              return;
            }
            onApply({ ...draft, basemap: map });
          }}
        >
          <Tabs.Root value={tab} onValueChange={(value) => setTab(value as 'general' | 'map')}>
            <Tabs.List>
              <Tabs.Trigger value="general">{copy.general}</Tabs.Trigger>
              <Tabs.Trigger value="map">{copy.map}</Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="general">
              <Flex direction="column" gap="4" pt="4">
                <Flex direction="column" gap="1">
                  <Text as="label" size="2" htmlFor={`${id}-language`}>
                    {t.lang}
                  </Text>
                  <Choice
                    id={`${id}-language`}
                    value={draft.lang}
                    onValueChange={(value) => setDraft({ ...draft, lang: value as Lang })}
                    options={[
                      { value: 'en', label: strings.en.languageName },
                      { value: 'zh', label: strings.zh.languageName },
                    ]}
                  />
                </Flex>
                <Flex direction="column" gap="1">
                  <Text as="label" size="2" htmlFor={`${id}-theme`}>
                    {t.theme}
                  </Text>
                  <Choice
                    id={`${id}-theme`}
                    value={draft.theme}
                    onValueChange={(value) => setDraft({ ...draft, theme: value as Theme })}
                    options={[
                      { value: 'system', label: t.themeSystem },
                      { value: 'light', label: t.themeLight },
                      { value: 'dark', label: t.themeDark },
                    ]}
                  />
                </Flex>
              </Flex>
            </Tabs.Content>
            <Tabs.Content value="map">
              <Flex direction="column" gap="3" pt="4">
                <Flex direction="column" gap="1">
                  <Text as="label" size="2" htmlFor={`${id}-provider`}>
                    {t.basemapProvider}
                  </Text>
                  <Choice
                    id={`${id}-provider`}
                    value={draft.basemap.provider}
                    onValueChange={(value) => changeMap({ provider: value as BasemapProvider })}
                    options={[
                      { value: 'openfreemap', label: 'OpenFreeMap' },
                      { value: 'tianditu', label: t.tianditu },
                    ]}
                  />
                </Flex>
                {draft.basemap.provider === 'tianditu' && (
                  <Flex direction="column" gap="1">
                    <Text as="label" size="2" htmlFor={`${id}-key`}>
                      {t.basemapApiKey}
                    </Text>
                    <TextField.Root
                      id={`${id}-key`}
                      ref={keyInput}
                      type={showKey ? 'text' : 'password'}
                      autoComplete="off"
                      spellCheck={false}
                      autoCapitalize="none"
                      value={draft.basemap.tiandituKey}
                      aria-invalid={missingKey || undefined}
                      aria-describedby={missingKey ? `${id}-error` : undefined}
                      onChange={(event) => changeMap({ tiandituKey: event.target.value })}
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
                          {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                        </IconButton>
                      </TextField.Slot>
                    </TextField.Root>
                    {missingKey && (
                      <Text as="p" size="1" color="red" id={`${id}-error`} role="alert">
                        {t.basemapKeyRequired}
                      </Text>
                    )}
                    <Flex justify="between" align="center" gap="2" mt="1">
                      <Link
                        size="1"
                        href="https://console.tianditu.gov.cn/"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {t.basemapGetKey}
                      </Link>
                      {draft.basemap.tiandituKey && (
                        <Button
                          type="button"
                          size="1"
                          variant="surface"
                          color="gray"
                          onClick={() => changeMap({ tiandituKey: '' })}
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
                      checked={draft.basemap.enabled}
                      onCheckedChange={(checked) => changeMap({ enabled: checked === true })}
                    />
                    {t.basemapShow}
                  </Flex>
                </Text>
              </Flex>
            </Tabs.Content>
          </Tabs.Root>
          <Text as="p" size="1" color="gray">
            {t.basemapLocalSettings}
          </Text>
          <Flex justify="end" gap="2">
            <Button type="button" variant="soft" color="gray" onClick={onClose}>
              {t.cancel}
            </Button>
            <Button type="submit">{t.basemapApply}</Button>
          </Flex>
        </form>
      </Flex>
    </Modal>
  );
}
