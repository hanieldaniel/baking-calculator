import { dbService } from '../services/db';
import { fileSyncService } from '../services/fileSync';
import { Recipe, RecipeIngredientItem, UnitType } from '../types';
import { calculateIngredientCost, calculateItemPricing, convertCostUnit } from '../utils/calculator';
import { formatCurrency, showToast, escapeHtml } from '../utils/ui';

export async function renderRecipesView(container: HTMLElement): Promise<void> {
  const [recipes, catalogIngredients] = await Promise.all([
    dbService.getRecipes(),
    dbService.getIngredients()
  ]);

  container.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="view-title">Recipes & Formulas</h1>
        <p class="view-desc">Define base recipes with expected output and ingredients to add.</p>
      </div>
      <button id="btn-add-recipe" class="btn btn-primary">
        + Create Recipe
      </button>
    </div>

    <div class="card" style="padding: 0.75rem 1rem; margin-bottom: 1rem;">
      <input type="text" id="search-recipes" class="form-control" placeholder="Search recipes by name or category..." />
    </div>

    <div id="recipes-list" style="display: flex; flex-direction: column; gap: 1rem;">
      <!-- Populated dynamically -->
    </div>

    <!-- Recipe Editor Modal -->
    <div id="recipe-modal" class="modal-overlay" style="display: none;">
      <div class="modal-content" style="max-width: 850px;">
        <div class="modal-header">
          <h2 id="modal-title" class="modal-title">New Recipe</h2>
          <button id="modal-close-btn" class="modal-close">&times;</button>
        </div>

        <form id="recipe-form">
          <input type="hidden" id="recipe-id" />

          <div class="form-row">
            <div class="form-group" style="flex: 2;">
              <label class="form-label" for="recipe-name">Recipe Name *</label>
              <input type="text" id="recipe-name" class="form-control" required placeholder="e.g. Sourdough Boule, Chocolate Cake" />
            </div>
            <div class="form-group" style="flex: 1;">
              <label class="form-label" for="recipe-category">Category</label>
              <input type="text" id="recipe-category" class="form-control" placeholder="e.g. Breads, Cakes, Cookies" />
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="recipe-desc">Description / Notes</label>
            <input type="text" id="recipe-desc" class="form-control" placeholder="Optional notes for this recipe" />
          </div>

          <!-- Base Expected Output -->
          <div class="form-row" style="background: #f8fafc; padding: 1rem; border-radius: var(--radius); margin-bottom: 1rem;">
            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label" for="recipe-output-val">Expected Base Output *</label>
              <input type="number" id="recipe-output-val" class="form-control" step="any" min="0.01" value="1" required />
            </div>
            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label" for="recipe-output-unit">Output Unit *</label>
              <select id="recipe-output-unit" class="form-control" required>
                <option value="kg">kg (Kilograms)</option>
                <option value="pcs">pcs (Number of Pieces / Items)</option>
              </select>
            </div>
          </div>

          <!-- Ingredients Table -->
          <div style="margin: 1.25rem 0 0.5rem; display: flex; justify-content: space-between; align-items: center;">
            <label class="form-label" style="font-size: 1rem; margin: 0;">Ingredients to Add</label>
            <button type="button" id="btn-add-ingredient-row" class="btn btn-secondary btn-sm">
              + Add Ingredient Row
            </button>
          </div>

          <div class="table-responsive" style="margin-bottom: 1rem;">
            <table class="table" id="recipe-ingredients-table">
              <thead>
                <tr>
                  <th style="min-width: 180px;">Ingredient</th>
                  <th style="width: 100px;">Qty</th>
                  <th style="width: 90px;">Unit</th>
                  <th style="width: 110px;">Cost (₹)/Unit</th>
                  <th style="width: 90px;">Total (₹)</th>
                  <th style="width: 40px;"></th>
                </tr>
              </thead>
              <tbody id="recipe-ingredients-tbody">
                <!-- dynamic rows -->
              </tbody>
            </table>
          </div>

          <!-- Summary Row -->
          <div style="display: flex; justify-content: space-between; align-items: center; background: #fffbeb; padding: 0.75rem 1rem; border-radius: var(--radius); margin-bottom: 1rem; border: 1px solid #fde68a;">
            <span style="font-weight: 600; color: #92400e;">Total Ingredient Cost:</span>
            <strong id="summary-ing-cost" style="font-size: 1.15rem; color: #78350f;">₹0.00</strong>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="recipe-overhead">Default Labor / Overhead (₹)</label>
              <input type="number" id="recipe-overhead" class="form-control" step="1" min="0" value="30" />
            </div>
            <div class="form-group">
              <label class="form-label" for="recipe-markup">Default Profit Markup (%)</label>
              <input type="number" id="recipe-markup" class="form-control" step="1" min="0" value="40" />
            </div>
          </div>

          <div style="display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1.5rem;">
            <button type="button" id="modal-cancel-btn" class="btn btn-secondary">Cancel</button>
            <button type="submit" class="btn btn-primary">Save Recipe</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const listContainer = container.querySelector('#recipes-list') as HTMLElement;
  const searchInput = container.querySelector('#search-recipes') as HTMLInputElement;
  const modal = container.querySelector('#recipe-modal') as HTMLElement;
  const form = container.querySelector('#recipe-form') as HTMLFormElement;
  const modalTitle = container.querySelector('#modal-title') as HTMLElement;

  const idInput = container.querySelector('#recipe-id') as HTMLInputElement;
  const nameInput = container.querySelector('#recipe-name') as HTMLInputElement;
  const categoryInput = container.querySelector('#recipe-category') as HTMLInputElement;
  const descInput = container.querySelector('#recipe-desc') as HTMLInputElement;
  const outputValInput = container.querySelector('#recipe-output-val') as HTMLInputElement;
  const outputUnitSelect = container.querySelector('#recipe-output-unit') as HTMLSelectElement;
  const overheadInput = container.querySelector('#recipe-overhead') as HTMLInputElement;
  const markupInput = container.querySelector('#recipe-markup') as HTMLInputElement;

  const ingredientsTbody = container.querySelector('#recipe-ingredients-tbody') as HTMLElement;
  const summaryIngCost = container.querySelector('#summary-ing-cost') as HTMLElement;

  let currentIngredients: RecipeIngredientItem[] = [];

  function recalculateTotalIngCost() {
    const total = currentIngredients.reduce((acc, item) => acc + calculateIngredientCost(item), 0);
    summaryIngCost.textContent = formatCurrency(total);
  }

  function renderIngredientRows() {
    ingredientsTbody.innerHTML = '';
    currentIngredients.forEach((item, index) => {
      const tr = document.createElement('tr');
      const rowCost = calculateIngredientCost(item);

      tr.innerHTML = `
        <td>
          <input type="text" list="catalog-datalist" class="form-control ing-name" value="${escapeHtml(item.name)}" placeholder="Select or type..." />
          <datalist id="catalog-datalist">
            ${catalogIngredients.map((c) => `<option value="${escapeHtml(c.name)}">${c.name} (${formatCurrency(c.costPerUnit)}/${c.defaultUnit})</option>`).join('')}
          </datalist>
        </td>
        <td>
          <input type="number" class="form-control ing-qty" step="any" min="0" value="${item.quantity}" />
        </td>
        <td>
          <select class="form-control ing-unit">
            <option value="g" ${item.unit === 'g' ? 'selected' : ''}>g</option>
            <option value="kg" ${item.unit === 'kg' ? 'selected' : ''}>kg</option>
            <option value="ml" ${item.unit === 'ml' ? 'selected' : ''}>ml</option>
            <option value="l" ${item.unit === 'l' ? 'selected' : ''}>l</option>
            <option value="pcs" ${item.unit === 'pcs' ? 'selected' : ''}>pcs</option>
          </select>
        </td>
        <td>
          <input type="number" class="form-control ing-cost" step="0.001" min="0" value="${item.costPerUnit}" />
        </td>
        <td class="ing-row-total" style="font-weight: 600;">
          ${formatCurrency(rowCost)}
        </td>
        <td>
          <button type="button" class="btn btn-danger btn-sm ing-remove" title="Remove">&times;</button>
        </td>
      `;

      const nameEl = tr.querySelector('.ing-name') as HTMLInputElement;
      const qtyEl = tr.querySelector('.ing-qty') as HTMLInputElement;
      const unitEl = tr.querySelector('.ing-unit') as HTMLSelectElement;
      const costEl = tr.querySelector('.ing-cost') as HTMLInputElement;
      const removeBtn = tr.querySelector('.ing-remove') as HTMLButtonElement;
      const rowTotalEl = tr.querySelector('.ing-row-total') as HTMLElement;

      nameEl.addEventListener('change', () => {
        item.name = nameEl.value.trim();
        const match = catalogIngredients.find((c) => c.name.toLowerCase() === item.name.toLowerCase());
        if (match) {
          item.ingredientId = match.id;
          item.unit = match.defaultUnit;
          unitEl.value = match.defaultUnit;
          item.costPerUnit = match.costPerUnit;
          costEl.value = match.costPerUnit.toString();
          item.gramEquivalent = match.gramEquivalent;
        }
        item.costPerUnit = parseFloat(costEl.value) || 0;
        rowTotalEl.textContent = formatCurrency(calculateIngredientCost(item));
        recalculateTotalIngCost();
      });

      qtyEl.addEventListener('input', () => {
        item.quantity = parseFloat(qtyEl.value) || 0;
        rowTotalEl.textContent = formatCurrency(calculateIngredientCost(item));
        recalculateTotalIngCost();
      });

      unitEl.addEventListener('change', () => {
        const oldUnit = item.unit;
        const newUnit = unitEl.value as UnitType;
        item.unit = newUnit;
        item.costPerUnit = convertCostUnit(item.costPerUnit, oldUnit, newUnit);
        costEl.value = item.costPerUnit.toString();
        rowTotalEl.textContent = formatCurrency(calculateIngredientCost(item));
        recalculateTotalIngCost();
      });

      costEl.addEventListener('input', () => {
        item.costPerUnit = parseFloat(costEl.value) || 0;
        rowTotalEl.textContent = formatCurrency(calculateIngredientCost(item));
        recalculateTotalIngCost();
      });

      removeBtn.addEventListener('click', () => {
        currentIngredients.splice(index, 1);
        renderIngredientRows();
        recalculateTotalIngCost();
      });

      ingredientsTbody.appendChild(tr);
    });
  }

  container.querySelector('#btn-add-ingredient-row')?.addEventListener('click', () => {
    currentIngredients.push({
      id: `ri-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: '',
      quantity: 100,
      unit: 'g',
      costPerUnit: 0.05
    });
    renderIngredientRows();
    recalculateTotalIngCost();
  });

  function renderRecipeCards(items: Recipe[]) {
    if (items.length === 0) {
      listContainer.innerHTML = `
        <div class="card" style="text-align: center; padding: 3rem; color: var(--text-muted);">
          No recipes found. Click "+ Create Recipe" to add your first bakery formula.
        </div>
      `;
      return;
    }

    listContainer.innerHTML = items
      .map((recipe) => {
        const outputVal = recipe.outputValue ?? 1;
        const outputUnit = recipe.outputUnit ?? 'kg';

        const pricing = calculateItemPricing({
          scaledIngredients: recipe.ingredients,
          overheadCost: recipe.defaultOverheadCost,
          markupPercent: recipe.defaultMarkupPercent
        });

        return `
          <div class="card" style="margin: 0;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 0.5rem;">
              <div>
                <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                  <h3 style="font-size: 1.25rem; font-weight: 700; color: #0f172a;">${escapeHtml(recipe.name)}</h3>
                  ${recipe.category ? `<span class="badge badge-amber">${escapeHtml(recipe.category)}</span>` : ''}
                </div>
                ${recipe.description ? `<p style="font-size: 0.88rem; color: var(--text-muted); margin-top: 0.25rem;">${escapeHtml(recipe.description)}</p>` : ''}
              </div>
              <div style="text-align: right;">
                <div style="font-size: 1.15rem; font-weight: 700; color: var(--primary-dark);">${formatCurrency(pricing.sellingPrice)}</div>
                <div style="font-size: 0.78rem; color: var(--text-muted);">Base Price (${outputVal} ${outputUnit})</div>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.75rem; margin: 1rem 0; background: #f8fafc; padding: 0.75rem 1rem; border-radius: var(--radius); font-size: 0.85rem;">
              <div>
                <span style="color: var(--text-muted); display: block;">Expected Output:</span>
                <strong>${outputVal} ${outputUnit}</strong>
              </div>
              <div>
                <span style="color: var(--text-muted); display: block;">Ingredients:</span>
                <strong>${recipe.ingredients.length} items</strong>
              </div>
              <div>
                <span style="color: var(--text-muted); display: block;">Ingredient Cost:</span>
                <strong>${formatCurrency(pricing.ingredientCost)}</strong>
              </div>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
              <a href="#calculator" class="btn btn-primary btn-sm btn-calc" data-id="${recipe.id}">
                🧮 Scale & Calculate
              </a>
              <div style="display: flex; gap: 0.4rem;">
                <button class="btn btn-secondary btn-sm btn-edit" data-id="${recipe.id}">Edit</button>
                <button class="btn btn-secondary btn-sm btn-dup" data-id="${recipe.id}">Duplicate</button>
                <button class="btn btn-danger btn-sm btn-del" data-id="${recipe.id}">Delete</button>
              </div>
            </div>
          </div>
        `;
      })
      .join('');

    listContainer.querySelectorAll('.btn-edit').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.id;
        const recipe = recipes.find((r) => r.id === id);
        if (recipe) openEdit(recipe);
      });
    });

    listContainer.querySelectorAll('.btn-dup').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLElement).dataset.id;
        const recipe = recipes.find((r) => r.id === id);
        if (!recipe) return;

        const duplicated: Recipe = {
          ...recipe,
          id: `rec-${Date.now()}`,
          name: `${recipe.name} (Copy)`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        await dbService.saveRecipe(duplicated);
        recipes.unshift(duplicated);
        renderRecipeCards(filterRecipes(searchInput.value));
        await fileSyncService.saveBackupToDisk();
        showToast('Recipe duplicated.');
      });
    });

    listContainer.querySelectorAll('.btn-del').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLElement).dataset.id;
        if (!id) return;
        if (confirm('Delete this recipe?')) {
          await dbService.deleteRecipe(id);
          const idx = recipes.findIndex((r) => r.id === id);
          if (idx > -1) recipes.splice(idx, 1);
          renderRecipeCards(filterRecipes(searchInput.value));
          await fileSyncService.saveBackupToDisk();
          showToast('Recipe deleted.');
        }
      });
    });

    listContainer.querySelectorAll('.btn-calc').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.id;
        sessionStorage.setItem('bakemaster_selected_recipe_id', id || '');
      });
    });
  }

  function filterRecipes(query: string): Recipe[] {
    const q = query.toLowerCase().trim();
    if (!q) return recipes;
    return recipes.filter(
      (r) => r.name.toLowerCase().includes(q) || (r.category && r.category.toLowerCase().includes(q))
    );
  }

  searchInput.addEventListener('input', () => {
    renderRecipeCards(filterRecipes(searchInput.value));
  });

  function openAdd() {
    form.reset();
    idInput.value = '';
    modalTitle.textContent = 'Create New Recipe';
    outputValInput.value = '1';
    outputUnitSelect.value = 'kg';
    overheadInput.value = '30';
    markupInput.value = '40';
    currentIngredients = [
      { id: `ri-1`, name: 'Bread Flour', quantity: 500, unit: 'g', costPerUnit: 0.06 },
      { id: `ri-2`, name: 'Water', quantity: 350, unit: 'ml', costPerUnit: 0.005, gramEquivalent: 1 },
      { id: `ri-3`, name: 'Sea Salt', quantity: 10, unit: 'g', costPerUnit: 0.03 }
    ];
    renderIngredientRows();
    recalculateTotalIngCost();
    modal.style.display = 'flex';
    nameInput.focus();
  }

  function openEdit(recipe: Recipe) {
    idInput.value = recipe.id;
    nameInput.value = recipe.name;
    categoryInput.value = recipe.category || '';
    descInput.value = recipe.description || '';
    outputValInput.value = (recipe.outputValue ?? 1).toString();
    outputUnitSelect.value = recipe.outputUnit ?? 'kg';
    overheadInput.value = (recipe.defaultOverheadCost ?? 30).toString();
    markupInput.value = (recipe.defaultMarkupPercent ?? 40).toString();
    modalTitle.textContent = 'Edit Recipe';

    currentIngredients = JSON.parse(JSON.stringify(recipe.ingredients));
    renderIngredientRows();
    recalculateTotalIngCost();
    modal.style.display = 'flex';
    nameInput.focus();
  }

  function closeModal() {
    modal.style.display = 'none';
  }

  container.querySelector('#btn-add-recipe')?.addEventListener('click', openAdd);
  container.querySelector('#modal-close-btn')?.addEventListener('click', closeModal);
  container.querySelector('#modal-cancel-btn')?.addEventListener('click', closeModal);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = idInput.value || `rec-${Date.now()}`;
    const name = nameInput.value.trim();
    const category = categoryInput.value.trim();
    const description = descInput.value.trim();
    const outputValue = parseFloat(outputValInput.value) || 1;
    const outputUnit = outputUnitSelect.value as 'kg' | 'pcs';
    const defaultOverheadCost = parseFloat(overheadInput.value) || 0;
    const defaultMarkupPercent = parseFloat(markupInput.value) || 0;

    const savedRecipe: Recipe = {
      id,
      name,
      category,
      description,
      outputValue,
      outputUnit,
      defaultOverheadCost,
      defaultMarkupPercent,
      ingredients: currentIngredients,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await dbService.saveRecipe(savedRecipe);
    const existingIdx = recipes.findIndex((r) => r.id === id);
    if (existingIdx > -1) {
      recipes[existingIdx] = savedRecipe;
    } else {
      recipes.unshift(savedRecipe);
    }

    closeModal();
    renderRecipeCards(filterRecipes(searchInput.value));
    await fileSyncService.saveBackupToDisk();
    showToast('Recipe saved successfully.');
  });

  renderRecipeCards(recipes);
}
