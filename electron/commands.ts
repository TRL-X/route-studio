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
  'deviceConnect',
  'deviceSend',
  'deviceRoutes',
  'deviceFirmware',
  'deviceRecovery',
  'settings',
  'checkUpdates',
] as const;

export type CommandId = (typeof commandIds)[number];
export const commandGroups = ['file', 'edit', 'route', 'view', 'device'] as const;
export type CommandGroup = (typeof commandGroups)[number];
export interface CommandDefinition {
  id: CommandId;
  group?: CommandGroup;
  accelerator?: string;
  separatorBefore?: boolean;
  type?: 'checkbox';
}

export const commandDefinitions: CommandDefinition[] = [
  { id: 'new', group: 'file', accelerator: 'CommandOrControl+N' },
  { id: 'open', group: 'file', accelerator: 'CommandOrControl+O' },
  { id: 'save', group: 'file', accelerator: 'CommandOrControl+S' },
  { id: 'export', group: 'file', accelerator: 'CommandOrControl+Shift+E' },
  { id: 'undo', group: 'edit', accelerator: 'CommandOrControl+Z' },
  { id: 'redo', group: 'edit', accelerator: 'CommandOrControl+Shift+Z' },
  { id: 'select', group: 'edit', separatorBefore: true },
  { id: 'append', group: 'edit' },
  { id: 'insert', group: 'edit' },
  { id: 'addStation', group: 'edit' },
  { id: 'deleteSelected', group: 'edit', separatorBefore: true },
  { id: 'routeProperties', group: 'route' },
  { id: 'elevation', group: 'route', separatorBefore: true },
  { id: 'resample', group: 'route' },
  { id: 'fitRoute', group: 'view' },
  { id: 'mapZoomIn', group: 'view' },
  { id: 'mapZoomOut', group: 'view' },
  { id: 'toggleProfile', group: 'view', separatorBefore: true, type: 'checkbox' },
  { id: 'deviceConnect', group: 'device' },
  { id: 'deviceSend', group: 'device', separatorBefore: true },
  { id: 'deviceRoutes', group: 'device' },
  { id: 'deviceFirmware', group: 'device', separatorBefore: true },
  { id: 'deviceRecovery', group: 'device' },
  { id: 'settings', accelerator: 'CommandOrControl+,' },
  { id: 'checkUpdates' },
];

export interface DesktopCommandState {
  language: 'en' | 'zh';
  enabled: Record<CommandId, boolean>;
  checked?: Partial<Record<CommandId, boolean>>;
}
