import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Check,
  Layers,
  Map as MapIcon,
  MousePointer2,
  PanelsTopLeft,
  Plus,
  ShieldCheck,
  Waypoints,
  X,
} from 'lucide-react';
import { appendVertex, insertVertex, moveVertex, updateStation } from '../domain/edit';
import { interpolateMissingHeights } from '../domain/elevation';
import {
  anchorDistance,
  distances,
  emptyRoute,
  newId,
  type Anchor,
  type RouteDocument,
} from '../domain/model';
import { ascent } from '../domain/summary';
import { exampleRoute } from '../domain/example';
import { saveDraft, saveProject } from '../files';
import { MapView } from '../views/MapView';
import { ProfileView } from '../views/ProfileView';
import { ExportDialog } from './ExportDialog';
import { defaultExportOptions } from '../rte/processing';
import { EditorToolbar } from './EditorToolbar';
import { RouteOutline } from './RouteOutline';
import { ProfilePanel } from './ProfilePanel';
import { Inspector, type Selection, type Tool } from './Inspector';
import { useHistory } from './history';
import { runIO, type Choice, type IOResult } from './io';
import { initialLanguage, strings, type Lang } from './strings';
import './editor.css';

type Localized = { en: string; zh: string };
type Problem = Localized & { target?: Selection };
function sameTarget(a: Selection, b?: Selection) {
  if (a.type === 'route') return b?.type === 'route';
  if (a.type === 'sample') return b?.type === 'sample' && a.index === b.index;
  return a.type === b?.type && a.id === b.id;
}
const both = (key: keyof Omit<(typeof strings)['en'], 'fileErrors'>): Localized => ({
  en: strings.en[key],
  zh: strings.zh[key],
});
function download(content: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function filename(name: string) {
  return (
    name
      .trim()
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .slice(0, 100) || 'route'
  );
}
function fileError(result: Extract<IOResult, { type: 'error' }>): Localized {
  const key = result.fileCode as keyof typeof strings.en.fileErrors | undefined;
  return key && Object.hasOwn(strings.en.fileErrors, key)
    ? { en: strings.en.fileErrors[key], zh: strings.zh.fileErrors[key] }
    : result;
}
interface Replacement {
  doc: RouteDocument;
  source: string;
  sample?: boolean;
}
interface ImportChoice {
  list: Choice[];
  file: File;
  index: number;
  accept: boolean;
}

export function Editor({
  restored,
  recoveryError,
}: {
  restored: RouteDocument | null;
  recoveryError: boolean;
}) {
  const [history, dispatch] = useHistory(() => restored ?? exampleRoute());
  const { doc } = history;
  const [lang, setLang] = useState<Lang>(initialLanguage);
  const t = strings[lang];
  const [selected, choose] = useState<Selection>({ type: 'route' });
  const [revealSelection, setRevealSelection] = useState(0);
  const [tool, setTool] = useState<Tool>('select');
  const [example, setExample] = useState(!restored);
  const [source, setSource] = useState('');
  const [session, setSession] = useState(0);
  const [savedDoc, setSavedDoc] = useState(doc);
  const [notice, setNotice] = useState<Localized | null>(restored ? both('recovery') : null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [issue, setIssue] = useState<Problem | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportOptions, setExportOptions] = useState(defaultExportOptions);
  const [exportName, setExportName] = useState<string | null>(null);
  const [hoveredSample, setHoveredSample] = useState<number | null>(null);
  const [mapProbeDistance, setMapProbeDistance] = useState<number | null>(null);
  const [panel, setPanel] = useState<'outline' | 'inspector' | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Replacement | null>(null);
  const [choices, setChoices] = useState<ImportChoice | null>(null);
  const [draftState, setDraftState] = useState<'auto' | 'saving' | 'saved' | 'saveFailed'>(
    recoveryError ? 'saveFailed' : 'auto',
  );
  const autosave = useRef(!!restored);
  const ioLock = useRef(false);
  const status = (msg: string) => setNotice({ en: msg, zh: msg });
  const dirty = doc !== savedDoc;
  const change = (next: RouteDocument) => {
    if (next === doc) return;
    autosave.current = true;
    setIssue(null);
    setHoveredSample(null);
    setProblem(null);
    setNotice(null);
    dispatch({ type: 'edit', doc: next });
  };
  const axis = useMemo(() => distances(doc.vertices), [doc.vertices]);
  const length = (axis.at(-1) ?? 0) / 1000;
  const gain = useMemo(() => ascent(doc), [doc.vertices, doc.elevation]);
  const gainText = gain === null ? '—' : gain.toFixed(0);
  const missingHeights = useMemo(
    () => doc.elevation.filter((s) => s.height === null).length,
    [doc.elevation],
  );
  function fillElevationGaps() {
    const { document, filled, remaining } = interpolateMissingHeights(doc);
    if (filled) change(document);
    const message = (lang: Lang) => {
      const copy = strings[lang];
      const summary = copy.interpolationResult
        .replace('{filled}', String(filled))
        .replace('{remaining}', String(remaining));
      return remaining ? summary + ' ' + copy.interpolationLimit : summary;
    };
    setNotice({ en: message('en'), zh: message('zh') });
  }
  const activeStation =
    selected.type === 'station' ? doc.stations.find((s) => s.id === selected.id) : undefined;
  const focus = useMemo(
    () =>
      selected.type === 'station'
        ? activeStation?.anchor
        : selected.type === 'vertex'
          ? { vertexId: selected.id, fraction: 0 }
          : selected.type === 'sample'
            ? doc.elevation[selected.index]?.anchor
            : null,
    [selected, activeStation, doc.elevation],
  );
  const focusedMeters = useMemo(() => (focus ? anchorDistance(doc, focus, axis) : null), [axis, focus]);
  let selectionTitle = t.details;
  if (activeStation) selectionTitle = activeStation.name || t[activeStation.kind];
  if (selected.type === 'sample') selectionTitle = t.sample + ' ' + (selected.index + 1);
  if (selected.type === 'vertex') selectionTitle = t.vertex;
  const select = (s: Selection, inspect = false) => {
    choose(s);
    setNotice(null);
    setRevealSelection((n) => n + 1);
    setTool('select');
    setPanel(inspect ? 'inspector' : null);
  };
  function historyAction(type: 'undo' | 'redo') {
    const next = type === 'undo' ? history.past.at(-1) : history.future[0];
    if (!next) return;
    if (
      (selected.type === 'station' && !next.stations.some((s) => s.id === selected.id)) ||
      (selected.type === 'vertex' && !next.vertices.some((v) => v.id === selected.id)) ||
      (selected.type === 'sample' && !next.elevation[selected.index])
    ) {
      choose({ type: 'route' });
      setPanel(null);
    }
    setTool('select');
    setIssue(null);
    setHoveredSample(null);
    setProblem(null);
    setNotice(null);
    dispatch({ type });
  }
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    try {
      localStorage.setItem('route-studio-language', lang);
    } catch {
      /* optional */
    }
  }, [lang]);
  // Publish the pending status before the newly edited document is painted.
  useLayoutEffect(() => {
    if (!autosave.current) return;
    let active = true;
    setDraftState('saving');
    saveDraft(doc)
      .then(() => {
        if (active) setDraftState('saved');
      })
      .catch(() => {
        if (active) setDraftState('saveFailed');
      });
    return () => {
      active = false;
    };
  }, [doc]);
  function replace(next: Replacement) {
    setExportOptions(defaultExportOptions);
    setExportName(null);
    setExportOpen(false);
    setExample(!!next.sample);
    setIssue(null);
    setHoveredSample(null);
    setMapProbeDistance(null);
    setSession((v) => v + 1);
    setSource(next.source);
    autosave.current = true;
    dispatch({ type: 'replace', doc: next.doc });
    setSavedDoc(next.doc);
    select({ type: 'route' });
    setPanel(null);
    setPending(null);
    setProblem(null);
    setNotice(both('loaded'));
  }
  function requestReplace(next: Replacement) {
    if (dirty) setPending(next);
    else replace(next);
  }
  async function openFile(file: File, index?: number, accept?: boolean) {
    if (ioLock.current) return;
    ioLock.current = true;
    setBusy(true);
    setChoices(null);
    try {
      const result = await runIO({ type: 'read', file, choice: index, accept });
      if (result.type === 'error') setProblem(fileError(result));
      else if (result.type === 'choices') setChoices({ file, list: result.choices, index: 0, accept: true });
      else if (result.type === 'document') requestReplace({ doc: result.doc, source: file.name });
    } catch {
      setProblem(both('readFailed'));
    } finally {
      setBusy(false);
      ioLock.current = false;
    }
  }
  function save() {
    try {
      download(saveProject(doc), filename(doc.name) + '.routeproj', 'application/json');
      setSavedDoc(doc);
      setNotice(both('projectDone'));
    } catch {
      setProblem(both('saveFailed'));
    }
  }
  function addStation() {
    if (doc.vertices.length < 2) {
      setNotice(both('noVertices'));
      return;
    }
    setPanel(null);
    setTool('newStation');
    setNotice(null);
  }
  function pickAnchor(a: Anchor) {
    if (tool === 'insert') {
      const next = insertVertex(doc, a);
      if (next === doc) {
        setNotice(both('invalidInsert'));
        return;
      }
      const i = doc.vertices.findIndex((vertex) => vertex.id === a.vertexId);
      change(next);
      select({ type: 'vertex', id: next.vertices[i + 1].id });
    } else if (tool === 'newStation') {
      const id = newId();
      change({
        ...doc,
        stations: [...doc.stations, { id, name: t.newStation, kind: 'cp', boundary: false, anchor: a }],
      });
      select({ type: 'station', id });
      setNotice(both('stationAdded'));
    } else if (tool === 'stationAnchor' && activeStation) {
      change(updateStation(doc, activeStation.id, { anchor: a }));
      select({ type: 'station', id: activeStation.id });
    }
  }
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || (event.target instanceof Element && event.target.closest('dialog')))
        return;
      setPending(null);
      setChoices(null);
      setPanel(null);
      setTool('select');
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, []);
  const toolHelp = {
    select: t.editing,
    append: t.drawing,
    insert: t.inserting,
    newStation: t.placing,
    stationAnchor: t.placing,
    stationLocation: t.locating,
  }[tool];
  return (
    <div
      className="studio"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f && !busy && !pending && !choices && !exportOpen) void openFile(f);
      }}
    >
      <div className="shell" inert={busy || !!pending || !!choices}>
        <EditorToolbar
          lang={lang}
          onLanguage={setLang}
          locked={busy || !!pending || !!choices || exportOpen}
          canUndo={history.past.length > 0}
          canRedo={history.future.length > 0}
          onHistory={historyAction}
          onNew={() => requestReplace({ doc: emptyRoute(), source: '' })}
          onExample={() => requestReplace({ doc: exampleRoute(), source: '', sample: true })}
          onOpen={openFile}
          onSave={save}
          onExport={() => {
            setProblem(null);
            setExportOpen(true);
          }}
        />
        <div className="document-bar">
          <h1 title={doc.name || t.untitled}>{doc.name || t.untitled}</h1>
          <div className="course-totals">
            <div>
              <span>{t.total}</span>
              <b>
                {length.toFixed(2)} <small>km</small>
              </b>
            </div>
            <div>
              <span>{t.gain}</span>
              <b>
                {gainText} <small>m</small>
              </b>
            </div>
          </div>
        </div>
        <div className="workspace" data-panel={panel ?? ''}>
          <RouteOutline
            key={session}
            doc={doc}
            axis={axis}
            selected={selected}
            example={example}
            source={source}
            t={t}
            onSelect={select}
            onAddStation={addStation}
          />
          <main className="canvas">
            <div className="compact-panels">
              <button
                aria-pressed={panel === 'outline'}
                onClick={() => setPanel(panel === 'outline' ? null : 'outline')}
              >
                <Layers size={14} />
                {t.outline}
              </button>
              <span className="selection-summary">
                {selectionTitle}
                {focusedMeters != null &&
                  Number.isFinite(focusedMeters) &&
                  ' · ' + (focusedMeters / 1000).toFixed(2) + ' km'}
              </span>
              <button
                aria-pressed={panel === 'inspector'}
                onClick={() => setPanel(panel === 'inspector' ? null : 'inspector')}
              >
                <PanelsTopLeft size={14} />
                {panel === 'inspector' ? t.close : t.editSelection}
              </button>
            </div>
            <section className="map-area">
              <div className="map-tools">
                <span className="pane-title">
                  <MapIcon size={15} />
                  {t.routeMap}
                </span>
                <div className="tools" aria-label={t.tools}>
                  {(
                    [
                      ['select', MousePointer2, t.select],
                      ['append', Plus, t.append],
                      ['insert', Waypoints, t.insert],
                    ] as const
                  ).map(([k, Icon, label]) => (
                    <button
                      key={k}
                      className={tool === k ? 'on' : ''}
                      aria-pressed={tool === k}
                      title={label}
                      disabled={k === 'insert' && doc.vertices.length < 2}
                      onClick={() => {
                        setNotice(null);
                        setTool(k);
                      }}
                    >
                      <Icon size={14} />
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="map-frame">
                <MapView
                  key={session}
                  doc={doc}
                  lang={lang}
                  tool={tool}
                  axis={axis}
                  revealSelection={revealSelection}
                  onCancelTool={() => setTool('select')}
                  selectedVertexId={selected.type === 'vertex' ? selected.id : null}
                  selectedStationId={activeStation?.id ?? null}
                  focusAnchor={selected.type === 'sample' ? focus : null}
                  profileHoverAnchor={hoveredSample === null ? null : doc.elevation[hoveredSample]?.anchor}
                  onProbeDistance={setMapProbeDistance}
                  onSelectVertex={(id) => select({ type: 'vertex', id })}
                  onSelectStation={(id) => select({ type: 'station', id })}
                  onMoveVertex={(id, p) => change(moveVertex(doc, id, p))}
                  onAddVertex={(p) => {
                    const next = appendVertex(doc, p);
                    change(next);
                    choose({ type: 'vertex', id: next.vertices.at(-1)!.id });
                  }}
                  onPickAnchor={pickAnchor}
                  onPickLocation={(p) => {
                    if (activeStation) {
                      change(updateStation(doc, activeStation.id, { location: p }));
                      select({ type: 'station', id: activeStation.id });
                    }
                  }}
                />
                {!doc.vertices.length && tool !== 'append' && (
                  <div className="empty-overlay">
                    <PanelsTopLeft size={25} />
                    <h2>{t.empty}</h2>
                    <p>{t.emptyHelp}</p>
                    <button className="primary" onClick={() => setTool('append')}>
                      <Plus />
                      {t.append}
                    </button>
                  </div>
                )}
              </div>
            </section>
            <ProfilePanel
              t={t}
              count={doc.elevation.length}
              missing={missingHeights}
              onFill={fillElevationGaps}
            >
              <ProfileView
                doc={doc}
                lang={lang}
                selectedSampleIndex={selected.type === 'sample' ? selected.index : null}
                focusAnchor={focus}
                onSelectSample={(index) => select({ type: 'sample', index })}
                onHoverSample={setHoveredSample}
                hoveredSampleIndex={hoveredSample}
                mapProbeDistance={mapProbeDistance}
              />
            </ProfilePanel>
          </main>
          <Inspector
            doc={doc}
            t={t}
            selected={selected}
            choose={(s) => select(s, true)}
            issue={sameTarget(selected, issue?.target) ? issue?.[lang] : undefined}
            change={change}
            setTool={(mode) => {
              setPanel(null);
              setNotice(null);
              setTool(mode);
            }}
            status={status}
          />
        </div>
        <footer className="statusbar">
          <span className="status-dot" />
          <span className="status-copy" role="status">
            {notice ? notice[lang] : toolHelp}
          </span>
          <span className={draftState === 'saveFailed' ? 'save-error' : 'draft-status'}>{t[draftState]}</span>
          <span className="coord-system">WGS 84</span>
        </footer>
        {problem && (
          <div className="problem" data-severity="error" role="alert">
            <ShieldCheck size={20} />
            <div>
              <strong>{t.file}</strong>
              <p>{problem[lang]}</p>
            </div>
            <button className="icon" aria-label={t.close} onClick={() => setProblem(null)}>
              <X />
            </button>
          </div>
        )}
      </div>
      {exportOpen && (
        <ExportDialog
          doc={doc}
          lang={lang}
          dispatch={dispatch}
          change={change}
          projectGain={gain}
          options={exportOptions}
          onOptions={setExportOptions}
          name={exportName ?? filename(doc.name)}
          onName={setExportName}
          onClose={() => setExportOpen(false)}
          onDownload={(bytes, name) => {
            download(bytes, filename(name) + '.rte', 'application/octet-stream');
            setExportOpen(false);
            setNotice(both('done'));
          }}
          onLocate={(error) => {
            setExportOpen(false);
            setIssue(error);
            select(error.target ?? { type: 'route' }, true);
          }}
        />
      )}
      {busy && (
        <div className="overlay">
          <div className="processing" role="status">
            <Activity size={18} />
            {t.busy}
          </div>
        </div>
      )}
      {pending && (
        <div className="overlay">
          <section className="dialog" role="dialog" aria-modal="true" aria-label={t.discardTitle}>
            <h2>{t.discardTitle}</h2>
            <p>{t.replace}</p>
            <div className="dialog-actions">
              <button className="button" autoFocus onClick={() => setPending(null)}>
                {t.cancel}
              </button>
              <button className="primary" onClick={() => replace(pending)}>
                {t.confirm}
              </button>
            </div>
          </section>
        </div>
      )}
      {choices && (
        <div className="overlay">
          <section className="dialog" role="dialog" aria-modal="true" aria-label={t.selectTrack}>
            <span className="eyebrow">{t.openFile}</span>
            <h2>{t.selectTrack}</h2>
            <select
              autoFocus
              aria-label={t.route}
              value={choices.index}
              onChange={(e) => setChoices({ ...choices, index: Number(e.target.value), accept: true })}
            >
              {choices.list.map((item, i) => (
                <option key={i} value={i}>
                  {item.name} · {item.pointCount} {t.vertices}
                </option>
              ))}
            </select>
            {choices.list[choices.index].hasUnconfirmedHeights && (
              <>
                <p>{t.unconfirmed}</p>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={choices.accept}
                    onChange={(e) => setChoices({ ...choices, accept: e.target.checked })}
                  />
                  {t.acceptHeights}
                </label>
              </>
            )}
            <div className="dialog-actions">
              <button className="button" onClick={() => setChoices(null)}>
                {t.cancel}
              </button>
              <button
                className="primary"
                onClick={() => void openFile(choices.file, choices.index, choices.accept)}
              >
                <Check />
                {t.open}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
