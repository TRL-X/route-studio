import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ChevronDown,
  FilePlus2,
  FolderOpen,
  Globe2,
  Mountain,
  Redo2,
  Save,
  Undo2,
} from 'lucide-react';
import type { ExportFormat } from '../files/export';
import { strings, type Lang } from './strings';

interface ToolbarProps {
  lang: Lang;
  onLanguage: (lang: Lang) => void;
  locked: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onHistory: (action: 'undo' | 'redo') => void;
  onNew: () => void;
  onExample: () => void;
  onOpen: (file: File) => void;
  onSave: () => void;
  onExport: (format: ExportFormat) => void;
}

function BrandMark() {
  return (
    <svg viewBox="0 0 34 34" width="33" height="33" aria-hidden="true">
      <rect width="34" height="34" rx="7" fill="#16745a" />
      <path
        d="m5 24 9-16 7 12 4-6 6 10M14 8l.5 10 6 2"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.1"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
export function EditorToolbar({
  lang,
  onLanguage,
  locked,
  canUndo,
  canRedo,
  onHistory,
  onNew,
  onExample,
  onOpen,
  onSave,
  onExport,
}: ToolbarProps) {
  const t = strings[lang];
  const [menu, setMenu] = useState<'file' | 'export' | null>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const pickFile = () => {
    setMenu(null);
    picker.current?.click();
  };

  useEffect(() => {
    if (locked) setMenu(null);
  }, [locked]);

  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      const ref = menu === 'file' ? menuRef : exportRef;
      if (!ref.current?.contains(event.target as Node)) setMenu(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menu]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenu(null);
        return;
      }
      if (locked || !(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'o') {
        event.preventDefault();
        pickFile();
      } else if (key === 's') {
        event.preventDefault();
        (document.activeElement as HTMLElement)?.blur();
        // Field blur commits the edit. Click the rendered save action after React has updated.
        queueMicrotask(() => saveButton.current?.click());
      } else if (key === 'z' || key === 'y') {
        const target = event.target;
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement
        )
          return;
        event.preventDefault();
        onHistory(key === 'y' || event.shiftKey ? 'redo' : 'undo');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <BrandMark />
          <span>Route Studio</span>
        </div>
        <div className="file-menu" ref={menuRef}>
          <button
            className="quiet"
            aria-expanded={menu === 'file'}
            onClick={() => setMenu(menu === 'file' ? null : 'file')}
          >
            {t.file}
            <ChevronDown size={13} />
          </button>
          {menu === 'file' && (
            <div className="dropdown" onClick={() => setMenu(null)}>
              <button onClick={onNew}>
                <FilePlus2 />
                {t.new}
              </button>
              <button onClick={pickFile}>
                <FolderOpen />
                {t.openFile}
              </button>
              <button onClick={onExample}>
                <Mountain />
                {t.example}
              </button>
              <hr />
              <button onClick={onSave}>
                <Save />
                {t.save}
              </button>
            </div>
          )}
        </div>
        <div className="history-tools">
          <button
            className="icon"
            title={t.undo + ' (⌘/Ctrl Z)'}
            aria-label={t.undo}
            disabled={!canUndo}
            onClick={() => onHistory('undo')}
          >
            <Undo2 />
          </button>
          <button
            className="icon"
            title={t.redo + ' (⌘/Ctrl Shift Z)'}
            aria-label={t.redo}
            disabled={!canRedo}
            onClick={() => onHistory('redo')}
          >
            <Redo2 />
          </button>
        </div>
        <div className="top-actions">
          <label className="language">
            <Globe2 size={16} />
            <select aria-label={t.lang} value={lang} onChange={(e) => onLanguage(e.target.value as Lang)}>
              <option value="en">{strings.en.languageName}</option>
              <option value="zh">{strings.zh.languageName}</option>
            </select>
          </label>
          <button className="button" aria-label={t.open} title={t.open} onClick={pickFile}>
            <FolderOpen />
            <span>{t.open}</span>
          </button>
          <button
            className="button"
            aria-label={t.save}
            title={t.save}
            ref={saveButton}
            onClick={() => {
              setMenu(null);
              onSave();
            }}
          >
            <Save />
            <span>{t.save}</span>
          </button>
          <div className="export-actions" ref={exportRef}>
            <button className="primary" onClick={() => onExport('rte')} aria-haspopup="dialog">
              <ArrowDownToLine />
              {t.export}
            </button>
            <button
              className="primary export-formats"
              aria-label={t.exportFormat}
              title={t.exportFormat}
              aria-expanded={menu === 'export'}
              onClick={() => setMenu(menu === 'export' ? null : 'export')}
            >
              <ChevronDown size={14} />
            </button>
            {menu === 'export' && (
              <div className="dropdown">
                {(['rte', 'gpx', 'kml', 'fit'] as const).map((format) => (
                  <button
                    key={format}
                    aria-haspopup="dialog"
                    onClick={() => {
                      setMenu(null);
                      onExport(format);
                    }}
                  >
                    {t.exportFormatTitle.replace('{format}', format.toUpperCase())}…
                  </button>
                ))}
              </div>
            )}
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
