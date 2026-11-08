import { dbService } from '../services/db';
import { fileSyncService } from '../services/fileSync';
import { CatalogIngredient, UnitType } from '../types';
import { formatCurrency, showToast, escapeHtml } from '../utils/ui';

export async function renderIngredientsView(container: HTMLElement): Promise<void> {
  const ingredients = await dbService.getIngredients();

  container.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="view-title">Ingredients Catalog</h1>
        <p class="view-desc">Master pantry ingredients with default pricing and units.</p>
      </div>
      <button id="btn-add-ingredient" class="btn btn-primary">
        + Add Ingredient
      </button>
    </div>

    <div class="card" style="padding: 0.75rem 1rem; margin-bottom: 1rem;">
      <input type="text" id="search-ingredients" class="form-control" placeholder="Search ingredients by name..." />
    </div>

    <div class="card" style="padding: 0;">
      <div class="table-responsive">
        <table class="table">
          <thead>
            <tr>
              <th>Ingredient Name</th>
              <th>Default Unit</th>
              <th>Cost per Unit</th>
              <th>Gram Equivalent</th>
              <th style="text-align: right;">Actions</th>
            </tr>
          </thead>
          <tbody id="ingredients-table-body">
            <!-- populated dynamically -->
          </tbody>
        </table>
      </div>
    </div>

    <!-- Modal for Add/Edit -->
    <div id="ingredient-modal" class="modal-overlay" style="display: none;">
      <div class="modal-content" style="max-width: 480px;">
        <div class="modal-header">
          <h2 id="modal-title" class="modal-title">Add Ingredient</h2>
          <button id="modal-close-btn" class="modal-close">&times;</button>
        </div>
        <form id="ingredient-form">
          <input type="hidden" id="ingredient-id" />
          <div class="form-group">
            <label class="form-label" for="ingredient-name">Ingredient Name *</label>
            <input type="text" id="ingredient-name" class="form-control" required placeholder="e.g. All-Purpose Flour" />
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="ingredient-unit">Default Unit *</label>
              <select id="ingredient-unit" class="form-control" required>
                <option value="kg">kg (Kilogram)</option>
                <option value="g">g (Gram)</option>
                <option value="ml">ml (Milliliter)</option>
                <option value="l">l (Liter)</option>
                <option value="pcs">pcs (Pieces / Eggs)</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label" for="ingredient-cost">Cost (₹) per Unit *</label>
              <input type="number" id="ingredient-cost" class="form-control" step="0.01" min="0" required placeholder="e.g. 60" />
            </div>
          </div>
          <div class="form-group" id="gram-eq-group">
            <label class="form-label" for="ingredient-gram-eq">Gram Equivalent (weight for 1 unit)</label>
            <input type="number" id="ingredient-gram-eq" class="form-control" step="0.1" min="0" placeholder="e.g. 50 for 1 egg, 1 for 1ml" />
            <span style="font-size: 0.75rem; color: var(--text-muted);">Used for scaling recipes by total weight accurately.</span>
          </div>
          <div style="display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1.5rem;">
            <button type="button" id="modal-cancel-btn" class="btn btn-secondary">Cancel</button>
            <button type="submit" class="btn btn-primary">Save Ingredient</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const tbody = container.querySelector('#ingredients-table-body') as HTMLElement;
  const searchInput = container.querySelector('#search-ingredients') as HTMLInputElement;
  const modal = container.querySelector('#ingredient-modal') as HTMLElement;
  const form = container.querySelector('#ingredient-form') as HTMLFormElement;
  const modalTitle = container.querySelector('#modal-title') as HTMLElement;

  const idInput = container.querySelector('#ingredient-id') as HTMLInputElement;
  const nameInput = container.querySelector('#ingredient-name') as HTMLInputElement;
  const unitSelect = container.querySelector('#ingredient-unit') as HTMLSelectElement;
  const costInput = container.querySelector('#ingredient-cost') as HTMLInputElement;
  const gramEqInput = container.querySelector('#ingredient-gram-eq') as HTMLInputElement;
  const gramEqGroup = container.querySelector('#gram-eq-group') as HTMLElement;

  function updateGramEqVisibility() {
    const unit = unitSelect.value;
    if (unit === 'g' || unit === 'kg') {
      gramEqGroup.style.display = 'none';
    } else {
      gramEqGroup.style.display = 'block';
    }
  }
  unitSelect.addEventListener('change', updateGramEqVisibility);

  function renderRows(items: CatalogIngredient[]) {
    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 2rem;">No ingredients found. Click "+ Add Ingredient" to start.</td></tr>`;
      return;
    }

    tbody.innerHTML = items
      .map(
        (item) => `
        <tr>
          <td><strong>${escapeHtml(item.name)}</strong></td>
          <td><span class="badge badge-slate">${item.defaultUnit}</span></td>
          <td>${formatCurrency(item.costPerUnit)} / ${item.defaultUnit}</td>
          <td>${item.gramEquivalent ? `${item.gramEquivalent}g per ${item.defaultUnit}` : '—'}</td>
          <td style="text-align: right;">
            <button class="btn btn-secondary btn-sm btn-edit" data-id="${item.id}">Edit</button>
            <button class="btn btn-danger btn-sm btn-del" data-id="${item.id}" style="margin-left: 0.3rem;">Delete</button>
          </td>
        </tr>
      `
      )
      .join('');

    tbody.querySelectorAll('.btn-edit').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.id;
        const ing = ingredients.find((i) => i.id === id);
        if (ing) openEdit(ing);
      });
    });

    tbody.querySelectorAll('.btn-del').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLElement).dataset.id;
        if (!id) return;
        if (confirm('Are you sure you want to delete this ingredient?')) {
          await dbService.deleteIngredient(id);
          const index = ingredients.findIndex((i) => i.id === id);
          if (index > -1) ingredients.splice(index, 1);
          renderRows(filterIngredients(searchInput.value));
          await fileSyncService.saveBackupToDisk();
          showToast('Ingredient deleted.');
        }
      });
    });
  }

  function filterIngredients(query: string): CatalogIngredient[] {
    const q = query.toLowerCase().trim();
    if (!q) return ingredients;
    return ingredients.filter((i) => i.name.toLowerCase().includes(q));
  }

  searchInput.addEventListener('input', () => {
    renderRows(filterIngredients(searchInput.value));
  });

  function openAdd() {
    form.reset();
    idInput.value = '';
    modalTitle.textContent = 'Add Ingredient';
    updateGramEqVisibility();
    modal.style.display = 'flex';
    nameInput.focus();
  }

  function openEdit(item: CatalogIngredient) {
    idInput.value = item.id;
    nameInput.value = item.name;
    unitSelect.value = item.defaultUnit;
    costInput.value = item.costPerUnit.toString();
    gramEqInput.value = item.gramEquivalent ? item.gramEquivalent.toString() : '';
    modalTitle.textContent = 'Edit Ingredient';
    updateGramEqVisibility();
    modal.style.display = 'flex';
    nameInput.focus();
  }

  function closeModal() {
    modal.style.display = 'none';
  }

  container.querySelector('#btn-add-ingredient')?.addEventListener('click', openAdd);
  container.querySelector('#modal-close-btn')?.addEventListener('click', closeModal);
  container.querySelector('#modal-cancel-btn')?.addEventListener('click', closeModal);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = idInput.value || `ing-${Date.now()}`;
    const name = nameInput.value.trim();
    const defaultUnit = unitSelect.value as UnitType;
    const costPerUnit = parseFloat(costInput.value) || 0;
    const gramEquivalent = gramEqInput.value ? parseFloat(gramEqInput.value) : undefined;

    const newIng: CatalogIngredient = {
      id,
      name,
      defaultUnit,
      costPerUnit,
      gramEquivalent,
      updatedAt: new Date().toISOString()
    };

    await dbService.saveIngredient(newIng);
    const existingIndex = ingredients.findIndex((i) => i.id === id);
    if (existingIndex > -1) {
      ingredients[existingIndex] = newIng;
    } else {
      ingredients.push(newIng);
    }

    closeModal();
    renderRows(filterIngredients(searchInput.value));
    await fileSyncService.saveBackupToDisk();
    showToast('Ingredient saved.');
  });

  renderRows(ingredients);
}
