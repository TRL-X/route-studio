import type {
  BuildInfo,
  UpdateChannel,
  UpdateError,
  UpdateMode,
  UpdatePreferences,
  UpdateRelease,
  UpdateState,
} from './update-contracts.js';

export interface UpdateBackend {
  check: (channel: UpdateChannel) => Promise<UpdateRelease | null>;
  download?: (progress: (percent: number) => void) => Promise<void>;
  prepareInstall?: () => Promise<void>;
  install?: () => void;
  open?: (release: UpdateRelease) => Promise<void>;
  openStable?: () => Promise<void>;
}

export const checkInterval = 24 * 60 * 60 * 1000;

export class UpdateService {
  private state: UpdateState;
  private running = false;
  private writes: Promise<void> = Promise.resolve();

  constructor(
    private readonly options: {
      mode: UpdateMode;
      currentVersion: string;
      currentBuild?: BuildInfo;
      preferences: UpdatePreferences;
      backend: UpdateBackend;
      publish: (state: UpdateState) => void;
      persist: (preferences: UpdatePreferences) => Promise<void>;
      canInstall: (discard: boolean) => 'busy' | 'unsaved' | null;
      now?: () => number;
    },
  ) {
    this.state = {
      ...options.preferences,
      mode: options.mode,
      currentVersion: options.currentVersion,
      currentBuild: options.currentBuild,
      status: 'idle',
    };
  }

  snapshot(): UpdateState {
    return structuredClone(this.state);
  }

  private set(patch: Partial<UpdateState>) {
    this.state = { ...this.state, ...patch };
    this.options.publish(this.snapshot());
  }

  private persist() {
    const { autoCheck, channel, lastChecked } = this.state;
    this.writes = this.writes
      .catch(() => {})
      .then(() => this.options.persist({ autoCheck, channel, lastChecked }));
    return this.writes;
  }

  async setAutoCheck(autoCheck: boolean) {
    this.set({ autoCheck, error: undefined });
    try {
      await this.persist();
    } catch {
      this.set({ error: 'preferences' });
    }
    return this.snapshot();
  }

  async setChannel(channel: UpdateChannel) {
    if (channel !== 'stable' && channel !== 'beta') throw new Error('Invalid update channel');
    if (this.state.mode === 'disabled' || channel === this.state.channel) return this.snapshot();
    if (this.running || this.state.status === 'installing') {
      this.set({ error: 'channelBusy' });
      return this.snapshot();
    }
    const previous = this.state.channel;
    this.running = true;
    // A downloaded update belongs to its old channel. It must never remain installable after a switch.
    this.set({
      channel,
      status: 'idle',
      release: undefined,
      percent: undefined,
      error: undefined,
      lastChecked: undefined,
    });
    try {
      await this.persist();
    } catch {
      this.set({ channel: previous, error: 'preferences' });
      return this.snapshot();
    } finally {
      this.running = false;
    }
    return this.check();
  }

  async check(manual = true) {
    const now = (this.options.now ?? Date.now)();
    const elapsed = now - (this.state.lastChecked ?? 0);
    if (
      this.state.mode === 'disabled' ||
      this.running ||
      ['downloaded', 'installing'].includes(this.state.status)
    )
      return this.snapshot();
    if (
      !manual &&
      (!this.state.autoCheck ||
        (this.state.lastChecked !== undefined && elapsed >= 0 && elapsed < checkInterval))
    )
      return this.snapshot();
    this.running = true;
    this.set({
      status: 'checking',
      error: undefined,
      release: undefined,
      percent: undefined,
      lastChecked: now,
    });
    // Persist attempts as well as successes, so offline launches do not hammer the feed.
    const stored = this.persist().catch(() => {});
    try {
      const release = await this.options.backend.check(this.state.channel);
      this.set({ status: release ? 'available' : 'current', release: release ?? undefined });
    } catch {
      this.set({ status: 'error', error: 'check' });
    } finally {
      await stored;
      this.running = false;
    }
    return this.snapshot();
  }

  async download() {
    if (
      this.state.mode !== 'automatic' ||
      this.running ||
      !this.state.release ||
      !['available', 'error'].includes(this.state.status)
    )
      return this.snapshot();
    this.running = true;
    this.set({ status: 'downloading', percent: 0, error: undefined });
    try {
      if (!this.options.backend.download) throw new Error('Download unavailable');
      await this.options.backend.download((percent) => {
        if (Number.isFinite(percent)) this.set({ percent: Math.min(100, Math.max(0, percent)) });
      });
      this.set({ status: 'downloaded', percent: 100 });
    } catch {
      this.set({ status: 'error', error: 'download', percent: undefined });
    } finally {
      this.running = false;
    }
    return this.snapshot();
  }

  async open() {
    if (this.state.mode !== 'manual' || !this.state.release || this.running) return this.snapshot();
    this.running = true;
    this.set({ error: undefined });
    try {
      if (!this.options.backend.open) throw new Error('Download link unavailable');
      await this.options.backend.open(this.state.release);
    } catch {
      this.set({ error: 'open' });
    } finally {
      this.running = false;
    }
    return this.snapshot();
  }

  async openStable() {
    if (this.state.mode === 'disabled' || this.running) return this.snapshot();
    this.running = true;
    this.set({ error: undefined });
    try {
      if (!this.options.backend.openStable) throw new Error('Stable release unavailable');
      await this.options.backend.openStable();
    } catch {
      this.set({ error: 'open' });
    } finally {
      this.running = false;
    }
    return this.snapshot();
  }

  failInstall() {
    if (this.state.status === 'installing') this.set({ status: 'downloaded', error: 'install' });
  }

  async install(discard: boolean) {
    if (this.state.mode !== 'automatic' || this.state.status !== 'downloaded' || this.running)
      return this.snapshot();
    this.running = true;
    try {
      await this.options.backend.prepareInstall?.();
      const error: UpdateError | null = this.options.canInstall(discard);
      if (error) this.set({ error });
      else {
        if (!this.options.backend.install) throw new Error('Installation unavailable');
        this.set({ status: 'installing', error: undefined });
        this.options.backend.install();
      }
    } catch {
      this.set({ status: 'downloaded', error: 'install' });
    } finally {
      this.running = false;
    }
    return this.snapshot();
  }
}
