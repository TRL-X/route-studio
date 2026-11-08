import { Button } from '@radix-ui/themes';
import { useEffect, useState } from 'react';
import type { Lang } from '../../i18n';
import type { DeviceControls } from './useDeviceRoutes';
import type { FirmwareControls } from './useFirmware';
import type { ConnectionControls } from './useDevices';
import { deviceStrings } from './deviceStrings';

type Task = 'routes' | 'firmware' | 'connection';
export function DeviceTaskStatus({
  device,
  firmware,
  connection,
  lang,
  onOpen,
}: {
  device: DeviceControls;
  firmware: FirmwareControls;
  connection: ConnectionControls;
  lang: Lang;
  onOpen: (task: Task) => void;
}) {
  const t = deviceStrings[lang];
  const route = device.state;
  const fw = firmware.state;
  const [recent, setRecent] = useState<Task | null>(null);
  const activeTask: Task | null =
    connection.state.task ??
    (fw.busy ? 'firmware' : route.busy ? 'routes' : connection.state.busy ? 'connection' : null);
  const [lastTask, setLastTask] = useState<Task | null>(null);
  useEffect(() => {
    if (activeTask) setLastTask(activeTask);
  }, [activeTask]);
  useEffect(() => {
    if (fw.error !== undefined) setLastTask('firmware');
  }, [fw.error]);
  useEffect(() => {
    if (route.error !== undefined) setLastTask('routes');
  }, [route.error]);
  useEffect(() => {
    if (connection.state.error !== undefined) setLastTask('connection');
  }, [connection.state.error]);
  useEffect(() => {
    if (route.completedId === undefined) {
      setRecent((current) => (current === 'routes' ? null : current));
      return;
    }
    setRecent('routes');
    const timer = window.setTimeout(
      () => setRecent((current) => (current === 'routes' ? null : current)),
      6000,
    );
    return () => window.clearTimeout(timer);
  }, [route.completedId]);
  useEffect(() => {
    if (fw.phase !== 'complete' && !(fw.phase === 'recovered' && fw.recoveryRestarted)) {
      setRecent((current) => (current === 'firmware' ? null : current));
      return;
    }
    setRecent('firmware');
    const timer = window.setTimeout(
      () => setRecent((current) => (current === 'firmware' ? null : current)),
      6000,
    );
    return () => window.clearTimeout(timer);
  }, [fw.phase, fw.recoveryRestarted]);
  const firmwareAttention =
    fw.error !== undefined ||
    fw.pending ||
    (fw.phase === 'recovered' && !fw.recoveryRestarted) ||
    fw.phase === 'reverted';
  const task: Task | null =
    activeTask ??
    (fw.pending
      ? 'firmware'
      : route.pending
        ? 'routes'
        : lastTask === 'firmware' && firmwareAttention
          ? 'firmware'
          : lastTask === 'routes' && route.error !== undefined
            ? 'routes'
            : lastTask === 'connection' && connection.state.error !== undefined
              ? 'connection'
              : recent);
  if (!task) return null;
  const error = task === 'firmware' ? fw.error : task === 'routes' ? route.error : connection.state.error;
  const active = task === 'firmware' ? fw.busy : task === 'routes' ? route.busy : connection.state.busy;
  const attention = task === 'firmware' ? firmwareAttention : task === 'routes' ? route.pending : false;
  const percent =
    task === 'firmware' && fw.busy === 'uploading'
      ? Math.floor((fw.off * 100) / Math.max(1, fw.image?.size ?? 0))
      : task === 'routes' && route.busy === 'uploading' && route.progress?.state === 'receiving'
        ? Math.floor((route.progress.off * 100) / Math.max(1, route.totalBytes))
        : undefined;
  const label =
    task === 'firmware'
      ? fw.mode === 'recovery'
        ? t.recoveryTask
        : t.firmwareTask
      : task === 'routes'
        ? t.routeTask
        : t.connectionTitle;
  const detail =
    error !== undefined
      ? t.taskAttention
      : percent !== undefined
        ? `${percent}%`
        : active
          ? t.taskActive
          : attention
            ? t.taskAttention
            : t.taskComplete;
  return (
    <Button
      className="device-task-status"
      size="1"
      variant="ghost"
      color={error !== undefined || (!active && attention) ? 'amber' : 'blue'}
      onClick={() => onOpen(task)}
      title={task === 'firmware' ? fw.filename : task === 'routes' ? route.progress?.name : undefined}
    >
      {label} · {detail}
    </Button>
  );
}
