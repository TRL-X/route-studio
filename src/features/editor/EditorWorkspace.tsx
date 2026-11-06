import { Button, Card, SegmentedControl } from '@radix-ui/themes';
import {
  FolderOpen,
  Layers,
  Map as MapIcon,
  MapPin,
  MousePointer2,
  PanelsTopLeft,
  Plus,
  Waypoints,
} from 'lucide-react';
import type { RouteDocument } from '../../domain/model';
import { strings, type Lang, type Localized } from '../../i18n';
import type { BasemapPreferences } from '../../maps/basemap';
import type { ColorScheme } from '../../ui/theme';
import { MapView } from '../../views/MapView';
import { ProfileView } from '../../views/ProfileView';
import type { LookupState } from '../declination/useDeclinationLookup';
import { Inspector } from './Inspector';
import { ProfilePanel } from './ProfilePanel';
import { RouteOutline } from './RouteOutline';
import { commandStrings } from './commands';
import type { EditorSelection } from './useEditorSelection';
import { sameTarget, type Selection, type Tool } from './types';

interface Props {
  doc: RouteDocument;
  lang: Lang;
  selection: EditorSelection;
  source: string;
  session: number;
  scheme: ColorScheme;
  basemap: BasemapPreferences;
  preferencesFailed: boolean;
  onOpenMapSettings: () => void;
  onOpenFile: () => void;
  gain: number | null;
  profileCollapsed: boolean;
  onProfileCollapsedChange: (collapsed: boolean) => void;
  onElevationTools: () => void;
  lookup: LookupState;
  magneticExpanded: boolean;
  onMagneticExpanded: (expanded: boolean) => void;
  issue: (Localized & { target?: Selection }) | null;
  change: (next: RouteDocument) => void;
  onStatus: (text: string) => void;
}

export function EditorWorkspace({
  doc,
  lang,
  selection,
  source,
  session,
  scheme,
  basemap,
  preferencesFailed,
  onOpenMapSettings,
  onOpenFile,
  gain,
  profileCollapsed,
  onProfileCollapsedChange,
  onElevationTools,
  lookup,
  magneticExpanded,
  onMagneticExpanded,
  issue,
  change,
  onStatus,
}: Props) {
  const t = strings[lang];
  const {
    selected,
    revealSelection,
    tool,
    hoveredSample,
    setHoveredSample,
    mapProbeDistance,
    setMapProbeDistance,
    panel,
    setPanel,
    viewCommand,
    axis,
    activeStation,
    focus,
    focusedMeters,
    selectionTitle,
    select,
    addStation,
    pickAnchor,
    cancelTool,
    canDelete,
    deleteSelected,
    startTool,
    toolHelp,
  } = selection;
  const length = (axis.at(-1) ?? 0) / 1000;
  const gainText = gain === null ? '—' : gain.toFixed(0);
  return (
    <div className="workspace" data-panel={panel ?? ''}>
      <RouteOutline
        key={session}
        doc={doc}
        axis={axis}
        selected={selected}
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
              onValueChange={(value) => startTool(value as Tool)}
            >
              {(
                [
                  ['select', MousePointer2, t.select],
                  ['append', Plus, t.append],
                  ['insert', Waypoints, t.insert],
                  ['newStation', MapPin, t.addStation],
                ] as const
              ).map(([k, Icon, label]) => (
                <SegmentedControl.Item
                  key={k}
                  value={k}
                  title={label}
                  aria-disabled={(k === 'insert' || k === 'newStation') && doc.vertices.length < 2}
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
            {tool !== 'select' && (
              <div className="map-mode" role="group" aria-label={t.tools}>
                <span>
                  <strong>
                    {
                      {
                        append: t.append,
                        insert: t.insert,
                        newStation: t.addStation,
                        stationAnchor: t.pickRoutePosition,
                        stationLocation: t.location,
                      }[tool]
                    }
                  </strong>
                  {activeStation &&
                    (tool === 'stationAnchor' || tool === 'stationLocation') &&
                    ` · ${selectionTitle}`}
                  <span className="mode-hint"> · {toolHelp}</span>
                </span>
                <Button size="1" variant="soft" color="gray" onClick={cancelTool}>
                  {t.cancel} · Esc
                </Button>
              </div>
            )}
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
              basemap={basemap}
              storageFailed={preferencesFailed}
              onOpenSettings={onOpenMapSettings}
              viewCommand={viewCommand}
              selectedVertexId={selected.type === 'vertex' ? selected.id : null}
              selectedStationId={activeStation?.id ?? null}
              focusAnchor={selected.type === 'sample' ? focus : null}
              profileHoverAnchor={hoveredSample === null ? null : doc.elevation[hoveredSample]?.anchor}
              onProbeDistance={setMapProbeDistance}
              onSelectVertex={(id) => select({ type: 'vertex', id })}
              onSelectStation={(id) => select({ type: 'station', id })}
              onMoveVertex={selection.moveVertex}
              onAddVertex={selection.addVertex}
              onPickAnchor={pickAnchor}
              onPickLocation={selection.pickLocation}
            />
            {!doc.vertices.length && tool !== 'append' && (
              <Card className="empty-overlay" size="3">
                <PanelsTopLeft size={25} />
                <h2>{t.empty}</h2>
                <p>{t.emptyHelp}</p>
                <div className="empty-actions">
                  <Button onClick={onOpenFile}>
                    <FolderOpen />
                    {t.openRoute}
                  </Button>
                  <Button variant="surface" color="gray" onClick={() => startTool('append')}>
                    <Plus />
                    {t.append}
                  </Button>
                </div>
              </Card>
            )}
          </div>
        </section>
        <ProfilePanel
          t={t}
          count={doc.elevation.length}
          actionLabel={commandStrings[lang].elevation}
          disabled={!doc.vertices.length}
          onProcess={onElevationTools}
          collapsed={profileCollapsed}
          onCollapsedChange={onProfileCollapsedChange}
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
        lang={lang}
        lookup={lookup}
        magneticExpanded={magneticExpanded}
        onMagneticExpanded={onMagneticExpanded}
        onDelete={deleteSelected}
        canDelete={canDelete}
        doc={doc}
        t={t}
        selected={selected}
        choose={(s) => select(s, true)}
        issue={sameTarget(selected, issue?.target) ? issue?.[lang] : undefined}
        change={change}
        setTool={startTool}
        status={onStatus}
      />
    </div>
  );
}
