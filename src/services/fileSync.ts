import { dbService } from './db';
import { FullBackupData } from '../types';

const BACKUP_FILENAME = 'bakery-master-backup.json';

export class FileSyncService {
  private dirHandle: FileSystemDirectoryHandle | null = null;

  isFileSystemAccessSupported(): boolean {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  }

  async init(): Promise<boolean> {
    if (!this.isFileSystemAccessSupported()) return false;
    try {
      const savedHandle = await dbService.getDirectoryHandle();
      if (savedHandle) {
        // Query existing permission
        const permission = await (savedHandle as any).queryPermission({ mode: 'readwrite' });
        if (permission === 'granted') {
          this.dirHandle = savedHandle;
          return true;
        }
      }
    } catch (e) {
      console.warn('Could not restore directory handle permission:', e);
    }
    return false;
  }

  async connectFolder(): Promise<{ success: boolean; folderName?: string; error?: string }> {
    if (!this.isFileSystemAccessSupported()) {
      return {
        success: false,
        error: 'File System Access API is not supported in this browser. Use manual JSON export/import.'
      };
    }

    try {
      const handle = await (window as any).showDirectoryPicker({
        mode: 'readwrite'
      });
      // Request write permission
      const status = await handle.requestPermission({ mode: 'readwrite' });
      if (status !== 'granted') {
        return { success: false, error: 'Permission to access folder was denied.' };
      }

      this.dirHandle = handle;
      await dbService.saveDirectoryHandle(handle);
      const settings = await dbService.getSettings();
      settings.isFolderConnected = true;
      settings.lastSyncTime = new Date().toISOString();
      await dbService.saveSettings(settings);

      // Perform initial backup save
      await this.saveBackupToDisk();

      return { success: true, folderName: handle.name };
    } catch (e: any) {
      if (e.name === 'AbortError') {
        return { success: false, error: 'Folder selection was canceled.' };
      }
      return { success: false, error: e.message || 'Failed to connect folder.' };
    }
  }

  async disconnectFolder(): Promise<void> {
    this.dirHandle = null;
    await dbService.clearDirectoryHandle();
    const settings = await dbService.getSettings();
    settings.isFolderConnected = false;
    await dbService.saveSettings(settings);
  }

  async saveBackupToDisk(): Promise<{ success: boolean; message: string }> {
    const data = await dbService.getAllData();
    const jsonStr = JSON.stringify(data, null, 2);

    if (this.dirHandle) {
      try {
        const fileHandle = await this.dirHandle.getFileHandle(BACKUP_FILENAME, { create: true });
        const writable = await (fileHandle as any).createWritable();
        await writable.write(jsonStr);
        await writable.close();

        const settings = await dbService.getSettings();
        settings.lastSyncTime = new Date().toISOString();
        await dbService.saveSettings(settings);

        return { success: true, message: `Saved to ${BACKUP_FILENAME} in local folder.` };
      } catch (err: any) {
        return { success: false, message: `Failed saving to folder: ${err.message}` };
      }
    }

    return { success: false, message: 'No local folder connected.' };
  }

  async syncFromDisk(): Promise<{ success: boolean; message: string }> {
    if (!this.dirHandle) {
      return { success: false, message: 'No local folder connected.' };
    }

    try {
      const fileHandle = await this.dirHandle.getFileHandle(BACKUP_FILENAME, { create: false });
      const file = await fileHandle.getFile();
      const content = await file.text();
      const parsedData: FullBackupData = JSON.parse(content);

      if (!parsedData || !Array.isArray(parsedData.recipes)) {
        return { success: false, message: 'Invalid backup file structure in folder.' };
      }

      await dbService.restoreAllData(parsedData);
      return { success: true, message: `Successfully restored data from ${BACKUP_FILENAME}.` };
    } catch (err: any) {
      return { success: false, message: `Could not read from folder: ${err.message}` };
    }
  }

  // --- Fallback: Download / Upload JSON File ---
  async exportJSONFile(): Promise<void> {
    const data = await dbService.getAllData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dateStr = new Date().toISOString().split('T')[0];
    a.download = `bakery-master-backup-${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async importJSONFile(file: File): Promise<{ success: boolean; message: string }> {
    try {
      const text = await file.text();
      const data: FullBackupData = JSON.parse(text);
      if (!data || !Array.isArray(data.recipes)) {
        return { success: false, message: 'File is not a valid BakeMaster backup.' };
      }
      await dbService.restoreAllData(data);
      return { success: true, message: 'Backup successfully loaded into IndexedDB.' };
    } catch (err: any) {
      return { success: false, message: `Failed to import file: ${err.message}` };
    }
  }
}

export const fileSyncService = new FileSyncService();
