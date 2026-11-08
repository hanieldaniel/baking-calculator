import { dbService } from '../services/db';
import { fileSyncService } from '../services/fileSync';
import { Order } from '../types';
import { formatCurrency, showToast, escapeHtml } from '../utils/ui';

export async function renderHistoryView(container: HTMLElement): Promise<void> {
  const orders = await dbService.getOrders();

  container.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="view-title">Order History & Calculations Log</h1>
        <p class="view-desc">Past production batches, quotes, and consolidated ingredient prep lists.</p>
      </div>
      <a href="#calculator" class="btn btn-primary">
        + New Calculation
      </a>
    </div>

    <div class="card" style="padding: 0.75rem 1rem; margin-bottom: 1rem;">
      <input type="text" id="search-history" class="form-control" placeholder="Search orders by title or order #..." />
    </div>

    <div id="orders-list-container" style="display: flex; flex-direction: column; gap: 1rem;">
      <!-- Populated dynamically -->
    </div>
  `;

  const listContainer = container.querySelector('#orders-list-container') as HTMLElement;
  const searchInput = container.querySelector('#search-history') as HTMLInputElement;

  function renderOrders(items: Order[]) {
    if (items.length === 0) {
      listContainer.innerHTML = `
        <div class="card" style="text-align: center; padding: 3rem; color: var(--text-muted);">
          No saved calculations or orders found. Use the Batch Calculator to create and save orders.
        </div>
      `;
      return;
    }

    listContainer.innerHTML = items
      .map((order) => {
        const dateFormatted = new Date(order.date).toLocaleString('en-IN', {
          dateStyle: 'medium',
          timeStyle: 'short'
        });

        const recipesSummary = order.items.map((i) => `${i.recipeName} (${i.scaleMultiplier.toFixed(2)}x)`).join(', ');
        const quotaDiff = order.quotaDifference;
        const hasQuota = typeof quotaDiff === 'number';

        return `
          <div class="card order-card" style="margin: 0;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 0.5rem;">
              <div>
                <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                  <span class="badge badge-amber" style="font-size: 0.85rem;">${escapeHtml(order.orderNumber)}</span>
                  <h3 style="font-size: 1.15rem; font-weight: 700; color: #0f172a;">${escapeHtml(order.title)}</h3>
                </div>
                <div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 0.25rem;">
                  📅 ${dateFormatted} • ${order.items.length} recipe(s)
                </div>
                <div style="font-size: 0.85rem; color: #334155; margin-top: 0.35rem;">
                  <strong>Recipes:</strong> ${escapeHtml(recipesSummary)}
                </div>
              </div>
              <div style="text-align: right;">
                <div style="font-size: 1.35rem; font-weight: 700; color: var(--primary-dark);">
                  ${formatCurrency(order.totalSoldAtPrice ?? order.totalSellingPrice)}
                </div>
                <div style="font-size: 0.78rem; color: var(--text-muted);">
                  ${order.totalSoldAtPrice ? `Actual Sold (Target: ${formatCurrency(order.totalSellingPrice)})` : 'Calculated Price'}
                </div>
                ${
                  hasQuota
                    ? `<div style="font-size: 0.78rem; font-weight: 700; color: ${quotaDiff >= 0 ? '#15803d' : '#b91c1c'}; margin-top: 0.2rem;">
                        ${quotaDiff >= 0 ? `✓ +${formatCurrency(quotaDiff)} Target Met` : `⚠️ -${formatCurrency(Math.abs(quotaDiff))} Below Target`}
                      </div>`
                    : ''
                }
              </div>
            </div>

            <!-- Expandable Details -->
            <div class="order-details" id="details-${order.id}" style="display: none; margin-top: 1rem; border-top: 1px dashed var(--border); padding-top: 1rem;">
              <!-- Recipes in order -->
              <h4 style="font-size: 0.95rem; font-weight: 700; color: #1e293b; margin-bottom: 0.5rem;">Recipes in this Order:</h4>
              <div style="display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1rem;">
                ${order.items
                  .map(
                    (item) => `
                  <div style="background: #f8fafc; padding: 0.75rem 1rem; border-radius: var(--radius); border: 1px solid var(--border); font-size: 0.85rem;">
                    <div style="display: flex; justify-content: space-between; font-weight: 700;">
                      <span>${escapeHtml(item.recipeName)}</span>
                      <span>${formatCurrency(item.soldAtPrice ?? item.sellingPrice)}</span>
                    </div>
                    <div style="color: var(--text-muted); font-size: 0.8rem; margin: 0.2rem 0;">
                      Scaled: ${item.scaleMultiplier.toFixed(2)}x • Output: ${item.outputValue ?? ''} ${item.outputUnit ?? ''} • Target: ${formatCurrency(item.sellingPrice)} ${item.soldAtPrice ? `(Sold @ ${formatCurrency(item.soldAtPrice)})` : ''}
                    </div>
                    <div style="font-size: 0.8rem; color: #475569;">
                      Ingredients: ${item.scaledIngredients.map((ing) => `${ing.name}: ${ing.quantity}${ing.unit}`).join(', ')}
                    </div>
                  </div>
                `
                  )
                  .join('')}
              </div>

              <!-- Aggregated Prep Requirements -->
              <h4 style="font-size: 0.95rem; font-weight: 700; color: #1e293b; margin-bottom: 0.5rem;">Aggregated Production / Grocery List:</h4>
              <div class="table-responsive" style="margin-bottom: 1rem;">
                <table class="table">
                  <thead>
                    <tr>
                      <th>Ingredient</th>
                      <th>Quantity</th>
                      <th>Cost (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${order.aggregatedIngredients
                      .map(
                        (agg) => `
                      <tr>
                        <td><strong>${escapeHtml(agg.name)}</strong></td>
                        <td><strong>${agg.quantity} ${agg.unit}</strong></td>
                        <td>${formatCurrency(agg.totalCost)}</td>
                      </tr>
                    `
                      )
                      .join('')}
                  </tbody>
                </table>
              </div>

              <!-- Order Financials -->
              <div class="summary-box" style="margin: 0 0 1rem;">
                <div class="summary-row">
                  <span>Ingredients Cost:</span>
                  <strong>${formatCurrency(order.totalIngredientCost)}</strong>
                </div>
                <div class="summary-row">
                  <span>Overhead / Labor:</span>
                  <strong>${formatCurrency(order.totalOverheadCost)}</strong>
                </div>
                <div class="summary-row">
                  <span>Total Cost:</span>
                  <strong>${formatCurrency(order.totalCost)}</strong>
                </div>
                <div class="summary-row">
                  <span>Calculated Target Price:</span>
                  <strong>${formatCurrency(order.totalSellingPrice)}</strong>
                </div>
                ${
                  order.totalSoldAtPrice !== undefined
                    ? `
                  <div class="summary-row total" style="color: ${hasQuota && quotaDiff >= 0 ? '#14532d' : '#7f1d1d'};">
                    <span>Actual Sold At Price:</span>
                    <span>${formatCurrency(order.totalSoldAtPrice)}</span>
                  </div>
                  ${
                    hasQuota
                      ? `
                    <div class="summary-row" style="font-size: 0.85rem; font-weight: 700; color: ${quotaDiff >= 0 ? '#15803d' : '#b91c1c'};">
                      <span>Target Variance:</span>
                      <span>${quotaDiff >= 0 ? `+${formatCurrency(quotaDiff)} (Target Met)` : `-${formatCurrency(Math.abs(quotaDiff))} (Below Target)`}</span>
                    </div>
                  `
                      : ''
                  }
                `
                    : `
                  <div class="summary-row total">
                    <span>Total Selling Price:</span>
                    <span>${formatCurrency(order.totalSellingPrice)}</span>
                  </div>
                `
                }
              </div>
            </div>

            <!-- Action buttons -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.75rem;">
              <button class="btn btn-secondary btn-sm btn-toggle-details" data-id="${order.id}">
                Show Breakdown ▼
              </button>
              <div style="display: flex; gap: 0.4rem;">
                <button class="btn btn-secondary btn-sm btn-print-order" data-id="${order.id}">🖨️ Print</button>
                <button class="btn btn-danger btn-sm btn-del-order" data-id="${order.id}">Delete</button>
              </div>
            </div>
          </div>
        `;
      })
      .join('');

    // Wire listeners
    listContainer.querySelectorAll('.btn-toggle-details').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.id;
        const detailsEl = container.querySelector(`#details-${id}`) as HTMLElement;
        if (detailsEl) {
          const isHidden = detailsEl.style.display === 'none';
          detailsEl.style.display = isHidden ? 'block' : 'none';
          btn.textContent = isHidden ? 'Hide Breakdown ▲' : 'Show Breakdown ▼';
        }
      });
    });

    listContainer.querySelectorAll('.btn-print-order').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.id;
        const detailsEl = container.querySelector(`#details-${id}`) as HTMLElement;
        if (detailsEl) detailsEl.style.display = 'block';
        window.print();
      });
    });

    listContainer.querySelectorAll('.btn-del-order').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLElement).dataset.id;
        if (!id) return;
        if (confirm('Delete this order from history?')) {
          await dbService.deleteOrder(id);
          const idx = orders.findIndex((o) => o.id === id);
          if (idx > -1) orders.splice(idx, 1);
          renderOrders(filterOrders(searchInput.value));
          await fileSyncService.saveBackupToDisk();
          showToast('Order removed from history.');
        }
      });
    });
  }

  function filterOrders(query: string): Order[] {
    const q = query.toLowerCase().trim();
    if (!q) return orders;
    return orders.filter(
      (o) => o.title.toLowerCase().includes(q) || o.orderNumber.toLowerCase().includes(q)
    );
  }

  searchInput.addEventListener('input', () => {
    renderOrders(filterOrders(searchInput.value));
  });

  renderOrders(orders);
}
