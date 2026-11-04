import type { DesktopAPI } from '../electron/contracts';

declare global {
  interface Navigator {
    readonly windowControlsOverlay?: EventTarget & {
      readonly visible: boolean;
      getTitlebarAreaRect: () => DOMRect;
    };
  }

  interface Window {
    routeStudioDesktop?: DesktopAPI;
  }
}
