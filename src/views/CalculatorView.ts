import { dbService } from '../services/db';
import { fileSyncService } from '../services/fileSync';
import { Recipe, OrderItem, Order } from '../types';
import {
  calculateScaleMultiplier,
  scaleIngredients,
  calculateIngredientCost,
  calculateItemPricing,
  aggregateOrderIngredients
} from '../utils/calculator';
import { formatCurrency, showToast, escapeHtml } from '../utils/ui';

interface ActiveBatchItem {
  id: string;
  recipe: Recipe;
  targetOutputValue: number;
  overheadCost: number;
  markupPercent: number;
  soldAtPrice?: number;
}

export async function renderCalculatorView(container: HTMLElement): Promise<void> {
  const recipes = await dbService.getRecipes();

  // Check if a recipe was chosen from the recipes view
  const preselectedRecipeId = sessionStorage.getItem('bakemaster_selected_recipe_id');
  sessionStorage.removeItem('bakemaster_selected_recipe_id');

  const activeBatch: ActiveBatchItem[] = [];

  function addRecipeToBatch(recipe: Recipe) {
    activeBatch.push({
      id: `batch-item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      recipe,
      targetOutputValue: recipe.outputValue ?? 1,
      overheadCost: recipe.defaultOverheadCost || 30,
      markupPercent: recipe.defaultMarkupPercent || 40
    });
  }

  if (preselectedRecipeId) {
    const matched = recipes.find((r) => r.id === preselectedRecipeId);
    if (matched) addRecipeToBatch(matched);
  }

  container.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="view-title">Recipe Calculator</h1>
        <p class="view-desc">Enter expected output in Kgs or Pieces to extrapolate ingredients and calculate price.</p>
      </div>
      <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
        <select id="select-add-recipe" class="form-control" style="width: auto; min-width: 220px;">
          <option value="">+ Add Recipe to this Calculation...</option>
          ${recipes.map((r) => `<option value="${r.id}">${escapeHtml(r.name)} (${r.outputValue ?? 1} ${r.outputUnit ?? 'kg'})</option>`).join('')}
        </select>
        <button id="btn-clear-batch" class="btn btn-secondary btn-sm">Clear</button>
      </div>
    </div>

    <!-- Container for active recipe cards -->
    <div id="batch-items-container" style="display: flex; flex-direction: column; gap: 1.5rem;">
      <!-- Populated dynamically -->
    </div>

    <!-- Order Aggregation & Price Total Summary Card -->
    <div class="card" id="order-summary-card" style="margin-top: 1.5rem; border-top: 3px solid var(--primary); display: none;">
      <h2 style="font-size: 1.3rem; font-weight: 700; margin-bottom: 0.75rem; color: #0f172a;">
        Total Calculation & Prep Summary
      </h2>

      <!-- Consolidated Grocery / Prep List -->
      <div style="margin-bottom: 1.25rem;">
        <h3 style="font-size: 0.95rem; font-weight: 600; color: #475569; margin-bottom: 0.5rem;">
          🛒 Ingredients to be Added (Total)
        </h3>
        <div class="table-responsive">
          <table class="table">
            <thead>
              <tr>
                <th>Ingredient</th>
                <th>Quantity</th>
                <th>Cost (₹)</th>
              </tr>
            </thead>
            <tbody id="aggregated-ingredients-tbody">
              <!-- populated dynamically -->
            </tbody>
          </table>
        </div>
      </div>

      <!-- Financial Total Box -->
      <div class="summary-box" style="background: #f0fdf4; border-color: #bbf7d0;">
        <div class="summary-title" style="color: #166534; font-size: 1rem;">Price Calculation Breakdown</div>
        <div class="summary-row">
          <span>Total Ingredients Cost:</span>
          <strong id="order-total-ingredients">₹0.00</strong>
        </div>
        <div class="summary-row">
          <span>Total Labor / Overhead:</span>
          <strong id="order-total-overhead">₹0.00</strong>
        </div>
        <div class="summary-row">
          <span>Total Cost:</span>
          <strong id="order-total-cost">₹0.00</strong>
        </div>
        <div class="summary-row">
          <span>Target Profit Margin:</span>
          <strong id="order-total-profit" style="color: #16a34a;">₹0.00 (0%)</strong>
        </div>
        <div class="summary-row total" style="color: #14532d; border-color: #86efac; font-size: 1.25rem;">
          <span>CALCULATED TARGET PRICE:</span>
          <span id="order-final-price">₹0.00</span>
        </div>

        <!-- Optional Sold At Price input -->
        <div class="summary-row" style="align-items: center; padding-top: 0.75rem; margin-top: 0.5rem; border-top: 1px dashed #bbf7d0;">
          <div>
            <span style="font-weight: 700; color: #166534; font-size: 0.95rem;">Sold At Price (₹) (Optional):</span>
            <div style="font-size: 0.75rem; color: #4b5563;">Enter actual price charged to compare with target</div>
          </div>
          <div style="max-width: 180px;">
            <input type="number" id="order-sold-at-price" class="form-control" step="any" min="0" placeholder="Optional" style="font-weight: 700; text-align: right; font-size: 1.05rem;" />
          </div>
        </div>

        <!-- Target Comparison Row -->
        <div id="quota-comparison-row" class="summary-row" style="display: none; padding-top: 0.6rem; margin-top: 0.4rem; border-top: 1px solid #bbf7d0; font-size: 0.95rem; align-items: center;">
          <span style="font-weight: 700;">Target Comparison:</span>
          <div id="quota-badge" style="font-weight: 700; text-align: right;"></div>
        </div>
      </div>

      <!-- Save Order Section -->
      <div style="margin-top: 1.25rem; display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: flex-end;">
        <div class="form-group" style="flex: 2; min-width: 200px; margin-bottom: 0;">
          <label class="form-label" for="order-title">Batch Name / Reference</label>
          <input type="text" id="order-title" class="form-control" placeholder="e.g. 5kg Sourdough Order" />
        </div>
        <div class="form-group" style="flex: 1; min-width: 160px; margin-bottom: 0;">
          <label class="form-label" for="order-delivery-date">Delivery Date</label>
          <input type="date" id="order-delivery-date" class="form-control" />
        </div>
        <button id="btn-save-order" class="btn btn-primary btn-lg">
          💾 Save to History
        </button>
        <button id="btn-print-order" class="btn btn-secondary btn-lg">
          🖨️ Print Prep Sheet
        </button>
      </div>
    </div>
  `;

  const itemsContainer = container.querySelector('#batch-items-container') as HTMLElement;
  const selectAddRecipe = container.querySelector('#select-add-recipe') as HTMLSelectElement;
  const btnClearBatch = container.querySelector('#btn-clear-batch') as HTMLButtonElement;
  const summaryCard = container.querySelector('#order-summary-card') as HTMLElement;
  const aggregatedTbody = container.querySelector('#aggregated-ingredients-tbody') as HTMLElement;

  const orderTotalIngEl = container.querySelector('#order-total-ingredients') as HTMLElement;
  const orderTotalOverheadEl = container.querySelector('#order-total-overhead') as HTMLElement;
  const orderTotalCostEl = container.querySelector('#order-total-cost') as HTMLElement;
  const orderTotalProfitEl = container.querySelector('#order-total-profit') as HTMLElement;
  const orderFinalPriceEl = container.querySelector('#order-final-price') as HTMLElement;

  const orderSoldAtPriceInput = container.querySelector('#order-sold-at-price') as HTMLInputElement;
  const quotaComparisonRow = container.querySelector('#quota-comparison-row') as HTMLElement;
  const quotaBadge = container.querySelector('#quota-badge') as HTMLElement;

  const orderTitleInput = container.querySelector('#order-title') as HTMLInputElement;
  const btnSaveOrder = container.querySelector('#btn-save-order') as HTMLButtonElement;
  const btnPrintOrder = container.querySelector('#btn-print-order') as HTMLButtonElement;

  function calculateSingleItem(item: ActiveBatchItem): OrderItem {
    const baseOutput = item.recipe.outputValue ?? 1;
    const outputUnit = item.recipe.outputUnit ?? 'kg';
    const scaleMultiplier = calculateScaleMultiplier(baseOutput, item.targetOutputValue);
    const scaledIngredients = scaleIngredients(item.recipe.ingredients, scaleMultiplier);
    const pricing = calculateItemPricing({
      scaledIngredients,
      overheadCost: item.overheadCost,
      markupPercent: item.markupPercent,
      targetUnits: outputUnit === 'pcs' ? item.targetOutputValue : undefined
    });

    return {
      recipeId: item.recipe.id,
      recipeName: item.recipe.name,
      outputValue: item.targetOutputValue,
      outputUnit,
      scaleMultiplier,
      scaledIngredients,
      ingredientCost: pricing.ingredientCost,
      overheadCost: pricing.overheadCost,
      markupPercent: item.markupPercent,
      totalCost: pricing.totalCost,
      sellingPrice: pricing.sellingPrice,
      unitPrice: pricing.unitPrice,
      soldAtPrice: item.soldAtPrice
    };
  }

  function updateCardCalculations(card: HTMLElement, item: ActiveBatchItem) {
    const calculated = calculateSingleItem(item);
    const outputUnit = item.recipe.outputUnit ?? 'kg';

    const multiplierEl = card.querySelector('.item-multiplier') as HTMLElement;
    if (multiplierEl) multiplierEl.textContent = `${calculated.scaleMultiplier.toFixed(2)}x`;

    const headingEl = card.querySelector('.item-ingredients-heading') as HTMLElement;
    if (headingEl) {
      headingEl.textContent = `⚖️ Ingredients to be Added (${item.targetOutputValue} ${outputUnit})`;
    }

    const tbody = card.querySelector('.item-ingredients-tbody') as HTMLElement;
    if (tbody) {
      tbody.innerHTML = calculated.scaledIngredients
        .map(
          (ing) => `
        <tr>
          <td><strong>${escapeHtml(ing.name)}</strong></td>
          <td><strong style="color: #0f172a; font-size: 0.98rem;">${ing.quantity}</strong></td>
          <td><span class="badge badge-slate">${ing.unit}</span></td>
          <td>${formatCurrency(ing.costPerUnit)}</td>
          <td style="text-align: right; font-weight: 600;">${formatCurrency(calculateIngredientCost(ing))}</td>
        </tr>
      `
        )
        .join('');
    }

    const ingCostEl = card.querySelector('.item-ing-cost') as HTMLElement;
    if (ingCostEl) ingCostEl.textContent = formatCurrency(calculated.ingredientCost);

    const priceEl = card.querySelector('.item-selling-price') as HTMLElement;
    if (priceEl) priceEl.textContent = formatCurrency(calculated.sellingPrice);

    const unitPriceEl = card.querySelector('.item-unit-price-desc') as HTMLElement;
    if (unitPriceEl) {
      if (outputUnit === 'pcs' && calculated.unitPrice) {
        unitPriceEl.textContent = `${formatCurrency(calculated.unitPrice)} per piece`;
        unitPriceEl.style.display = 'inline';
      } else if (outputUnit === 'kg' && item.targetOutputValue > 0) {
        unitPriceEl.textContent = `${formatCurrency(calculated.sellingPrice / item.targetOutputValue)} / kg`;
        unitPriceEl.style.display = 'inline';
      } else {
        unitPriceEl.style.display = 'none';
      }
    }

    // Quota status on the recipe card
    const quotaStatusEl = card.querySelector('.item-quota-status') as HTMLElement;
    if (quotaStatusEl) {
      if (typeof item.soldAtPrice === 'number' && item.soldAtPrice > 0) {
        const diff = Math.round((item.soldAtPrice - calculated.sellingPrice) * 100) / 100;
        const pct = calculated.sellingPrice > 0 ? Math.round((diff / calculated.sellingPrice) * 100) : 0;
        quotaStatusEl.style.display = 'block';
        if (diff >= 0) {
          quotaStatusEl.style.color = '#15803d';
          quotaStatusEl.textContent = `✓ +${formatCurrency(diff)} (+${pct}%) Target Met`;
        } else {
          quotaStatusEl.style.color = '#b91c1c';
          quotaStatusEl.textContent = `⚠️ -${formatCurrency(Math.abs(diff))} (${pct}%) Below Target`;
        }
      } else {
        quotaStatusEl.style.display = 'none';
      }
    }
  }

  function updateOrderSummary() {
    const calculatedOrderItems = activeBatch.map(calculateSingleItem);

    const aggregated = aggregateOrderIngredients(calculatedOrderItems);
    aggregatedTbody.innerHTML = aggregated
      .map(
        (agg) => `
      <tr>
        <td><strong>${escapeHtml(agg.name)}</strong></td>
        <td><strong>${agg.quantity.toLocaleString()} ${agg.unit}</strong></td>
        <td>${formatCurrency(agg.totalCost)}</td>
      </tr>
    `
      )
      .join('');

    const totalIngCost = calculatedOrderItems.reduce((acc, i) => acc + i.ingredientCost, 0);
    const totalOverhead = calculatedOrderItems.reduce((acc, i) => acc + i.overheadCost, 0);
    const totalCost = Math.round((totalIngCost + totalOverhead) * 100) / 100;
    const finalPrice = Math.round(calculatedOrderItems.reduce((acc, i) => acc + i.sellingPrice, 0) * 100) / 100;
    const profitAmount = Math.round((finalPrice - totalCost) * 100) / 100;
    const profitPercent = totalCost > 0 ? Math.round((profitAmount / totalCost) * 100) : 0;

    orderTotalIngEl.textContent = formatCurrency(totalIngCost);
    orderTotalOverheadEl.textContent = formatCurrency(totalOverhead);
    orderTotalCostEl.textContent = formatCurrency(totalCost);
    orderTotalProfitEl.textContent = `${formatCurrency(profitAmount)} (${profitPercent}%)`;
    orderFinalPriceEl.textContent = formatCurrency(finalPrice);

    // Quota comparison check
    const getItemEffectiveSold = (i: OrderItem) =>
      typeof i.soldAtPrice === 'number' && i.soldAtPrice > 0 ? i.soldAtPrice : i.sellingPrice;

    const itemsSoldSum = Math.round(
      calculatedOrderItems.reduce((acc, i) => acc + getItemEffectiveSold(i), 0) * 100
    ) / 100;

    const hasAnyCustomSoldPrice = calculatedOrderItems.some(
      (i) => typeof i.soldAtPrice === 'number' && i.soldAtPrice > 0
    );

    // If user is not currently typing in orderSoldAtPriceInput, auto-sync value from items
    if (orderSoldAtPriceInput && document.activeElement !== orderSoldAtPriceInput) {
      if (hasAnyCustomSoldPrice) {
        orderSoldAtPriceInput.value = itemsSoldSum.toString();
      } else {
        orderSoldAtPriceInput.value = '';
        orderSoldAtPriceInput.placeholder = `Calculated: ${formatCurrency(finalPrice)}`;
      }
    }

    const manualOrderSoldPrice = orderSoldAtPriceInput && orderSoldAtPriceInput.value ? parseFloat(orderSoldAtPriceInput.value) : undefined;
    const effectiveSoldPrice = manualOrderSoldPrice ?? (hasAnyCustomSoldPrice ? itemsSoldSum : undefined);

    if (effectiveSoldPrice !== undefined && effectiveSoldPrice > 0) {
      const diff = Math.round((effectiveSoldPrice - finalPrice) * 100) / 100;
      const pct = finalPrice > 0 ? Math.round((diff / finalPrice) * 100) : 0;
      const actualProfit = Math.round((effectiveSoldPrice - totalCost) * 100) / 100;
      const actualMarginPct = totalCost > 0 ? Math.round((actualProfit / totalCost) * 100) : 0;

      quotaComparisonRow.style.display = 'flex';
      if (diff >= 0) {
        quotaBadge.innerHTML = `
          <div style="display: inline-block; background: #dcfce7; color: #15803d; padding: 0.2rem 0.6rem; border-radius: 9999px;">
            ✓ Target Met: +${formatCurrency(diff)} (+${pct}%)
          </div>
          <div style="font-size: 0.8rem; font-weight: 500; color: #166534; margin-top: 0.25rem;">
            Actual Profit: ${formatCurrency(actualProfit)} (${actualMarginPct}%)
          </div>
        `;
      } else {
        quotaBadge.innerHTML = `
          <div style="display: inline-block; background: #fee2e2; color: #b91c1c; padding: 0.2rem 0.6rem; border-radius: 9999px;">
            ⚠️ Below Target: -${formatCurrency(Math.abs(diff))} (${pct}%)
          </div>
          <div style="font-size: 0.8rem; font-weight: 500; color: #991b1b; margin-top: 0.25rem;">
            Actual Profit: ${formatCurrency(actualProfit)} (${actualMarginPct}%)
          </div>
        `;
      }
    } else {
      quotaComparisonRow.style.display = 'none';
    }
  }

  orderSoldAtPriceInput?.addEventListener('input', () => {
    updateOrderSummary();
  });

  function renderBatchStructure() {
    if (activeBatch.length === 0) {
      itemsContainer.innerHTML = `
        <div class="card" style="text-align: center; padding: 3rem; color: var(--text-muted);">
          No recipes added yet. Select a recipe from the dropdown above to calculate.
        </div>
      `;
      summaryCard.style.display = 'none';
      return;
    }

    summaryCard.style.display = 'block';
    itemsContainer.innerHTML = '';

    activeBatch.forEach((item, index) => {
      const baseOutput = item.recipe.outputValue ?? 1;
      const outputUnit = item.recipe.outputUnit ?? 'kg';

      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.itemId = item.id;

      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 0.75rem; margin-bottom: 1rem;">
          <div>
            <h3 style="font-size: 1.25rem; font-weight: 700; color: #0f172a;">${escapeHtml(item.recipe.name)}</h3>
            <span style="font-size: 0.85rem; color: var(--text-muted);">
              Base recipe yields: <strong>${baseOutput} ${outputUnit}</strong>
            </span>
          </div>
          <button type="button" class="btn btn-danger btn-sm btn-remove-item" title="Remove">&times; Remove</button>
        </div>

        <!-- Expected Output Input -->
        <div class="form-row" style="background: #f8fafc; padding: 1rem; border-radius: var(--radius); margin-bottom: 1rem; align-items: center;">
          <div class="form-group" style="margin-bottom: 0; flex: 2;">
            <label class="form-label" style="font-size: 0.95rem; font-weight: 700; color: #0f172a;">
              Expected Output (${outputUnit === 'kg' ? 'Kgs' : 'Pieces'}) *
            </label>
            <input type="number" class="form-control item-target-output" step="any" min="0.01" value="${item.targetOutputValue}" style="font-size: 1.1rem; font-weight: 600;" />
          </div>

          <div class="form-group" style="margin-bottom: 0; flex: 1;">
            <label class="form-label">Scale Multiplier</label>
            <div class="item-multiplier" style="padding: 0.55rem 0.8rem; background: #ffffff; border: 1px solid var(--border); border-radius: var(--radius); font-weight: 700; color: var(--primary); font-size: 1.1rem;">
              1.00x
            </div>
          </div>
        </div>

        <!-- Ingredients Table to be added -->
        <h4 class="item-ingredients-heading" style="font-size: 0.95rem; font-weight: 600; color: #475569; margin-bottom: 0.5rem;">
          ⚖️ Ingredients to be Added (${item.targetOutputValue} ${outputUnit})
        </h4>
        <div class="table-responsive" style="margin-bottom: 1rem;">
          <table class="table" style="table-layout: fixed; width: 100%;">
            <colgroup>
              <col style="width: 38%;">
              <col style="width: 18%;">
              <col style="width: 14%;">
              <col style="width: 15%;">
              <col style="width: 15%;">
            </colgroup>
            <thead>
              <tr>
                <th>Ingredient</th>
                <th>Quantity to Add</th>
                <th>Unit</th>
                <th>Cost (₹)/Unit</th>
                <th style="text-align: right;">Total Cost (₹)</th>
              </tr>
            </thead>
            <tbody class="item-ingredients-tbody">
              <!-- dynamic rows -->
            </tbody>
          </table>
        </div>

        <!-- Pricing Controls -->
        <div class="form-row" style="background: #fffbeb; padding: 1rem; border-radius: var(--radius); border: 1px solid #fef3c7;">
          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label">Ingredient Cost</label>
            <div class="item-ing-cost" style="font-size: 1.15rem; font-weight: 700; color: #92400e; padding-top: 0.2rem;">
              ₹0.00
            </div>
          </div>
          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label">Labor / Overhead (₹)</label>
            <input type="number" class="form-control item-overhead" step="5" min="0" value="${item.overheadCost}" />
          </div>
          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label">Profit Markup (%)</label>
            <input type="number" class="form-control item-markup" step="5" min="0" value="${item.markupPercent}" />
          </div>
          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label">Target Price</label>
            <div class="item-selling-price" style="font-size: 1.3rem; font-weight: 700; color: var(--primary-dark); padding-top: 0.15rem;">
              ₹0.00
            </div>
            <span class="item-unit-price-desc" style="font-size: 0.8rem; color: var(--text-muted);"></span>
          </div>
          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label">Sold At Price (₹) (Optional)</label>
            <input type="number" class="form-control item-sold-at" step="any" min="0" placeholder="Optional" value="${item.soldAtPrice ?? ''}" />
            <div class="item-quota-status" style="font-size: 0.75rem; font-weight: 700; margin-top: 0.2rem; display: none;"></div>
          </div>
        </div>
      `;

      const targetOutputInput = card.querySelector('.item-target-output') as HTMLInputElement;
      const overheadIn = card.querySelector('.item-overhead') as HTMLInputElement;
      const markupIn = card.querySelector('.item-markup') as HTMLInputElement;
      const soldAtIn = card.querySelector('.item-sold-at') as HTMLInputElement;
      const removeBtn = card.querySelector('.btn-remove-item') as HTMLButtonElement;

      targetOutputInput?.addEventListener('input', () => {
        item.targetOutputValue = parseFloat(targetOutputInput.value) || 0;
        updateCardCalculations(card, item);
        updateOrderSummary();
      });

      overheadIn.addEventListener('input', () => {
        item.overheadCost = parseFloat(overheadIn.value) || 0;
        updateCardCalculations(card, item);
        updateOrderSummary();
      });

      markupIn.addEventListener('input', () => {
        item.markupPercent = parseFloat(markupIn.value) || 0;
        updateCardCalculations(card, item);
        updateOrderSummary();
      });

      soldAtIn?.addEventListener('input', () => {
        const val = parseFloat(soldAtIn.value);
        item.soldAtPrice = !isNaN(val) && val > 0 ? val : undefined;
        updateCardCalculations(card, item);
        updateOrderSummary();
      });

      removeBtn.addEventListener('click', () => {
        activeBatch.splice(index, 1);
        renderBatchStructure();
      });

      updateCardCalculations(card, item);
      itemsContainer.appendChild(card);
    });

    updateOrderSummary();
  }

  selectAddRecipe.addEventListener('change', () => {
    const id = selectAddRecipe.value;
    if (!id) return;
    const found = recipes.find((r) => r.id === id);
    if (found) {
      addRecipeToBatch(found);
      selectAddRecipe.value = '';
      renderBatchStructure();
    }
  });

  btnClearBatch.addEventListener('click', () => {
    if (activeBatch.length > 0 && confirm('Clear all items from this calculation?')) {
      activeBatch.length = 0;
      renderBatchStructure();
    }
  });

  btnSaveOrder.addEventListener('click', async () => {
    if (activeBatch.length === 0) {
      alert('Add at least one recipe before saving.');
      return;
    }

    const calculatedOrderItems = activeBatch.map(calculateSingleItem);
    const aggregated = aggregateOrderIngredients(calculatedOrderItems);
    const totalIngCost = calculatedOrderItems.reduce((acc, i) => acc + i.ingredientCost, 0);
    const totalOverhead = calculatedOrderItems.reduce((acc, i) => acc + i.overheadCost, 0);
    const totalCost = Math.round((totalIngCost + totalOverhead) * 100) / 100;
    const finalPrice = Math.round(calculatedOrderItems.reduce((acc, i) => acc + i.sellingPrice, 0) * 100) / 100;

    const getItemEffectiveSold = (i: OrderItem) =>
      typeof i.soldAtPrice === 'number' && i.soldAtPrice > 0 ? i.soldAtPrice : i.sellingPrice;
    const itemsSoldSum = Math.round(
      calculatedOrderItems.reduce((acc, i) => acc + getItemEffectiveSold(i), 0) * 100
    ) / 100;
    const hasItemSold = calculatedOrderItems.some((i) => typeof i.soldAtPrice === 'number' && i.soldAtPrice > 0);
    const manualSoldAt = orderSoldAtPriceInput && orderSoldAtPriceInput.value ? parseFloat(orderSoldAtPriceInput.value) : undefined;
    const effectiveSoldAtPrice = manualSoldAt ?? (hasItemSold ? itemsSoldSum : undefined);
    const quotaDifference = effectiveSoldAtPrice !== undefined ? Math.round((effectiveSoldAtPrice - finalPrice) * 100) / 100 : undefined;

    const deliveryDateInput = container.querySelector('#order-delivery-date') as HTMLInputElement;
    const deliveryDate = deliveryDateInput?.value || undefined;

    const dateStr = new Date().toISOString();
    const orderNum = `ORD-${Date.now().toString().slice(-6)}`;
    const title = orderTitleInput.value.trim() || `Batch #${orderNum}`;

    const newOrder: Order = {
      id: `order-${Date.now()}`,
      orderNumber: orderNum,
      title,
      customerName: orderTitleInput.value.trim(),
      date: dateStr,
      deliveryDate,
      items: calculatedOrderItems,
      aggregatedIngredients: aggregated,
      totalIngredientCost: totalIngCost,
      totalOverheadCost: totalOverhead,
      totalCost,
      totalSellingPrice: finalPrice,
      totalSoldAtPrice: effectiveSoldAtPrice,
      quotaDifference
    };

    await dbService.saveOrder(newOrder);
    await fileSyncService.saveBackupToDisk();
    showToast(`Saved ${orderNum} to history and synced.`);
    orderTitleInput.value = '';
    if (deliveryDateInput) deliveryDateInput.value = '';
    window.location.hash = '#history';
  });

  btnPrintOrder.addEventListener('click', () => {
    window.print();
  });

  renderBatchStructure();
}
