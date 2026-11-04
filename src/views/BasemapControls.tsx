import { Badge, Button, Callout, Flex, Tooltip } from '@radix-ui/themes';
import { Layers } from 'lucide-react';
import { strings, type Lang } from '../app/strings';
import type { BasemapFailure, BasemapPreferences } from '../maps/basemap';

export function BasemapControls({
  lang,
  preferences,
  failure,
  storageFailed,
  onOpenSettings,
  onRetry,
}: {
  lang: Lang;
  preferences: BasemapPreferences;
  failure: BasemapFailure | 'key' | null;
  storageFailed: boolean;
  onOpenSettings: () => void;
  onRetry: () => void;
}) {
  const t = strings[lang];
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
      <Flex className="rv-basemap-bar" align="center" gap="2" wrap="wrap">
        <Button
          type="button"
          variant="surface"
          color="gray"
          className="rv-basemap-trigger"
          aria-haspopup="dialog"
          onClick={onOpenSettings}
        >
          <Layers aria-hidden="true" />
          <span>
            {t.basemap}: {providerName}
            {!preferences.enabled ? ` · ${t.off}` : ''}
          </span>
        </Button>
        {message && (
          <Flex align="center" gap="2">
            <Tooltip content={message}>
              <Badge color="amber" role="status" aria-description={message}>
                {t.basemapUnavailable}
              </Badge>
            </Tooltip>
            {failure !== 'key' && (
              <Button type="button" size="1" variant="surface" color="gray" onClick={onRetry}>
                {t.basemapRetry}
              </Button>
            )}
          </Flex>
        )}
      </Flex>
      {storageFailed && (
        <Callout.Root className="rv-basemap-warning" size="1" color="amber" role="status">
          <Callout.Text>{t.basemapStorageFailed}</Callout.Text>
        </Callout.Root>
      )}
    </div>
  );
}
