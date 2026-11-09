import { Button, IconButton, DropdownMenu } from '@radix-ui/themes';
import { Fragment, useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { ArrowDownToLine, CircleArrowUp, Menu, Redo2, Save, Settings, Undo2 } from 'lucide-react';
import type { Lang } from '../../i18n/index';
import { RouteTitle } from './RouteTitle';
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
  onRename: (name: string) => void;
  lang: Lang;
  locked: boolean;
  commands: EditorCommands;
  update?: { label: string; onOpen: () => void };
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

export function EditorToolbar({ title, onRename, lang, locked, commands, update }: ToolbarProps) {
  const t = commandStrings[lang];

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
  const checked = Object.fromEntries(
    commandIds.filter((id) => commands[id].checked !== undefined).map((id) => [id, commands[id].checked]),
  );
  const commandState = JSON.stringify({ language: lang, enabled, checked });
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
                <Fragment key={group}>
                  {group === 'device' && <DropdownMenu.Separator />}
                  <DropdownMenu.Sub>
                    <DropdownMenu.SubTrigger>{t[group]}</DropdownMenu.SubTrigger>
                    <DropdownMenu.SubContent data-focus-return={menuTriggerId}>
                      {commandDefinitions
                        .filter((command) => command.group === group)
                        .map(({ id, accelerator, separatorBefore, type }) => (
                          <Fragment key={id}>
                            {separatorBefore && <DropdownMenu.Separator />}
                            {type === 'checkbox' ? (
                              <DropdownMenu.CheckboxItem
                                aria-label={t[id]}
                                disabled={locked || commands[id].disabled}
                                checked={commands[id].checked ?? false}
                                onSelect={() => execute(id)}
                              >
                                {t[id]}
                              </DropdownMenu.CheckboxItem>
                            ) : (
                              <DropdownMenu.Item
                                aria-label={t[id]}
                                disabled={locked || commands[id].disabled}
                                shortcut={commandShortcut(accelerator, mac)}
                                onSelect={() => execute(id)}
                              >
                                {t[id]}
                              </DropdownMenu.Item>
                            )}
                          </Fragment>
                        ))}
                    </DropdownMenu.SubContent>
                  </DropdownMenu.Sub>
                </Fragment>
              ))}
              <DropdownMenu.Separator />
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
          <RouteTitle name={title} lang={lang} locked={locked} onRename={onRename} />
        </div>
        <div className="top-actions">
          {update && (
            <IconButton
              variant="soft"
              color="green"
              title={update.label}
              aria-label={update.label}
              aria-haspopup="dialog"
              disabled={locked}
              onClick={update.onOpen}
            >
              <CircleArrowUp aria-hidden="true" />
            </IconButton>
          )}
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
        </div>
      </header>
    </>
  );
}
