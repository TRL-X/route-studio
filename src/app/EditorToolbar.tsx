import { Button, IconButton, DropdownMenu } from '@radix-ui/themes';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowDownToLine,
  FilePlus2,
  FolderOpen,
  Globe2,
  Mountain,
  Monitor,
  Moon,
  Sun,
  Redo2,
  Save,
  Undo2,
} from 'lucide-react';
import type { ExportFormat } from '../files/export';
import { strings, type Lang } from './strings';
import type { Theme } from './theme';
import { Choice } from './Choice';

interface ToolbarProps {
  title: string;
  theme: Theme;
  onTheme: (theme: Theme) => void;
  lang: Lang;
  onLanguage: (lang: Lang) => void;
  locked: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onHistory: (action: 'undo' | 'redo') => void;
  onNew: () => void;
  onExample: () => void;
  onOpen: (file: File) => void;
  onPickFile?: () => void;
  onSave: () => void;
  onExport: (format: ExportFormat) => void;
}

export function EditorToolbar({
  title,
  theme,
  onTheme,
  lang,
  onLanguage,
  locked,
  canUndo,
  canRedo,
  onHistory,
  onNew,
  onExample,
  onOpen,
  onPickFile,
  onSave,
  onExport,
}: ToolbarProps) {
  const t = strings[lang];
  const desktop = window.routeStudioDesktop;
  const [zoom, setZoom] = useState(() => desktop?.getZoomFactor() ?? 1);
  const [windowControlsVisible, setWindowControlsVisible] = useState(true);
  const [menu, setMenu] = useState<'file' | 'export' | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const shortcut = /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl+';
  const pickFile = () => {
    setMenu(null);
    if (onPickFile) onPickFile();
    else picker.current?.click();
  };
  const returnFocus = (event: Event) => {
    // A command may have opened a dialog; let its focus scope take over.
    if (document.querySelector('[role="dialog"]')) event.preventDefault();
  };
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
    if (locked) setMenu(null);
  }, [locked]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || locked || !(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'o') {
        event.preventDefault();
        pickFile();
      } else if (key === 's') {
        event.preventDefault();
        (document.activeElement as HTMLElement)?.blur();
        queueMicrotask(() => saveButton.current?.click());
      } else if (key === 'z' || key === 'y') {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
        event.preventDefault();
        onHistory(key === 'y' || event.shiftKey ? 'redo' : 'undo');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
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
          <DropdownMenu.Root open={menu === 'file'} onOpenChange={(open) => setMenu(open ? 'file' : null)}>
            <DropdownMenu.Trigger>
              <Button variant="ghost" m="0" color="gray">
                {t.file}
                <DropdownMenu.TriggerIcon />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content loop aria-label={t.file} onCloseAutoFocus={returnFocus}>
              <DropdownMenu.Item onSelect={onNew}>
                <FilePlus2 size={15} />
                {t.new}
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={pickFile} shortcut={shortcut + 'O'}>
                <FolderOpen size={15} />
                {t.openFile}
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={onExample}>
                <Mountain size={15} />
                {t.example}
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
              <DropdownMenu.Item aria-label={t.save} onSelect={onSave} shortcut={shortcut + 'S'}>
                <Save size={15} />
                {t.save}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>
        <div className="history-tools">
          <IconButton
            variant="ghost"
            m="0"
            color="gray"
            title={t.undo + ' (⌘/Ctrl Z)'}
            aria-label={t.undo}
            disabled={!canUndo}
            onClick={() => onHistory('undo')}
          >
            <Undo2 />
          </IconButton>
          <IconButton
            variant="ghost"
            m="0"
            color="gray"
            title={t.redo + ' (⌘/Ctrl Shift Z)'}
            aria-label={t.redo}
            disabled={!canRedo}
            onClick={() => onHistory('redo')}
          >
            <Redo2 />
          </IconButton>
        </div>
        <div className="titlebar-drag-space">
          <h1 title={title}>{title}</h1>
        </div>
        <div className="top-actions">
          <label className="theme-picker" title={t.theme}>
            {theme === 'system' ? <Monitor /> : theme === 'dark' ? <Moon /> : <Sun />}
            <Choice
              variant="ghost"
              m="0"
              aria-label={t.theme}
              value={theme}
              onValueChange={(v) => onTheme(v as Theme)}
              options={[
                { value: 'system', label: t.themeSystem },
                { value: 'light', label: t.themeLight },
                { value: 'dark', label: t.themeDark },
              ]}
            />
          </label>
          <label className="language">
            <Globe2 size={16} />
            <Choice
              variant="ghost"
              m="0"
              aria-label={t.lang}
              value={lang}
              onValueChange={(v) => onLanguage(v as Lang)}
              options={[
                { value: 'en', label: strings.en.languageName },
                { value: 'zh', label: strings.zh.languageName },
              ]}
            />
          </label>
          <Button
            variant="surface"
            color="gray"
            className="file-action"
            aria-label={t.open}
            title={t.open}
            onClick={pickFile}
          >
            <FolderOpen />
            <span>{t.open}</span>
          </Button>
          <Button
            variant="surface"
            color="gray"
            className="file-action"
            aria-label={t.save}
            title={t.save}
            ref={saveButton}
            onClick={onSave}
          >
            <Save />
            <span>{t.save}</span>
          </Button>
          <div className="export-actions">
            <Button onClick={() => onExport('rte')} aria-haspopup="dialog">
              <ArrowDownToLine />
              {t.export}
            </Button>
            <DropdownMenu.Root
              open={menu === 'export'}
              onOpenChange={(open) => setMenu(open ? 'export' : null)}
            >
              <DropdownMenu.Trigger>
                <IconButton className="export-formats" aria-label={t.exportFormat} title={t.exportFormat}>
                  <DropdownMenu.TriggerIcon />
                </IconButton>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end" aria-label={t.exportFormat} onCloseAutoFocus={returnFocus}>
                {(['rte', 'gpx', 'kml', 'fit'] as const).map((format) => (
                  <DropdownMenu.Item key={format} onSelect={() => onExport(format)}>
                    {t.exportFormatTitle.replace('{format}', format.toUpperCase())}…
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </div>
        </div>
      </header>
      <input
        ref={picker}
        type="file"
        aria-label={t.openFile}
        hidden
        accept=".fit,.gpx,.kml,.rte,.routeproj"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onOpen(f);
        }}
      />
    </>
  );
}
