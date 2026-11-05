export const commandIds = [
  'new',
  'open',
  'save',
  'export',
  'undo',
  'redo',
  'select',
  'append',
  'insert',
  'addStation',
  'deleteSelected',
  'routeProperties',
  'elevation',
  'resample',
  'fitRoute',
  'mapZoomIn',
  'mapZoomOut',
  'toggleProfile',
  'deviceRoutes',
  'settings',
  'checkUpdates',
] as const;

export type CommandId = (typeof commandIds)[number];
export const commandGroups = ['file', 'edit', 'route', 'view'] as const;
export type CommandGroup = (typeof commandGroups)[number];
export interface CommandDefinition {
  id: CommandId;
  group?: CommandGroup;
  accelerator?: string;
}

export const commandDefinitions: CommandDefinition[] = [
  { id: 'new', group: 'file', accelerator: 'CommandOrControl+N' },
  { id: 'open', group: 'file', accelerator: 'CommandOrControl+O' },
  { id: 'save', group: 'file', accelerator: 'CommandOrControl+S' },
  { id: 'export', group: 'file', accelerator: 'CommandOrControl+Shift+E' },
  { id: 'undo', group: 'edit', accelerator: 'CommandOrControl+Z' },
  { id: 'redo', group: 'edit', accelerator: 'CommandOrControl+Shift+Z' },
  { id: 'deleteSelected', group: 'edit' },
  { id: 'select', group: 'route' },
  { id: 'append', group: 'route' },
  { id: 'insert', group: 'route' },
  { id: 'addStation', group: 'route' },
  { id: 'routeProperties', group: 'route' },
  { id: 'elevation', group: 'route' },
  { id: 'resample', group: 'route' },
  { id: 'fitRoute', group: 'view' },
  { id: 'mapZoomIn', group: 'view' },
  { id: 'mapZoomOut', group: 'view' },
  { id: 'toggleProfile', group: 'view' },
  { id: 'deviceRoutes' },
  { id: 'settings', accelerator: 'CommandOrControl+,' },
  { id: 'checkUpdates' },
];

export interface DesktopCommandState {
  language: 'en' | 'zh';
  enabled: Record<CommandId, boolean>;
}
