import type { DesktopAPI } from '../electron/contracts';

declare global {
  interface Window {
    routeStudioDesktop?: DesktopAPI;
  }
}
