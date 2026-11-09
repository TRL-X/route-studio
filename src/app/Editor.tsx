import { Button, IconButton, Theme, Callout } from '@radix-ui/themes';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useUpdates } from '../features/settings/useUpdates';
import { updateStrings } from '../features/settings/UpdatesPanel';
import { ShieldCheck, X } from 'lucide-react';
import { geometryChanged } from '../domain/edit';
import { fillShortElevationGaps, type ImportElevationAssessment } from '../domain/elevation-repair';
import { emptyRoute, type RouteDocument } from '../domain/model';
import { ascent } from '../domain/summary';
import type { ExportFormat } from '../files/export';
import { useDevices } from '../features/device/useDevices';
import { DeviceConnection } from '../features/device/DeviceConnection';
import { DeviceTaskStatus } from '../features/device/DeviceTaskStatus';
import { DeviceRoutes } from '../features/device/DeviceRoutes';
import { FirmwareDialog } from '../features/device/FirmwareDialog';
import { DesktopSerial } from '../features/device/DesktopSerial';
import { ExportDialog } from '../features/export/ExportDialog';
import { RteError } from '../rte/check';
import { defaultExportOptions } from '../rte/processing';
import { EditorToolbar } from '../features/editor/EditorToolbar';
import { ElevationRepair } from '../features/elevation/ElevationRepair';
import type { Selection } from '../features/editor/types';
import { useEditorSelection } from '../features/editor/useEditorSelection';
import { both, initialLanguage, strings, type Lang, type Localized } from '../i18n';
import { useDocumentSession } from '../features/editor/useDocumentSession';
import type { Draft } from '../platform/storage/draft';
import { useRouteFiles, routeFilename, type Replacement } from '../features/editor/useRouteFiles';
import { FileDialogs } from '../features/editor/FileDialogs';
import { useDesktopOpenFiles } from '../features/editor/useDesktopOpenFiles';
import { DesktopOpenDialog } from '../features/editor/DesktopOpenDialog';
import { EditorWorkspace } from '../features/editor/EditorWorkspace';
import './editor.css';
import { DesktopBluetooth } from '../features/device/DesktopBluetooth';
import { useTheme } from '../ui/theme';
import { SettingsDialog, type SettingsValues } from '../features/settings/SettingsDialog';
import { loadBasemapPreferences, saveBasemapPreferences } from '../maps/basemap';
import { ElevationTools, workflowStrings } from '../features/elevation/ElevationTools';
import { ImportElevationDialog } from '../features/elevation/ImportElevationDialog';
import { useDeclinationLookup } from '../features/declination/useDeclinationLookup';
import { type EditorCommands } from '../features/editor/commands';
import { ResampleDialog, resampleStrings } from '../features/resample/ResampleDialog';

