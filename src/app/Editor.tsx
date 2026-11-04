import {
  Checkbox,
  Button,
  IconButton,
  Theme,
  SegmentedControl,
  Card,
  Spinner,
  Callout,
} from '@radix-ui/themes';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
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
import { fillShortElevationGaps } from '../domain/elevation-repair';
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
import { TrackExportDialog } from './TrackExportDialog';
import type { ExportFormat } from '../files/export';
import { ExportDialog } from './ExportDialog';
import { defaultExportOptions } from '../rte/processing';
import { EditorToolbar } from './EditorToolbar';
import { RouteOutline } from './RouteOutline';
import { ProfilePanel } from './ProfilePanel';
import { ElevationRepair } from './ElevationRepair';
import { Inspector, type Selection, type Tool } from './Inspector';
import { useHistory } from './history';
import { runIO, type Choice as TrackChoice, type IOResult } from './io';
import { initialLanguage, strings, type Lang } from './strings';
import './editor.css';
import { saveFile } from './saveFile';
import { DesktopBluetooth } from './DesktopBluetooth';
import { useTheme } from './theme';
import { Choice } from './Choice';
import { Modal } from './Modal';

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
function filename(name: string) {
  return (
    name
      .trim()
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .slice(0, 100) || 'route'
  );
}
function fileError(result: Extract<IOResult, { type: 'error' }>): Localized {
  const key = result.fileCode;
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
  list: TrackChoice[];
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
  const { theme, scheme, changeTheme } = useTheme();
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
  const [exportFormat, setExportFormat] = useState<ExportFormat | null>(null);
  const [exportOptions, setExportOptions] = useState(defaultExportOptions);
  const [exportName, setExportName] = useState<string | null>(null);
  const [hoveredSample, setHoveredSample] = useState<number | null>(null);
  const [mapProbeDistance, setMapProbeDistance] = useState<number | null>(null);
  const [panel, setPanel] = useState<'outline' | 'inspector' | null>(null);
  const [busy, setBusy] = useState(false);
  const [savingFile, setSavingFile] = useState(false);
  const [fileSaveError, setFileSaveError] = useState<Localized | null>(null);
  const saveLock = useRef(false);
  const [pending, setPending] = useState<Replacement | null>(null);
  const [choices, setChoices] = useState<ImportChoice | null>(null);
  const [elevationPreview, setElevationPreview] = useState<{ summary?: Localized } | null>(null);
  const locked = busy || savingFile || !!pending || !!choices || !!exportFormat || !!elevationPreview;
  const [draftState, setDraftState] = useState<'auto' | 'saving' | 'saved' | 'saveFailed'>(
    recoveryError ? 'saveFailed' : 'auto',
  );
  const autosave = useRef(!!restored);
  const ioLock = useRef(false);
  const status = (msg: string) => setNotice({ en: msg, zh: msg });
  const dirty = doc !== savedDoc;
  useEffect(() => {
    window.routeStudioDesktop?.setDocumentState(dirty, lang);
  }, [dirty, lang]);
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
    if (missingHeights === doc.elevation.length) {
      setElevationPreview({});
      return;
    }
    try {
      const { document, filled, remaining } = fillShortElevationGaps(doc);
      if (filled) change(document);
      const message = (language: Lang) =>
        strings[language].interpolationResult
          .replace('{filled}', String(filled))
          .replace('{remaining}', String(remaining.length));
      const summary = { en: message('en'), zh: message('zh') };
      setNotice(summary);
      if (remaining.length) setElevationPreview({ summary });
    } catch {
      setProblem(both('terrainLimit'));
    }
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
    setExportFormat(null);
    setElevationPreview(null);
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
  const exportControls = {
    lang,
    name: exportName ?? filename(doc.name),
    onName: setExportName,
    onClose: () => {
      setExportFormat(null);
      setFileSaveError(null);
    },
    saving: savingFile,
    saveError: fileSaveError?.[lang],
    onDownload: async (bytes: Uint8Array<ArrayBuffer>, name: string) => {
      if (!exportFormat || saveLock.current) return;
      saveLock.current = true;
      setSavingFile(true);
      setFileSaveError(null);
      const types = {
        rte: 'application/octet-stream',
        fit: 'application/octet-stream',
        gpx: 'application/gpx+xml',
        kml: 'application/vnd.google-earth.kml+xml',
      };
      try {
        if (!(await saveFile(bytes, filename(name) + '.' + exportFormat, types[exportFormat]))) return;
        setExportFormat(null);
        const key = window.routeStudioDesktop ? 'desktopFormatDone' : 'formatDone';
        setNotice({
          en: strings.en[key].replace('{format}', exportFormat.toUpperCase()),
          zh: strings.zh[key].replace('{format}', exportFormat.toUpperCase()),
        });
      } catch {
        setFileSaveError(both('fileSaveFailed'));
      } finally {
        saveLock.current = false;
        setSavingFile(false);
      }
    },
  };
  async function save() {
    if (saveLock.current) return;
    saveLock.current = true;
    setSavingFile(true);
    try {
      if (!(await saveFile(saveProject(doc), filename(doc.name) + '.routeproj', 'application/json'))) return;
      setSavedDoc(doc);
      setNotice(both(window.routeStudioDesktop ? 'desktopProjectDone' : 'projectDone'));
    } catch {
      setProblem(both('fileSaveFailed'));
    } finally {
      saveLock.current = false;
      setSavingFile(false);
    }
  }
  async function pickDesktopFile() {
    try {
      const file = await window.routeStudioDesktop!.openFile();
      if (file) await openFile(new File([file.bytes], file.name));
    } catch {
      setProblem(both('readFailed'));
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
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        (event.target instanceof Element &&
          event.target.closest('[role="dialog"], [role="menu"], [role="listbox"]'))
      )
        return;
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
    <Theme
      appearance={scheme}
      accentColor="blue"
      grayColor="gray"
      className="studio"
      data-desktop={window.routeStudioDesktop?.platform}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f && !locked) void openFile(f);
      }}
    >
      <div className="shell" inert={locked}>
        <EditorToolbar
          title={doc.name || t.untitled}
          theme={theme}
          onTheme={changeTheme}
          lang={lang}
          onLanguage={setLang}
          locked={locked}
          canUndo={history.past.length > 0}
          canRedo={history.future.length > 0}
          onHistory={historyAction}
          onNew={() => requestReplace({ doc: emptyRoute(), source: '' })}
          onExample={() => requestReplace({ doc: exampleRoute(), source: '', sample: true })}
          onOpen={openFile}
          onPickFile={window.routeStudioDesktop ? () => void pickDesktopFile() : undefined}
          onSave={save}
          onExport={(format) => {
            setProblem(null);
            setExportFormat(format);
          }}
        />
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
              <Button
                variant={panel === 'outline' ? 'soft' : 'ghost'}
                aria-pressed={panel === 'outline'}
                onClick={() => setPanel(panel === 'outline' ? null : 'outline')}
              >
                <Layers size={14} />
                {t.outline}
              </Button>
              <span className="selection-summary">
                {selectionTitle}
                {focusedMeters != null &&
                  Number.isFinite(focusedMeters) &&
                  ' · ' + (focusedMeters / 1000).toFixed(2) + ' km'}
              </span>
              <Button
                variant={panel === 'inspector' ? 'soft' : 'ghost'}
                aria-pressed={panel === 'inspector'}
                onClick={() => setPanel(panel === 'inspector' ? null : 'inspector')}
              >
                <PanelsTopLeft size={14} />
                {panel === 'inspector' ? t.close : t.editSelection}
              </Button>
            </div>
            <section className="map-area">
              <div className="map-tools">
                <span className="pane-title">
                  <MapIcon size={15} />
                  {t.routeMap}
                </span>
                <SegmentedControl.Root
                  className="tools"
                  size="1"
                  value={tool}
                  aria-label={t.tools}
                  onValueChange={(value) => {
                    if (value === 'insert' && doc.vertices.length < 2) return;
                    setNotice(null);
                    setTool(value as Tool);
                  }}
                >
                  {(
                    [
                      ['select', MousePointer2, t.select],
                      ['append', Plus, t.append],
                      ['insert', Waypoints, t.insert],
                    ] as const
                  ).map(([k, Icon, label]) => (
                    <SegmentedControl.Item
                      key={k}
                      value={k}
                      title={label}
                      aria-disabled={k === 'insert' && doc.vertices.length < 2}
                    >
                      <span className="tool-label">
                        <Icon size={14} />
                        {label}
                      </span>
                    </SegmentedControl.Item>
                  ))}
                </SegmentedControl.Root>
                <div className="course-totals" aria-label={t.info}>
                  <span title={t.total}>
                    {length.toFixed(2)} <small>km</small>
                  </span>
                  <span title={t.gain}>
                    ↑ {gainText} <small>m</small>
                  </span>
                </div>
              </div>
              <div className="map-frame">
                <MapView
                  key={session}
                  doc={doc}
                  lang={lang}
                  scheme={scheme}
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
                  <Card className="empty-overlay" size="3">
                    <PanelsTopLeft size={25} />
                    <h2>{t.empty}</h2>
                    <p>{t.emptyHelp}</p>
                    <Button onClick={() => setTool('append')}>
                      <Plus />
                      {t.append}
                    </Button>
                  </Card>
                )}
              </div>
            </section>
            <ProfilePanel
              t={t}
              count={doc.elevation.length}
              canFill={
                !!doc.vertices.length &&
                (missingHeights > 0 ||
                  doc.elevation.length === 0 ||
                  (doc.vertices.length > 1 && gain === null))
              }
              canFetch={doc.vertices.length > 0}
              onFill={fillElevationGaps}
              onFetch={() => setElevationPreview({})}
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
          <Callout.Root className="problem" color="red" role="alert">
            <Callout.Icon>
              <ShieldCheck size={20} />
            </Callout.Icon>
            <Callout.Text>{problem[lang]}</Callout.Text>
            <IconButton
              variant="ghost"
              color="gray"

              aria-label={t.close}
              onClick={() => setProblem(null)}
            >
              <X />
            </IconButton>
          </Callout.Root>
        )}
      </div>
      {exportFormat === 'rte' && (
        <ExportDialog
          doc={doc}
          {...exportControls}
          dispatch={dispatch}
          change={change}
          projectGain={gain}
          options={exportOptions}
          onOptions={setExportOptions}
          onLocate={(error) => {
            setExportFormat(null);
            setIssue(error);
            select(error.target ?? { type: 'route' }, true);
          }}
        />
      )}
      {exportFormat && exportFormat !== 'rte' && (
        <TrackExportDialog doc={doc} format={exportFormat} {...exportControls} />
      )}
      {elevationPreview && (
        <ElevationRepair
          doc={doc}
          lang={lang}
          initialSummary={elevationPreview.summary?.[lang]}
          onApply={(next) => {
            change(next);
            setNotice(both('elevationsReplaced'));
            setElevationPreview(null);
          }}
          onClose={() => setElevationPreview(null)}
        />
      )}
      {busy && (
        <div className="overlay">
          <Card>
            <div className="processing" role="status">
              <Spinner />
              {t.busy}
            </div>
          </Card>
        </div>
      )}
      {pending && (
        <Modal className="dialog" title={t.discardTitle} onClose={() => setPending(null)}>
          <p>{t.replace}</p>
          <div className="dialog-actions">
            <Button
              variant="surface"
              color="gray"

              autoFocus
              onClick={() => setPending(null)}
            >
              {t.cancel}
            </Button>
            <Button variant="solid" color="blue" onClick={() => replace(pending)}>
              {t.confirm}
            </Button>
          </div>
        </Modal>
      )}
      <DesktopBluetooth lang={lang} />
      {choices && (
        <Modal className="dialog" title={t.selectTrack} onClose={() => setChoices(null)}>
          <Choice
            autoFocus
            aria-label={t.route}
            value={choices.index}
            onValueChange={(value) => setChoices({ ...choices, index: Number(value), accept: true })}
            options={[
              ...choices.list.map((item, i) => ({
                value: i,
                label: (
                  <>
                    {item.name} · {item.pointCount} {t.vertices}
                  </>
                ),
              })),
            ]}
          />
          {choices.list[choices.index].hasUnconfirmedHeights && (
            <>
              <p>{t.unconfirmed}</p>
              <label className="check-field">
                <Checkbox
                  checked={choices.accept}
                  onCheckedChange={(value) => setChoices({ ...choices, accept: value === true })}
                />
                {t.acceptHeights}
              </label>
            </>
          )}
          <div className="dialog-actions">
            <Button variant="surface" color="gray" onClick={() => setChoices(null)}>
              {t.cancel}
            </Button>
            <Button
              variant="solid"
              color="blue"

              onClick={() => void openFile(choices.file, choices.index, choices.accept)}
            >
              <Check />
              {t.open}
            </Button>
          </div>
        </Modal>
      )}
    </Theme>
  );
}
