export type UpdateMode = 'manual' | 'automatic' | 'disabled';
export type UpdateChannel = 'stable' | 'beta';
export interface BuildInfo {
  commit: string;
  builtAt: string;
}
export type UpdateStatus =
  'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error';
export type UpdateError =
  'check' | 'download' | 'install' | 'open' | 'preferences' | 'busy' | 'unsaved' | 'channelBusy';

export interface UpdateRelease {
  version: string;
  notes: string;
  downloadURL?: string;
  build?: BuildInfo;
}

export interface UpdatePreferences {
  autoCheck: boolean;
  channel: UpdateChannel;
  lastChecked?: number;
}

export interface UpdateState extends UpdatePreferences {
  currentVersion: string;
  currentBuild?: BuildInfo;
  mode: UpdateMode;
  status: UpdateStatus;
  release?: UpdateRelease;
  percent?: number;
  error?: UpdateError;
}