type Problem = Localized & { target?: Selection };
type DevicePanel = 'connection' | 'send' | 'routes' | 'firmware' | 'recovery';
export function Editor({ restored, recoveryError }: { restored: Draft | null; recoveryError: boolean }) {
  const documentSession = useDocumentSession(restored, recoveryError);
  const { history, dispatch, doc, currentDoc, dirty, protectRecovered, source, session, draftState } =
    documentSession;
  const updates = useUpdates();
  const { device, firmware, connection } = useDevices();
  const [devicePanel, setDevicePanel] = useState<DevicePanel | null>(null);
  const [sendSnapshot, setSendSnapshot] = useState<RouteDocument | null>(null);
  const [sendOptions, setSendOptions] = useState(defaultExportOptions);
  const [lang, setLang] = useState<Lang>(initialLanguage);
  const t = strings[lang];
  const { theme, scheme, changeTheme } = useTheme();
  const [notice, setNotice] = useState<Localized | null>(restored ? both('recovery') : null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [issue, setIssue] = useState<Problem | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat | null>(null);
  const [exportOptions, setExportOptions] = useState(defaultExportOptions);
  const [exportName, setExportName] = useState<string | null>(null);
  const [elevationPanel, setElevationPanel] = useState<'import' | 'tools' | 'online' | null>(null);
  const [resampleSource, setResampleSource] = useState<RouteDocument | null>(null);
  const [importElevation, setImportElevation] = useState<ImportElevationAssessment | null>(null);
  const [elevationSummary, setElevationSummary] = useState<Localized | null>(null);
  const [elevationFillError, setElevationFillError] = useState<'fillLimit' | 'fillFailed' | null>(null);
  const fillError = elevationFillError ? workflowStrings[lang][elevationFillError] : undefined;
  const [settingsTab, setSettingsTab] = useState<'general' | 'map' | 'updates' | null>(null);
  const [basemap, setBasemap] = useState(loadBasemapPreferences);
  const [preferencesFailed, setPreferencesFailed] = useState(false);
  const [profileCollapsed, setProfileCollapsed] = useState(false);
  const [magneticExpanded, setMagneticExpanded] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const files = useRouteFiles({
    doc,
    currentDoc,
    dirty,
    protectRecovered,
    onReplace: replace,
    onSaved: documentSession.markProjectSaved,
    onNotice: setNotice,
    onProblem: setProblem,
  });
  const {
    busy,
    pickingFile,
    savingFile,
    fileSaveError,
    setFileSaveError,
    pending,
    choices,
    requestReplace,
    openFile,
    pickDesktopFile,
    save,
  } = files;
  const editorBlocked =
    !!devicePanel ||
    busy ||
    pickingFile ||
    savingFile ||
    !!pending ||
    !!choices ||
    !!exportFormat ||
    !!elevationPanel ||
    !!settingsTab ||
    !!resampleSource;
  const externalFiles = useDesktopOpenFiles({
    blocked:
      editorBlocked ||
      !!problem ||
      !!firmware.state.busy ||
      firmware.state.pending ||
      !!device.state.busy ||
      device.state.pending,
    openFile,
    onProblem: setProblem,
  });
  const locked = editorBlocked || externalFiles.reading || !!externalFiles.selection;
  const selection = useEditorSelection({ doc, lang, locked, change, setNotice });
  const {
    selected,
    setHoveredSample,
    setMapProbeDistance,
    setPanel,
    axis,
    select,
    addStation,
    cancelTool,
    canDelete,
    deleteSelected,
    startTool,
    mapCommand,
    toolHelp,
  } = selection;
  const lookup = useDeclinationLookup(
    doc,
    dispatch,
    exportFormat === 'rte' ||
      (devicePanel === 'send' && !sendSnapshot) ||
      (selected.type === 'route' && magneticExpanded),
  );
  const status = (msg: string) => setNotice({ en: msg, zh: msg });
  const updateBlocked =
    !!devicePanel ||
    !!firmware.state.busy ||
    firmware.state.pending ||
    !!device.state.busy ||
    device.state.pending ||
    busy ||
    pickingFile ||
    externalFiles.reading ||
    !!externalFiles.selection ||
    savingFile ||
    !!exportFormat ||
    !!elevationPanel ||
    !!pending ||
    !!choices ||
    !!resampleSource;
  const transferBusy = !!firmware.state.busy || !!device.state.busy;
  useLayoutEffect(() => {
    window.routeStudioDesktop?.setDocumentState(dirty, lang, updateBlocked, transferBusy);
  }, [dirty, lang, updateBlocked, transferBusy]);
  function change(next: RouteDocument) {
    if (next === doc) return;
    setIssue(null);
    setHoveredSample(null);
    setProblem(null);
    setNotice(null);
    documentSession.edit(next);
  }
  const gain = useMemo(() => ascent(doc), [doc.vertices, doc.elevation]);
  const missingHeights = useMemo(
    () => doc.elevation.filter((s) => s.height === null).length,
    [doc.elevation],
  );
  function fillElevationGaps() {
    try {
      const { document, filled, remaining } = fillShortElevationGaps(doc);
      if (filled) change(document);
      setElevationFillError(null);
      const message = (language: Lang) =>
        strings[language].interpolationResult
          .replace('{filled}', String(filled))
          .replace('{remaining}', String(remaining.length));
      const summary = { en: message('en'), zh: message('zh') };
      setNotice(summary);
      setElevationSummary(summary);
      if (elevationPanel === 'import') {
        setImportElevation(null);
        setElevationPanel(remaining.length ? 'tools' : null);
      }
    } catch (error) {
      setElevationSummary(null);
      setElevationFillError(error instanceof RteError && error.code === 'limit' ? 'fillLimit' : 'fillFailed');
    }
  }
  function historyAction(type: 'undo' | 'redo') {
    const next = type === 'undo' ? history.past.at(-1) : history.future[0];
    if (!next) return;
    selection.reconcile(next);
    setIssue(null);
    setHoveredSample(null);
    setProblem(null);
    setNotice(null);
    dispatch({ type });
  }
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  }, [lang]);
  function replace(next: Replacement) {
    setExportOptions(defaultExportOptions);
    if (!device.state.busy && !device.state.pending) {
      setSendSnapshot(null);
      setSendOptions(defaultExportOptions);
    }
    setExportName(null);
    setExportFormat(null);
    setElevationPanel(next.elevationAssessment ? 'import' : null);
    setImportElevation(next.elevationAssessment ?? null);
    setElevationSummary(null);
    setElevationFillError(null);
    setMagneticExpanded(false);
    setResampleSource(null);
    setIssue(null);
    setHoveredSample(null);
    setMapProbeDistance(null);
    documentSession.replace(next.doc, next.source);
    select({ type: 'route' });
    setPanel(null);
    setProblem(null);
    setNotice(both('loaded'));
  }
  const exportControls = {
    lang,
    onFormat: (format: ExportFormat) => {
      setExportFormat(format);
      setFileSaveError(null);
    },
    name: exportName ?? routeFilename(doc.name),
    onName: setExportName,
    onClose: () => {
      setExportFormat(null);
      setFileSaveError(null);
    },
    saving: savingFile,
    saveError: fileSaveError?.[lang],
    onDownload: async (bytes: Uint8Array<ArrayBuffer>, name: string) => {
      if (exportFormat && (await files.saveExport(exportFormat, bytes, name))) setExportFormat(null);
    },
  };
  function applyPreferences(values: SettingsValues) {
    const themeSaved = changeTheme(values.theme);
    const mapSaved = saveBasemapPreferences(values.basemap);
    let languageSaved = true;
    try {
      localStorage.setItem('route-studio-language', values.lang);
    } catch {
      languageSaved = false;
    }
    setLang(values.lang);
    setBasemap(values.basemap);
    setPreferencesFailed(!themeSaved || !mapSaved || !languageSaved);
    setSettingsTab(null);
    setNotice({ en: workflowStrings.en.settingsSaved, zh: workflowStrings.zh.settingsSaved });
  }
  function openElevationTools() {
    setElevationSummary(null);
    setElevationFillError(null);
    setElevationPanel('tools');
  }
  const deviceOccupied = !!connection.state.task || !!connection.state.busy;
  const firmwarePanel = firmware.state.mode === 'recovery' ? 'recovery' : 'firmware';
  function openNormalDevicePanel(panel: 'connection' | 'send' | 'routes') {
    if (connection.session.snapshot().mode === 'application' || connection.session.setMode('application'))
      setDevicePanel(panel);
  }
  async function openFirmware(mode: 'application' | 'recovery') {
    await firmware.session.setMode(mode);
    if (firmware.session.snapshot().mode === mode)
      setDevicePanel(mode === 'recovery' ? 'recovery' : 'firmware');
  }
  const commands: EditorCommands = {
    new: { run: () => requestReplace({ doc: emptyRoute(), source: '' }) },
    open: { run: () => (window.routeStudioDesktop ? void pickDesktopFile() : picker.current?.click()) },
    save: { run: () => void save() },
    export: {
      run: () => {
        setProblem(null);
        setExportFormat('rte');
      },
    },
    undo: { run: () => historyAction('undo'), disabled: !history.past.length },
    redo: { run: () => historyAction('redo'), disabled: !history.future.length },
    select: { run: () => startTool('select') },
    append: { run: () => startTool('append') },
    insert: { run: () => startTool('insert'), disabled: doc.vertices.length < 2 },
    addStation: { run: addStation, disabled: doc.vertices.length < 2 },
    deleteSelected: { run: deleteSelected, disabled: !canDelete },
    routeProperties: { run: () => select({ type: 'route' }, true) },
    elevation: { run: openElevationTools, disabled: !doc.vertices.length },
    resample: {
      run: () => {
        cancelTool();
        setResampleSource(doc);
      },
      disabled: doc.vertices.length < 2 || !(axis.at(-1)! > 0),
    },
    fitRoute: { run: () => mapCommand('fit'), disabled: !doc.vertices.length },
    mapZoomIn: { run: () => mapCommand('zoomIn') },
    mapZoomOut: { run: () => mapCommand('zoomOut') },
    toggleProfile: {
      run: () => setProfileCollapsed((value) => !value),
      checked: !profileCollapsed,
    },
    deviceConnect: {
      run: () => openNormalDevicePanel('connection'),
      disabled: deviceOccupied,
    },
    deviceSend: {
      run: () => {
        if (!device.state.busy && !device.state.pending) {
          setSendSnapshot(null);
        }
        openNormalDevicePanel('send');
      },
      disabled:
        connection.state.task === 'firmware' ||
        !!connection.state.busy ||
        (!device.state.pending && doc.vertices.length < 2),
    },
    deviceRoutes: {
      run: () => openNormalDevicePanel('routes'),
      disabled: connection.state.task === 'firmware' || !!connection.state.busy,
    },
    deviceFirmware: {
      run: () => void openFirmware('application'),
      disabled:
        deviceOccupied && (connection.state.task !== 'firmware' || firmware.state.mode !== 'application'),
    },
    deviceRecovery: {
      run: () => void openFirmware('recovery'),
      disabled:
        deviceOccupied && (connection.state.task !== 'firmware' || firmware.state.mode !== 'recovery'),
    },
    settings: { run: () => setSettingsTab('general') },
    checkUpdates: {
      run: () => {
        setSettingsTab('updates');
        void updates.check();
      },
      disabled: !window.routeStudioDesktop,
    },
  };
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
          title={doc.name}
          onRename={(name) => change({ ...currentDoc.current, name })}
          lang={lang}
          locked={locked}
          commands={commands}
          update={
            updates.state?.release &&
            updates.state.mode !== 'disabled' &&
            ['available', 'downloading', 'downloaded', 'error'].includes(updates.state.status)
              ? {
                  label: updateStrings[lang][
                    updates.state.status === 'downloaded' ? 'readyNotice' : 'notice'
                  ].replace('{version}', updates.state.release.version),
                  onOpen: () => setSettingsTab('updates'),
                }
              : undefined
          }
        />
        <input
          ref={picker}
          type="file"
          aria-label={t.openFile}
          hidden
          accept=".fit,.gpx,.kml,.rte,.routeproj"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file && !locked) void openFile(file);
          }}
        />
        <EditorWorkspace
          doc={doc}
          lang={lang}
          selection={selection}
          source={source}
          session={session}
          scheme={scheme}
          basemap={basemap}
          preferencesFailed={preferencesFailed}
          onOpenMapSettings={() => setSettingsTab('map')}
          onOpenFile={commands.open.run}
          gain={gain}
          profileCollapsed={profileCollapsed}
          onProfileCollapsedChange={setProfileCollapsed}
          onElevationTools={openElevationTools}
          lookup={lookup}
          magneticExpanded={magneticExpanded}
          onMagneticExpanded={setMagneticExpanded}
          issue={issue}
          change={change}
          onStatus={status}
        />
        <footer className="statusbar">
          <span className="status-dot" />
          <span className="status-copy" role="status">
            {notice ? notice[lang] : toolHelp}
          </span>
          <span className={draftState === 'saveFailed' ? 'save-error' : 'draft-status'}>{t[draftState]}</span>
          {updates.state?.release && ['available', 'downloaded'].includes(updates.state.status) && (
            <Button size="1" variant="ghost" onClick={() => setSettingsTab('updates')}>
              {updateStrings[lang][updates.state.status === 'downloaded' ? 'readyNotice' : 'notice'].replace(
                '{version}',
                updates.state.release.version,
              )}
            </Button>
          )}
          <DeviceTaskStatus
            device={device}
            firmware={firmware}
            connection={connection}
            lang={lang}
            onOpen={(task) => {
              if (task === 'routes') openNormalDevicePanel(sendSnapshot ? 'send' : 'routes');
              else setDevicePanel(task === 'firmware' ? firmwarePanel : 'connection');
            }}
          />
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
      {exportFormat && (
        <ExportDialog
          format={exportFormat}
          doc={doc}
          {...exportControls}
          lookup={lookup}
          onEditProperties={() => {
            setExportFormat(null);
            select({ type: 'route' }, true);
            setMagneticExpanded(true);
          }}
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
      {devicePanel === 'send' && (
        <ExportDialog
          format="rte"
          doc={sendSnapshot ?? doc}
          {...exportControls}
          onClose={() => setDevicePanel(null)}
          saving={false}
          saveError={undefined}
          send={{
            device,
            onManage: () => setDevicePanel('routes'),
            onStart: () => setSendSnapshot((current) => current ?? doc),
          }}
          lookup={sendSnapshot ? { pending: false } : lookup}
          onEditProperties={() => {
            setDevicePanel(null);
            select({ type: 'route' }, true);
            setMagneticExpanded(true);
          }}
          projectGain={sendSnapshot ? ascent(sendSnapshot) : gain}
          options={sendOptions}
          onOptions={setSendOptions}
          onLocate={(error) => {
            setDevicePanel(null);
            setIssue(error);
            select(error.target ?? { type: 'route' }, true);
          }}
        />
      )}
      {settingsTab && (
        <SettingsDialog
          lang={lang}
          theme={theme}
          basemap={basemap}
          initialTab={settingsTab}
          onApply={applyPreferences}
          onClose={() => setSettingsTab(null)}
          updates={updates}
          dirty={dirty}
          onSave={save}
        />
      )}
      {resampleSource && (
        <ResampleDialog
          doc={resampleSource}
          lang={lang}
          scheme={scheme}
          basemap={basemap}
          onClose={() => setResampleSource(null)}
          onApply={(next) => {
            // A magnetic lookup can complete during preview; retain it if still applicable.
            change(geometryChanged({ ...next, declination: doc.declination }));
            select({ type: 'route' });
            setMapProbeDistance(null);
            setResampleSource(null);
            setNotice({ en: resampleStrings.en.done, zh: resampleStrings.zh.done });
          }}
        />
      )}
      {elevationPanel === 'import' && importElevation && (
        <ImportElevationDialog
          lang={lang}
          assessment={importElevation}
          fillError={fillError}
          onFill={fillElevationGaps}
          onOnline={() => setElevationPanel('online')}
          onClose={() => {
            setElevationPanel(null);
            setImportElevation(null);
          }}
        />
      )}
      {elevationPanel === 'tools' && (
        <ElevationTools
          lang={lang}
          canFill={missingHeights < doc.elevation.length && (missingHeights > 0 || gain === null)}
          hasKnownHeights={missingHeights < doc.elevation.length}
          summary={elevationSummary?.[lang]}
          fillError={fillError}
          onFill={fillElevationGaps}
          onOnline={() => setElevationPanel('online')}
          onClose={() => setElevationPanel(null)}
        />
      )}
      {elevationPanel === 'online' && (
        <ElevationRepair
          doc={doc}
          lang={lang}
          initialSummary={elevationSummary?.[lang]}
          onBack={() => setElevationPanel(importElevation ? 'import' : 'tools')}
          onApply={(next) => {
            change(next);
            setNotice(both('elevationsReplaced'));
            setElevationPanel(null);
            setImportElevation(null);
          }}
          onClose={() => {
            setElevationPanel(null);
            setImportElevation(null);
          }}
        />
      )}
      <FileDialogs files={files} lang={lang} reading={externalFiles.reading} />
      {externalFiles.selection && (
        <DesktopOpenDialog
          key={externalFiles.selection.id}
          request={externalFiles.selection}
          lang={lang}
          onChoose={(index) => void externalFiles.choose(index)}
          onClose={externalFiles.cancel}
        />
      )}
      {devicePanel === 'connection' && (
        <DeviceConnection connection={connection} lang={lang} onClose={() => setDevicePanel(null)} />
      )}
      {devicePanel === 'routes' && (
        <DeviceRoutes device={device} lang={lang} onClose={() => setDevicePanel(null)} />
      )}
      {(devicePanel === 'firmware' || devicePanel === 'recovery') && (
        <FirmwareDialog firmware={firmware} lang={lang} onClose={() => setDevicePanel(null)} />
      )}
      <DesktopBluetooth lang={lang} />
      <DesktopSerial lang={lang} />
    </Theme>
  );
}
