import { Tray, Menu, nativeImage, app } from 'electron';
import type { Windows } from './windows.js';
import type { Session } from './session.js';

// Embedded 22×22 brand-blue dot — works on Windows/Linux trays (an empty image is
// invisible on Windows). macOS additionally shows the title text next to it.
const TRAY_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABYAAAAWCAYAAADEtGw7AAAAhElEQVR4nL2VsQ3AIAwE2TONB0rHHB7Ke1giFCDFyAhE/CmuQeiAB5t03SUhWE2gClekog1pY3QipiYoC2S2gCfNG8KRvBKfSF35ePxTaYc88U6mO5kbccRuza67mAPF/BZHxGDi6GINFOsvYlgUsMuDPTdYgUBLGtaEoG0T2uihX9NnHikOz/FEI/EsAAAAAElFTkSuQmCC';

export function createTray(windows: Windows, session: Session): Tray {
  const img = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL);
  const tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
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
  tray.on('click', () => windows.showSettings());
  return tray;
}
