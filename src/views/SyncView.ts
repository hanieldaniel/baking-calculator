import { dbService } from '../services/db';
import { fileSyncService } from '../services/fileSync';
import { showToast } from '../utils/ui';

export async function renderSyncView(container: HTMLElement): Promise<void> {
  const settings = await dbService.getSettings();
  const isSupported = fileSyncService.isFileSystemAccessSupported();

  const lastSyncStr = settings.lastSyncTime
    ? new Date(settings.lastSyncTime).toLocaleString('en-IN')
    : 'Never';

  container.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="view-title">Local Drive Sync & Data Storage</h1>
        <p class="view-desc">Direct filesystem folder synchronization and offline backup tools.</p>
      </div>
    </div>

    <!-- File System Access Direct Sync Card -->
    <div class="card">
      <div style="display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.75rem;">
        <span style="font-size: 1.5rem;">📁</span>
        <h2 style="font-size: 1.25rem; font-weight: 700;">Direct Local Drive Folder Sync</h2>
      </div>

      ${
        isSupported
          ? `
        <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 1.25rem;">
          Connect a folder on your computer's hard drive (e.g. <code>Documents/BakeryData</code>).
          BakeMaster will write and sync a live <code>bakery-master-backup.json</code> file into that folder automatically whenever you save recipes or orders.
        </p>

        <div style="background: #f8fafc; border: 1px solid var(--border); border-radius: var(--radius); padding: 1rem; margin-bottom: 1.25rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
            <div>
              <div style="font-size: 0.85rem; color: var(--text-muted);">Sync Status:</div>
              <strong style="color: ${settings.isFolderConnected ? 'var(--success)' : '#64748b'}; font-size: 1.05rem;">
                ${settings.isFolderConnected ? '● Connected to Local Folder' : '○ No Folder Connected'}
              </strong>
            </div>
            <div>
              <div style="font-size: 0.85rem; color: var(--text-muted);">Last Synced:</div>
              <strong>${lastSyncStr}</strong>
            </div>
          </div>
        </div>

        <div style="display: flex; gap: 0.6rem; flex-wrap: wrap;">
          ${
            settings.isFolderConnected
              ? `
            <button id="btn-sync-now" class="btn btn-primary">
              🔄 Sync to Folder Now
            </button>
            <button id="btn-restore-folder" class="btn btn-secondary">
              📥 Restore from Folder
            </button>
            <button id="btn-disconnect-folder" class="btn btn-danger">
              Disconnect Folder
            </button>
          `
              : `
            <button id="btn-connect-folder" class="btn btn-primary btn-lg">
              📂 Connect Local Folder on Drive...
            </button>
          `
          }
        </div>
      `
          : `
        <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: var(--radius); padding: 1rem; color: #92400e; font-size: 0.9rem;">
          <strong>Notice:</strong> Your current browser does not support the File System Access API (often the case on mobile Safari / Firefox).
          All calculations are still persisted safely inside browser <strong>IndexedDB</strong>. Use the manual JSON export/import buttons below for disk backups.
        </div>
      `
      }
    </div>

    <!-- Universal JSON File Backup Card -->
    <div class="card">
      <div style="display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.75rem;">
        <span style="font-size: 1.5rem;">💾</span>
        <h2 style="font-size: 1.25rem; font-weight: 700;">Manual JSON Backup & Restore</h2>
      </div>
      <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 1.25rem;">
        Download a complete JSON snapshot of all your recipes, ingredients, and order history to your local computer, or restore from a previously downloaded file. Works on all devices.
      </p>

      <div style="display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: center;">
        <button id="btn-export-json" class="btn btn-secondary">
          ⬇️ Export JSON Backup File
        </button>

        <label class="btn btn-secondary" style="cursor: pointer; margin-bottom: 0;">
          ⬆️ Import JSON Backup File
          <input type="file" id="file-import-json" accept=".json,application/json" style="display: none;" />
        </label>
      </div>
    </div>

    <!-- Bakery Settings Card -->
    <div class="card">
      <div style="display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.75rem;">
        <span style="font-size: 1.5rem;">⚙️</span>
        <h2 style="font-size: 1.25rem; font-weight: 700;">Bakery Settings</h2>
      </div>

      <form id="settings-form" style="max-width: 480px;">
        <div class="form-group">
          <label class="form-label" for="setting-bakery-name">Bakery Business Name</label>
          <input type="text" id="setting-bakery-name" class="form-control" value="${settings.bakeryName}" />
        </div>

        <div class="form-group">
          <label class="form-label">Currency Symbol</label>
          <input type="text" class="form-control" value="₹ (Indian Rupee)" disabled />
        </div>

        <button type="submit" class="btn btn-primary">
          Save Settings
        </button>
      </form>
    </div>
  `;

  // Wire events
  container.querySelector('#btn-connect-folder')?.addEventListener('click', async () => {
    const res = await fileSyncService.connectFolder();
    if (res.success) {
      showToast(`Connected to folder: ${res.folderName}`);
      renderSyncView(container);
    } else if (res.error) {
      alert(res.error);
    }
  });

  container.querySelector('#btn-sync-now')?.addEventListener('click', async () => {
    const res = await fileSyncService.saveBackupToDisk();
    showToast(res.message);
    renderSyncView(container);
  });

  container.querySelector('#btn-restore-folder')?.addEventListener('click', async () => {
    if (confirm('This will overwrite current recipes and data with the backup file from your folder. Continue?')) {
      const res = await fileSyncService.syncFromDisk();
      showToast(res.message);
      if (res.success) renderSyncView(container);
    }
  });

  container.querySelector('#btn-disconnect-folder')?.addEventListener('click', async () => {
    if (confirm('Disconnect local folder sync? (Your data in IndexedDB remains safe).')) {
      await fileSyncService.disconnectFolder();
      showToast('Folder disconnected.');
      renderSyncView(container);
    }
  });

  container.querySelector('#btn-export-json')?.addEventListener('click', async () => {
    await fileSyncService.exportJSONFile();
    showToast('Backup file downloaded.');
  });

  const fileInput = container.querySelector('#file-import-json') as HTMLInputElement;
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    if (confirm(`Import data from "${file.name}"? This will replace your current library.`)) {
      const res = await fileSyncService.importJSONFile(file);
      showToast(res.message);
      if (res.success) {
        renderSyncView(container);
      }
    }
    fileInput.value = '';
  });

  const settingsForm = container.querySelector('#settings-form') as HTMLFormElement;
  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nameInput = container.querySelector('#setting-bakery-name') as HTMLInputElement;
    settings.bakeryName = nameInput.value.trim() || 'My Bakery';
    await dbService.saveSettings(settings);
    await fileSyncService.saveBackupToDisk();
    showToast('Settings saved.');
    // Update brand title in header if present
    const brandName = document.querySelector('#header-brand-name');
    if (brandName) brandName.textContent = settings.bakeryName;
  });
}
