import { dbService } from '../services/db';
import { fileSyncService } from '../services/fileSync';

export async function renderHomeView(container: HTMLElement): Promise<void> {
  const [recipes, ingredients, orders, settings] = await Promise.all([
    dbService.getRecipes(),
    dbService.getIngredients(),
    dbService.getOrders(),
    dbService.getSettings()
  ]);

  const isFSSupported = fileSyncService.isFileSystemAccessSupported();
  const syncStatusText = settings.isFolderConnected
    ? 'Synced to Local Drive'
    : isFSSupported
    ? 'Drive Not Connected'
    : 'Local IndexedDB (JSON Backup)';

  container.innerHTML = `
    <div class="view-header">
      <div style="display: flex; align-items: center; gap: 1rem;">
        <img src="/logo.jpg" alt="Cloud & Crust" style="width: 72px; height: 72px; border-radius: 50%; object-fit: cover; border: 2px solid #fde68a; box-shadow: var(--shadow);" />
        <div>
          <h1 class="view-title" style="margin-bottom: 0.1rem;">Cloud &amp; Crust</h1>
          <p class="view-desc" style="font-style: italic; color: #92400e; font-weight: 500;">Baked with Butter and Love • Commercial Recipe &amp; Price Calculator</p>
        </div>
      </div>
      <a href="#calculator" class="btn btn-primary btn-lg">
        🧮 New Batch Calculation
      </a>
    </div>

    <!-- Quick Stats Summary -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
      <div class="card" style="margin: 0; padding: 1rem; text-align: center;">
        <div style="font-size: 1.8rem; font-weight: 700; color: var(--primary);">${recipes.length}</div>
        <div style="font-size: 0.85rem; color: var(--text-muted); font-weight: 500;">Saved Recipes</div>
      </div>
      <div class="card" style="margin: 0; padding: 1rem; text-align: center;">
        <div style="font-size: 1.8rem; font-weight: 700; color: #0284c7;">${ingredients.length}</div>
        <div style="font-size: 0.85rem; color: var(--text-muted); font-weight: 500;">Pantry Ingredients</div>
      </div>
      <div class="card" style="margin: 0; padding: 1rem; text-align: center;">
        <div style="font-size: 1.8rem; font-weight: 700; color: #16a34a;">${orders.length}</div>
        <div style="font-size: 0.85rem; color: var(--text-muted); font-weight: 500;">Saved Orders</div>
      </div>
      <div class="card" style="margin: 0; padding: 1rem; text-align: center;">
        <div style="font-size: 1.1rem; font-weight: 700; color: ${settings.isFolderConnected ? 'var(--success)' : '#64748b'}; margin-top: 0.4rem;">
          ${settings.isFolderConnected ? '● Connected' : '○ Local DB'}
        </div>
        <div style="font-size: 0.85rem; color: var(--text-muted); font-weight: 500;">${syncStatusText}</div>
      </div>
    </div>

    <!-- Navigation Tiles -->
    <div class="tiles-grid">
      <a href="#calculator" class="tile-card">
        <div class="tile-icon">🧮</div>
        <div class="tile-title">Batch & Order Calculator</div>
        <div class="tile-desc">
          Extrapolate recipes by desired output weight or unit count with bake loss compensation. Calculate ingredient costs, add overhead & profit markup in ₹.
        </div>
        <div class="tile-badge">Start Calculation →</div>
      </a>

      <a href="#recipes" class="tile-card">
        <div class="tile-icon">📖</div>
        <div class="tile-title">Recipes & Formulas</div>
        <div class="tile-desc">
          Create and manage base recipes with ingredient ratios, unit costs, base raw weights, and bake loss percentages.
        </div>
        <div class="tile-badge">${recipes.length} Recipes Available →</div>
      </a>

      <a href="#ingredients" class="tile-card">
        <div class="tile-icon">🌾</div>
        <div class="tile-title">Ingredients Catalog</div>
        <div class="tile-desc">
          Centralized pantry inventory. Set default costs per kg, g, ml, l, or piece to auto-populate prices into recipes.
        </div>
        <div class="tile-badge">${ingredients.length} Ingredients in Catalog →</div>
      </a>

      <a href="#history" class="tile-card">
        <div class="tile-icon">📋</div>
        <div class="tile-title">Order History & Prep Lists</div>
        <div class="tile-desc">
          Review saved multi-recipe orders, quote breakdowns, and consolidated grocery prep lists for the baking shift.
        </div>
        <div class="tile-badge">${orders.length} Saved Records →</div>
      </a>

      <a href="#sync" class="tile-card">
        <div class="tile-icon">💾</div>
        <div class="tile-title">Local Drive Sync & Backup</div>
        <div class="tile-desc">
          Directly sync your recipes, catalog, and orders to a folder on your computer's local drive or download JSON backups.
        </div>
        <div class="tile-badge">Manage Storage & Folder →</div>
      </a>
    </div>
  `;
}
