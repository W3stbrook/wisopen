import { Tray, Menu, nativeImage, app, type MenuItemConstructorOptions } from 'electron';
import type { Windows } from './windows.js';
import type { Session } from './session.js';
import {
  TRAY_TEMPLATE_1X,
  TRAY_TEMPLATE_2X,
  TRAY_COLOR_1X,
  TRAY_COLOR_2X,
} from './tray-icons.js';

/**
 * Wisopen waveform tray icon. On macOS it's a black template image that the OS tints
 * for the light/dark menu bar; elsewhere it's the jade mark (template images don't
 * apply, and a black icon would vanish on Windows' dark tray). Both carry a @2x rep.
 */
function trayImage(): Electron.NativeImage {
  const isMac = process.platform === 'darwin';
  const img = nativeImage.createFromDataURL(isMac ? TRAY_TEMPLATE_1X : TRAY_COLOR_1X);
  img.addRepresentation({ scaleFactor: 2, dataURL: isMac ? TRAY_TEMPLATE_2X : TRAY_COLOR_2X });
  if (isMac) img.setTemplateImage(true);
  return img;
}

export interface TrayController {
  tray: Tray;
  /** show a "Restart to update" entry once an update has been downloaded */
  setUpdateReady(version: string): void;
}

export function createTray(
  windows: Windows,
  session: Session,
  onInstallUpdate: () => void,
): TrayController {
  const img = trayImage();
  const tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  // Icon-only menu bar (the waveform mark is the brand); tooltip carries the name.
  tray.setToolTip('Wisopen — voice dictation');

  let updateItems: MenuItemConstructorOptions[] = [];
  const rebuild = (): void => {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        ...updateItems,
        { label: 'Start dictation', click: () => void session.start() },
        { label: 'Stop', click: () => session.stop() },
        { type: 'separator' },
        { label: 'Settings…', click: () => windows.showSettings('home') },
        { type: 'separator' },
        { label: 'Quit Wisopen', click: () => app.quit() },
      ]),
    );
  };
  rebuild();
  tray.on('click', () => windows.showSettings('home'));

  return {
    tray,
    setUpdateReady(version: string) {
      updateItems = [
        { label: `↻ Restart to update to v${version}`, click: onInstallUpdate },
        { type: 'separator' },
      ];
      rebuild();
    },
  };
}
