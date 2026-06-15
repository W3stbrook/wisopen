import { Tray, Menu, nativeImage, app } from 'electron';
import type { Windows } from './windows.js';
import type { Session } from './session.js';

export function createTray(windows: Windows, session: Session): Tray {
  // Beta: title-based menubar entry on macOS; a real icon is added in packaging (Phase 3).
  const tray = new Tray(nativeImage.createEmpty());
  if (process.platform === 'darwin') tray.setTitle('◉ Wisopen');
  tray.setToolTip('Wisopen — voice dictation');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Start dictation', click: () => void session.start() },
      { label: 'Stop', click: () => session.stop() },
      { type: 'separator' },
      { label: 'Settings…', click: () => windows.showSettings() },
      { type: 'separator' },
      { label: 'Quit Wisopen', click: () => app.quit() },
    ]),
  );
  return tray;
}
