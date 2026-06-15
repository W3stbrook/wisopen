// macOS TCC permission status/prompts (no-ops on Windows, where Electron has no
// programmatic mic/accessibility prompt — the OS prompts at use time).
import { systemPreferences, shell } from 'electron';

export interface PermStatus {
  microphone: string; // 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown'
  accessibility: boolean;
  inputMonitoring: boolean;
}

export function permStatus(): PermStatus {
  if (process.platform !== 'darwin') {
    return { microphone: 'granted', accessibility: true, inputMonitoring: true };
  }
  return {
    microphone: systemPreferences.getMediaAccessStatus('microphone'),
    accessibility: systemPreferences.isTrustedAccessibilityClient(false),
    // No Electron API to query Input Monitoring; uiohook triggers the OS prompt on start().
    inputMonitoring: true,
  };
}

export async function requestMicrophone(): Promise<boolean> {
  if (process.platform !== 'darwin') return true;
  try {
    return await systemPreferences.askForMediaAccess('microphone');
  } catch {
    return false;
  }
}

export function openSettingsPane(pane: 'microphone' | 'accessibility' | 'input-monitoring'): void {
  if (process.platform !== 'darwin') return;
  const anchor: Record<typeof pane, string> = {
    microphone: 'Privacy_Microphone',
    accessibility: 'Privacy_Accessibility',
    'input-monitoring': 'Privacy_ListenEvent',
  };
  void shell.openExternal(
    `x-apple.systempreferences:com.apple.preference.security?${anchor[pane]}`,
  );
}
