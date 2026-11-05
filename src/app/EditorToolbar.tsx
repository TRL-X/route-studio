import { Button, IconButton, DropdownMenu } from '@radix-ui/themes';
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { Bluetooth, BluetoothOff, ArrowDownToLine, Menu, Redo2, Save, Settings, Undo2 } from 'lucide-react';
import type { DeviceSnapshot } from '../device/session';
import { deviceStrings } from './deviceStrings';
import type { Lang } from './strings';
import {
  commandDefinitions,
  commandGroups,
  commandIds,
  commandShortcut,
  commandStrings,
  type CommandId,
  type EditorCommands,
} from './commands';

interface ToolbarProps {
  title: string;
  lang: Lang;
  locked: boolean;
  commands: EditorCommands;
  device: DeviceSnapshot;
}

function editingText() {
  const element = document.activeElement;
  return (
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLInputElement &&
      !['checkbox', 'radio', 'button', 'submit'].includes(element.type)) ||
    (element instanceof HTMLElement && element.isContentEditable)
  );
}

export function EditorToolbar({ title, lang, locked, commands, device }: ToolbarProps) {
  const t = commandStrings[lang];
  const deviceCopy = deviceStrings[lang];
  const deviceLabel = (
    device.busy === 'connecting'
      ? deviceCopy.toolbarConnecting
      : device.busy === 'uploading'
        ? deviceCopy.toolbarSending
        : device.pending
          ? deviceCopy.toolbarPaused
          : device.connected
            ? deviceCopy.toolbarConnected
            : deviceCopy.toolbarDisconnected
  ).replace('{name}', device.deviceName);

  const desktop = window.routeStudioDesktop;
  const [zoom, setZoom] = useState(() => desktop?.getZoomFactor() ?? 1);
  const [windowControlsVisible, setWindowControlsVisible] = useState(true);
  const [menu, setMenu] = useState(false);
  const [textEditing, setTextEditing] = useState(false);
  const menuTriggerId = useId();
  const restoreMenuFocus = useRef(true);
  const latest = useRef({ commands, locked });
  latest.current = { commands, locked };
  const mac = /Mac/.test(navigator.platform);

  function execute(id: CommandId, native = false) {
    if (native && (id === 'undo' || id === 'redo') && editingText()) {
      document.execCommand(id);
      return;
    }
    if (latest.current.locked) return;
    if (latest.current.commands[id].disabled) return;
    setMenu(false);
    if (editingText()) {
      const field = document.activeElement as HTMLElement;
      field.blur();
      // A field's blur commits its draft before the command reads the latest document.
      queueMicrotask(() => {
        if (!latest.current.locked && !latest.current.commands[id].disabled) {
          if (field.isConnected) field.focus({ preventScroll: true });
          latest.current.commands[id].run();
        }
      });
    } else latest.current.commands[id].run();
  }

  useEffect(() => {
    if (!desktop) return;
    const overlay = navigator.windowControlsOverlay;
    const update = () => {
      setWindowControlsVisible(overlay?.visible ?? true);
      setZoom(desktop.getZoomFactor());
    };
    update();
    overlay?.addEventListener('geometrychange', update);
    window.addEventListener('resize', update);
    return () => {
      overlay?.removeEventListener('geometrychange', update);
      window.removeEventListener('resize', update);
    };
  }, [desktop]);
  useEffect(() => {
    if (locked) setMenu(false);
  }, [locked]);
  useEffect(() => {
    const update = () => queueMicrotask(() => setTextEditing(editingText()));
    const focus = (event: FocusEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target !== document.body &&
        target.id !== menuTriggerId &&
        target.closest('[data-focus-return]')?.getAttribute('data-focus-return') !== menuTriggerId
      ) {
        // Menu exit animations may outlast the next edit, including its Enter-to-blur commit.
        restoreMenuFocus.current = false;
      }
      update();
    };
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', update);
    return () => {
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', update);
    };
  }, [menuTriggerId]);
  const enabled = Object.fromEntries(
    commandIds.map((id) => [
      id,
      (textEditing && (id === 'undo' || id === 'redo')) || (!locked && !commands[id].disabled),
    ]),
  );
  const commandState = JSON.stringify({ language: lang, enabled });
  useEffect(() => {
    desktop?.setCommandState(JSON.parse(commandState));
  }, [desktop, commandState]);
  useEffect(() => desktop?.onCommand((id) => execute(id, true)), [desktop]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        latest.current.locked ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey
      )
        return;
      const key = event.key.toLowerCase();
      let command = commandDefinitions.find(({ accelerator }) => {
        const parts = accelerator?.toLowerCase().split('+');
        return parts?.at(-1) === key && parts.includes('shift') === event.shiftKey;
      })?.id;
      if (!mac && key === 'y' && !event.shiftKey) command = 'redo';
      if (!command || ((command === 'undo' || command === 'redo') && editingText())) return;
      event.preventDefault();
      execute(command);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mac]);

  return (
    <>
      {desktop && <div aria-hidden="true" style={{ height: 48 / zoom }} />}
      <header
        className="topbar"
        data-window-controls={desktop ? (windowControlsVisible ? 'visible' : 'hidden') : undefined}
        style={desktop ? ({ '--titlebar-scale': 1 / zoom } as CSSProperties) : undefined}
      >
        <div className="brand" role="img" aria-label="Route Studio">
          <span className="brand-mark" aria-hidden="true" />
        </div>
        <div className="file-menu">
          <DropdownMenu.Root
            open={menu}
            onOpenChange={(open) => {
              if (open) restoreMenuFocus.current = true;
              setMenu(open);
            }}
          >
            <DropdownMenu.Trigger>
              <Button id={menuTriggerId} variant="ghost" color="gray" aria-label={t.menu}>
                <Menu />
                {t.menu}
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content
              loop
              aria-label={t.menu}
              data-focus-return={menuTriggerId}
              onCloseAutoFocus={(event) => {
                if (!restoreMenuFocus.current || document.querySelector('[role="dialog"]'))
                  event.preventDefault();
              }}
            >
              {commandGroups.map((group) => (
                <DropdownMenu.Sub key={group}>
                  <DropdownMenu.SubTrigger>{t[group]}</DropdownMenu.SubTrigger>
                  <DropdownMenu.SubContent data-focus-return={menuTriggerId}>
                    {commandDefinitions
                      .filter((command) => command.group === group)
                      .map(({ id, accelerator }) => (
                        <DropdownMenu.Item
                          key={id}
                          aria-label={t[id]}
                          disabled={locked || commands[id].disabled}
                          shortcut={commandShortcut(accelerator, mac)}
                          onSelect={() => execute(id)}
                        >
                          {t[id]}
                        </DropdownMenu.Item>
                      ))}
                  </DropdownMenu.SubContent>
                </DropdownMenu.Sub>
              ))}
              <DropdownMenu.Separator />
              <DropdownMenu.Item
                aria-label={t.deviceRoutes}
                disabled={locked || commands.deviceRoutes.disabled}
                onSelect={() => execute('deviceRoutes')}
              >
                {t.deviceRoutes}
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
              {desktop && (
                <DropdownMenu.Item disabled={locked} onSelect={() => execute('checkUpdates')}>
                  {t.checkUpdates}
                </DropdownMenu.Item>
              )}
              <DropdownMenu.Item
                aria-label={t.settings}
                shortcut={mac ? '⌘,' : 'Ctrl+,'}
                disabled={locked || commands.settings.disabled}
                onSelect={() => execute('settings')}
              >
                <Settings size={15} />
                {t.settings}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>
        <div className="history-tools">
          <IconButton
            variant="ghost"
            color="gray"
            title={t.undo}
            aria-label={t.undo}
            disabled={locked || commands.undo.disabled}
            onClick={() => execute('undo')}
          >
            <Undo2 />
          </IconButton>
          <IconButton
            variant="ghost"
            color="gray"
            title={t.redo}
            aria-label={t.redo}
            disabled={locked || commands.redo.disabled}
            onClick={() => execute('redo')}
          >
            <Redo2 />
          </IconButton>
        </div>
        <div className="titlebar-drag-space">
          <h1 title={title}>{title}</h1>
        </div>
        <div className="top-actions">
          <IconButton
            variant="ghost"
            color={device.connected ? 'blue' : 'gray'}
            className="device-status-button"
            aria-label={deviceLabel}
            title={deviceLabel}
            aria-haspopup="dialog"
            disabled={locked}
            onClick={() => execute('deviceRoutes')}
          >
            {device.connected ? <Bluetooth /> : <BluetoothOff />}
          </IconButton>
          <Button
            variant="surface"
            color="gray"
            className="file-action"
            aria-label={t.save}
            title={t.save}
            disabled={locked || commands.save.disabled}
            onClick={() => execute('save')}
          >
            <Save />
            <span>{t.save}</span>
          </Button>
          <Button
            aria-haspopup="dialog"
            disabled={locked || commands.export.disabled}
            onClick={() => execute('export')}
          >
            <ArrowDownToLine />
            {t.export}
          </Button>
          <IconButton
            variant="ghost"
            color="gray"
            aria-label={t.settings}
            title={t.settings}
            disabled={locked || commands.settings.disabled}
            onClick={() => execute('settings')}
          >
            <Settings />
          </IconButton>
        </div>
      </header>
    </>
  );
}
