import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Check,
  ChevronsUp,
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
import { distances, emptyRoute, newId, type Anchor, type RouteDocument } from '../domain/model';
import { ascent } from '../domain/summary';
import { exampleRoute } from '../domain/example';
import { saveDraft, saveProject } from '../files';
import { MapView } from '../views/MapView';
import { ProfileView } from '../views/ProfileView';
import { EditorToolbar } from './EditorToolbar';
import { RouteOutline } from './RouteOutline';
import { Inspector, type Selection, type Tool } from './Inspector';
import { useHistory } from './history';
import { runIO, type Choice, type IOResult } from './io';
import { initialLanguage, strings, type Lang } from './strings';
import './editor.css';

type Localized = { en: string; zh: string };
type Problem = Localized & { target?: Selection };
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
  const [tool, setTool] = useState<Tool>('select');
  const [example, setExample] = useState(!restored);
  const [source, setSource] = useState('');
  const [session, setSession] = useState(0);
  const [savedDoc, setSavedDoc] = useState(doc);
  const [notice, setNotice] = useState<Localized | null>(restored ? both('recovery') : null);
  const [problem, setProblem] = useState<Problem | null>(null);
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
    setProblem(null);
    setNotice(null);
    dispatch({ type: 'edit', doc: next });
  };
  const axis = useMemo(() => distances(doc.vertices), [doc.vertices]);
  const length = (axis.at(-1) ?? 0) / 1000;
  const gain = useMemo(() => ascent(doc), [doc.vertices, doc.elevation]);
  const gainText = gain === null ? '—' : gain.toFixed(0);
  const activeStation =
    selected.type === 'station' ? doc.stations.find((s) => s.id === selected.id) : undefined;
  const focus =
    selected.type === 'station'
      ? activeStation?.anchor
      : selected.type === 'vertex'
        ? { vertexId: selected.id, fraction: 0 }
        : selected.type === 'sample'
          ? doc.elevation[selected.index]?.anchor
          : null;
  const select = (s: Selection) => {
    choose(s);
    setTool('select');
    setPanel('inspector');
  };
  function historyAction(type: 'undo' | 'redo') {
    setTool('select');
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
    setExample(!!next.sample);
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
      else if (result.type === 'choices') setChoices({ file, list: result.choices, index: 0, accept: false });
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
  async function compile(write: boolean) {
    if (ioLock.current) return;
    ioLock.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const result = await runIO({ type: 'compile', doc });
      if (result.type === 'error') setProblem({ ...fileError(result), target: result.target });
      else if (result.type === 'binary') {
        if (write) download(result.bytes, filename(doc.name) + '.rte', 'application/octet-stream');
        setNotice(both(write ? 'done' : 'valid'));
      }
    } catch {
      setProblem(both('readFailed'));
    } finally {
      setBusy(false);
      ioLock.current = false;
    }
  }
  function addStation() {
    if (doc.vertices.length < 2) {
      setNotice(both('noVertices'));
      return;
    }
    const id = newId();
    change({
      ...doc,
      stations: [...doc.stations, { id, name: t.newStation, kind: 'cp', boundary: false, anchor: null }],
    });
    choose({ type: 'station', id });
    setPanel(null);
    setTool('stationAnchor');
    setNotice(both('stationAdded'));
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
    } else if (tool === 'stationAnchor' && activeStation) {
      change(updateStation(doc, activeStation.id, { anchor: a }));
      setTool('select');
    }
  }
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
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
        if (f && !busy && !pending && !choices) void openFile(f);
      }}
    >
      <div className="shell" inert={busy || !!pending || !!choices}>
        <EditorToolbar
          lang={lang}
          onLanguage={setLang}
          locked={busy || !!pending || !!choices}
          canUndo={history.past.length > 0}
          canRedo={history.future.length > 0}
          onHistory={historyAction}
          onNew={() => requestReplace({ doc: emptyRoute(), source: '' })}
          onExample={() => requestReplace({ doc: exampleRoute(), source: '', sample: true })}
          onOpen={openFile}
          onSave={save}
          onCompile={compile}
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
              <button
                aria-pressed={panel === 'outline'}
                onClick={() => setPanel(panel === 'outline' ? null : 'outline')}
              >
                <Layers size={14} />
                {t.workspace}
              </button>
              <button
                aria-pressed={panel === 'inspector'}
                onClick={() => setPanel(panel === 'inspector' ? null : 'inspector')}
              >
                <PanelsTopLeft size={14} />
                {t.inspector}
              </button>
            </div>
            <div className="canvas-head">
              <div>
                <span className="eyebrow">{t.editor}</span>
                <h1>{doc.name || t.untitled}</h1>
              </div>
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
                      onClick={() => setTool(k)}
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
                  tool={
                    tool === 'append'
                      ? 'add'
                      : tool === 'insert' || tool === 'stationAnchor'
                        ? 'anchor'
                        : tool === 'stationLocation'
                          ? 'location'
                          : 'select'
                  }
                  selectedVertexId={selected.type === 'vertex' ? selected.id : null}
                  selectedStationId={activeStation?.id ?? null}
                  focusAnchor={selected.type === 'sample' ? focus : null}
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
                      setTool('select');
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
            <section className="profile-area">
              <div className="profile-head">
                <span className="pane-title">
                  <Activity size={15} />
                  {t.profile}
                </span>
                <span>
                  <ChevronsUp size={13} />
                  {gainText} m
                </span>
              </div>
              <div className="profile-frame">
                <ProfileView
                  doc={doc}
                  lang={lang}
                  selectedSampleIndex={selected.type === 'sample' ? selected.index : null}
                  focusAnchor={focus}
                  onSelectSample={(index) => select({ type: 'sample', index })}
                />
              </div>
            </section>
          </main>
          <Inspector
            doc={doc}
            t={t}
            selected={selected}
            choose={select}
            change={change}
            setTool={(mode) => {
              setPanel(null);
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
          <div className="problem" role="alert">
            <ShieldCheck size={20} />
            <div>
              <strong>{problem.target ? t.validation : t.file}</strong>
              <p>{problem[lang]}</p>
              {problem.target && (
                <button
                  className="sub-action"
                  onClick={() => {
                    select(problem.target!);
                    setProblem(null);
                  }}
                >
                  {t.showIssue}
                </button>
              )}
            </div>
            <button className="icon" aria-label={t.close} onClick={() => setProblem(null)}>
              <X />
            </button>
          </div>
        )}
      </div>
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
              onChange={(e) => setChoices({ ...choices, index: Number(e.target.value), accept: false })}
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
