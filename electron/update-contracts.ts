export type UpdateMode = 'manual' | 'automatic' | 'disabled';
export type UpdateStatus =
  'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error';
export type UpdateError = 'check' | 'download' | 'install' | 'open' | 'preferences' | 'busy' | 'unsaved';

export interface UpdateRelease {
  version: string;
  notes: string;
  downloadURL?: string;
}

export interface UpdatePreferences {
  autoCheck: boolean;
  lastChecked?: number;
}

export interface UpdateState extends UpdatePreferences {
  currentVersion: string;
  mode: UpdateMode;
  status: UpdateStatus;
  release?: UpdateRelease;
  percent?: number;
  error?: UpdateError;
}
