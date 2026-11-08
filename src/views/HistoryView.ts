import { dbService } from '../services/db';
import { fileSyncService } from '../services/fileSync';
import { Order } from '../types';
import { formatCurrency, showToast, escapeHtml } from '../utils/ui';
import {
  filterOrdersByDateRange,
  calculateFinancialSummary,
  aggregateByTimeframe,
  calculateTopSoldItems,
  getAvailableOrderMonths,
  calculateMonthlyIngredientUsage,
  TimeframePeriod,
  TimeBucketData
} from '../utils/analytics';

function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function renderSVGBarChart(data: TimeBucketData[]): string {
  if (data.length === 0) {
    return `
      <div style="text-align: center; padding: 3rem 1rem; color: var(--text-muted);">
        No order data in this timeframe to chart.
      </div>
    `;
  }

  const width = 680;
  const height = 230;
  const padLeft = 60;
  const padRight = 20;
  const padTop = 25;
  const padBottom = 40;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const maxVal = Math.max(...data.map((d) => Math.max(d.revenue, d.expenses)), 100);
  const magnitude = Math.pow(10, Math.floor(Math.log10(maxVal)));
  const yMax = Math.ceil(maxVal / magnitude) * magnitude || 100;

  const numTicks = 4;
  let gridLines = '';
  for (let i = 0; i <= numTicks; i++) {
    const val = (yMax / numTicks) * i;
    const y = padTop + chartH - (i / numTicks) * chartH;
    const label =
      val >= 1000
        ? `₹${(val / 1000).toFixed(val % 1000 === 0 ? 0 : 1)}k`
        : `₹${Math.round(val)}`;
    gridLines += `
      <line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="#e2e8f0" stroke-dasharray="3,3" />
      <text x="${padLeft - 8}" y="${y + 4}" fill="#94a3b8" font-size="10" text-anchor="end" font-family="sans-serif">${label}</text>
    `;
  }

  const bucketW = chartW / data.length;
  const barW = Math.max(8, Math.min(bucketW * 0.32, 28));
  const barGap = 3;

  let bars = '';
  data.forEach((d, i) => {
    const bucketCenter = padLeft + i * bucketW + bucketW / 2;
    const totalBarsW = 2 * barW + barGap;
    const startX = bucketCenter - totalBarsW / 2;

    const expH = Math.max(3, (d.expenses / yMax) * chartH);
    const expY = padTop + chartH - expH;
    const expX = startX;

    const revH = Math.max(3, (d.revenue / yMax) * chartH);
    const revY = padTop + chartH - revH;
    const revX = startX + barW + barGap;

    bars += `
      <g class="chart-bucket" style="cursor: pointer;">
        <title>${d.label}&#10;Revenue: ₹${d.revenue.toLocaleString()}&#10;Expenses: ₹${d.expenses.toLocaleString()} (Ing: ₹${d.ingredientCost.toLocaleString()} + Ovh: ₹${d.overheadCost.toLocaleString()})&#10;Net Profit: ₹${d.profit.toLocaleString()}&#10;Orders: ${d.orderCount}</title>

        <!-- Expense bar (Amber) -->
        <rect x="${expX}" y="${expY}" width="${barW}" height="${expH}" fill="#f59e0b" rx="3" ry="3" opacity="0.9">
          <animate attributeName="height" from="0" to="${expH}" dur="0.25s" fill="freeze" />
          <animate attributeName="y" from="${padTop + chartH}" to="${expY}" dur="0.25s" fill="freeze" />
        </rect>

        <!-- Revenue bar (Emerald) -->
        <rect x="${revX}" y="${revY}" width="${barW}" height="${revH}" fill="#10b981" rx="3" ry="3" opacity="0.9">
          <animate attributeName="height" from="0" to="${revH}" dur="0.25s" fill="freeze" />
          <animate attributeName="y" from="${padTop + chartH}" to="${revY}" dur="0.25s" fill="freeze" />
        </rect>

        <!-- X-axis label -->
        <text x="${bucketCenter}" y="${height - padBottom + 16}" fill="#64748b" font-size="10" font-weight="600" text-anchor="middle" font-family="sans-serif">
          ${d.label}
        </text>
      </g>
    `;
  });

  return `
    <div style="overflow-x: auto; width: 100%;">
      <svg viewBox="0 0 ${width} ${height}" style="width: 100%; min-width: 480px; height: auto; display: block;">
        ${gridLines}
        ${bars}
      </svg>
    </div>
  `;
}

export async function renderHistoryView(container: HTMLElement): Promise<void> {
  const orders = await dbService.getOrders();

  let currentPeriod: TimeframePeriod = 'monthly';

  container.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="view-title">Order History & Reporting</h1>
        <p class="view-desc">Past production batches, quotes, profit analytics, and sales reporting.</p>
      </div>
      <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
        <button id="btn-export-excel" class="btn btn-secondary">
          📊 Export to Excel (.csv)
        </button>
        <a href="#calculator" class="btn btn-primary">
          + New Calculation
        </a>
      </div>
    </div>

    <!-- Filter & Date Range Card -->
    <div class="card" style="padding: 1rem 1.25rem; margin-bottom: 1.25rem;">
      <div style="display: flex; flex-direction: column; gap: 0.75rem;">
        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
          <input type="text" id="search-history" class="form-control" placeholder="Search orders by title, #, customer or recipe..." style="flex: 1; min-width: 220px;" />
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem; border-top: 1px solid var(--border); padding-top: 0.75rem;">
          <!-- Presets -->
          <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
            <span style="font-size: 0.82rem; font-weight: 700; color: #475569; margin-right: 0.2rem;" title="Filtered by Delivery Date (or entered date if delivery date was not set)">Delivery Date:</span>
            <button type="button" class="btn btn-secondary btn-sm btn-date-preset active" data-preset="all">All Time</button>
            <button type="button" class="btn btn-secondary btn-sm btn-date-preset" data-preset="7d">Last 7 Days</button>
            <button type="button" class="btn btn-secondary btn-sm btn-date-preset" data-preset="month">This Month</button>
            <button type="button" class="btn btn-secondary btn-sm btn-date-preset" data-preset="year">This Year</button>
          </div>

          <!-- Date Inputs -->
          <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
            <div style="display: flex; align-items: center; gap: 0.25rem; font-size: 0.82rem; color: var(--text-muted);">
              <span>From</span>
              <input type="date" id="filter-from-date" class="form-control" style="width: auto; padding: 0.25rem 0.5rem; font-size: 0.85rem;" />
            </div>
            <div style="display: flex; align-items: center; gap: 0.25rem; font-size: 0.82rem; color: var(--text-muted);">
              <span>To</span>
              <input type="date" id="filter-to-date" class="form-control" style="width: auto; padding: 0.25rem 0.5rem; font-size: 0.85rem;" />
            </div>
            <button type="button" id="btn-clear-dates" class="btn btn-secondary btn-sm" title="Clear Date Range" style="padding: 0.25rem 0.5rem;">✕</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Tab Navigation -->
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; border-bottom: 2px solid var(--border); padding-bottom: 0.5rem; flex-wrap: wrap; gap: 0.5rem;">
      <div style="display: flex; gap: 0.5rem;">
        <button id="tab-btn-orders" class="btn btn-secondary active-tab" style="font-weight: 700; border-radius: 9999px; padding: 0.45rem 1rem;">
          📋 Orders List (<span id="orders-tab-count">${orders.length}</span>)
        </button>
        <button id="tab-btn-reports" class="btn btn-secondary" style="font-weight: 700; border-radius: 9999px; padding: 0.45rem 1rem;">
          📈 Reports & Trends
        </button>
      </div>
      <div style="font-size: 0.82rem; color: var(--text-muted);" id="filter-status-desc">
        Showing all orders
      </div>
    </div>

    <!-- Tab 1: Orders List -->
    <div id="tab-pane-orders">
      <div id="orders-list-container" style="display: flex; flex-direction: column; gap: 1rem;">
        <!-- Populated dynamically -->
      </div>
    </div>

    <!-- Tab 2: Reports & Analytics -->
    <div id="tab-pane-reports" style="display: none;">
      <!-- KPI Metric Cards Grid -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1.25rem;">
        <div class="card" style="margin: 0; padding: 1rem 1.25rem; border-left: 4px solid #10b981;">
          <div style="font-size: 0.78rem; color: #64748b; font-weight: 700; text-transform: uppercase;">Total Revenue</div>
          <div style="font-size: 1.5rem; font-weight: 800; color: #0f172a; margin: 0.2rem 0;" id="kpi-revenue">₹0</div>
          <div style="font-size: 0.78rem; color: #64748b;" id="kpi-orders-count">0 orders</div>
        </div>

        <div class="card" style="margin: 0; padding: 1rem 1.25rem; border-left: 4px solid #f59e0b;">
          <div style="font-size: 0.78rem; color: #64748b; font-weight: 700; text-transform: uppercase;">Total Expenses</div>
          <div style="font-size: 1.5rem; font-weight: 800; color: #92400e; margin: 0.2rem 0;" id="kpi-expenses">₹0</div>
          <div style="font-size: 0.78rem; color: #64748b;" id="kpi-expenses-breakdown">Ing: ₹0 • Ovh: ₹0</div>
        </div>

        <div class="card" style="margin: 0; padding: 1rem 1.25rem; border-left: 4px solid #16a34a;">
          <div style="font-size: 0.78rem; color: #64748b; font-weight: 700; text-transform: uppercase;">Net Profit</div>
          <div style="font-size: 1.5rem; font-weight: 800; color: #166534; margin: 0.2rem 0;" id="kpi-profit">₹0</div>
          <div style="font-size: 0.78rem; font-weight: 700;" id="kpi-margin">+0% margin</div>
        </div>

        <div class="card" style="margin: 0; padding: 1rem 1.25rem; border-left: 4px solid #6366f1;">
          <div style="font-size: 0.78rem; color: #64748b; font-weight: 700; text-transform: uppercase;">Avg Order Value</div>
          <div style="font-size: 1.5rem; font-weight: 800; color: #3730a3; margin: 0.2rem 0;" id="kpi-aov">₹0</div>
          <div style="font-size: 0.78rem; color: #64748b;">per calculated batch</div>
        </div>
      </div>

      <!-- Financial Chart Card -->
      <div class="card" style="margin-bottom: 1.25rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem;">
          <div>
            <h3 style="font-size: 1.15rem; font-weight: 700; color: #0f172a;">Financial Trends & Breakdown</h3>
            <p style="font-size: 0.8rem; color: var(--text-muted);">Comparing Revenue vs. Expenses over time.</p>
          </div>
          <div style="display: flex; gap: 0.4rem; align-items: center;">
            <button type="button" class="btn btn-secondary btn-sm btn-timeframe" data-period="weekly">Weekly</button>
            <button type="button" class="btn btn-secondary btn-sm btn-timeframe active" data-period="monthly">Monthly</button>
            <button type="button" class="btn btn-secondary btn-sm btn-timeframe" data-period="yearly">Yearly</button>
          </div>
        </div>

        <div id="reports-chart-container">
          <!-- SVG chart rendered here -->
        </div>

        <div style="display: flex; justify-content: center; gap: 1.5rem; margin-top: 0.75rem; font-size: 0.82rem; color: #475569;">
          <span style="display: flex; align-items: center; gap: 0.35rem;">
            <span style="width: 12px; height: 12px; background: #10b981; border-radius: 2px; display: inline-block;"></span>
            Revenue (Net Profit)
          </span>
          <span style="display: flex; align-items: center; gap: 0.35rem;">
            <span style="width: 12px; height: 12px; background: #f59e0b; border-radius: 2px; display: inline-block;"></span>
            Expenses (Ingredients + Overhead)
          </span>
        </div>
      </div>

      <!-- Top Selling Items Leaderboard -->
      <div class="card">
        <h3 style="font-size: 1.15rem; font-weight: 700; color: #0f172a; margin-bottom: 0.25rem;">
          🏆 Top Selling Items
        </h3>
        <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 1rem;">
          Ranked by revenue and quantities produced in the selected period.
        </p>

        <div id="reports-top-items-container">
          <!-- Top items rendered here -->
        </div>
      </div>

      <!-- Monthly Ingredient Usage & Inventory Planning Card -->
      <div class="card" style="margin-top: 1.25rem;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 1rem;">
          <div>
            <h3 style="font-size: 1.15rem; font-weight: 700; color: #0f172a; margin-bottom: 0.25rem;">
              📦 Monthly Ingredient Usage & Inventory Planning
            </h3>
            <p style="font-size: 0.8rem; color: var(--text-muted);">
              Track monthly raw ingredient consumption, expense shares, MoM changes, and estimate next month's purchase orders.
            </p>
          </div>
          <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
            <div style="display: flex; align-items: center; gap: 0.35rem; font-size: 0.82rem; color: #475569;">
              <span>Month:</span>
              <select id="select-inventory-month" class="form-control" style="width: auto; padding: 0.3rem 0.6rem; font-size: 0.85rem; font-weight: 600;">
                <!-- Populated dynamically -->
              </select>
            </div>
            <div style="display: flex; align-items: center; gap: 0.35rem; font-size: 0.82rem; color: #475569;">
              <span>Buffer:</span>
              <select id="select-inventory-buffer" class="form-control" style="width: auto; padding: 0.3rem 0.6rem; font-size: 0.85rem;">
                <option value="0">0% (Exact Run-rate)</option>
                <option value="10" selected>+10% Buffer</option>
                <option value="20">+20% High Season</option>
              </select>
            </div>
            <button id="btn-export-inventory-csv" class="btn btn-secondary btn-sm" title="Export monthly ingredient plan to CSV">
              📥 Export Plan (.csv)
            </button>
          </div>
        </div>

        <div id="inventory-summary-badges" style="display: flex; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 1rem;">
          <!-- dynamic summary stats -->
        </div>

        <div class="table-responsive">
          <table class="table" style="font-size: 0.9rem;">
            <thead>
              <tr>
                <th>Ingredient</th>
                <th>Monthly Usage</th>
                <th>Monthly Spend</th>
                <th>% of Budget</th>
                <th>MoM Change</th>
                <th>Recommended Stock (Next Month)</th>
                <th>Est. Next Month Spend</th>
              </tr>
            </thead>
            <tbody id="inventory-table-tbody">
              <!-- populated dynamically -->
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  // Select DOM Elements
  const listContainer = container.querySelector('#orders-list-container') as HTMLElement;
  const searchInput = container.querySelector('#search-history') as HTMLInputElement;
  const fromDateInput = container.querySelector('#filter-from-date') as HTMLInputElement;
  const toDateInput = container.querySelector('#filter-to-date') as HTMLInputElement;
  const btnClearDates = container.querySelector('#btn-clear-dates') as HTMLButtonElement;
  const ordersTabCountBadge = container.querySelector('#orders-tab-count') as HTMLElement;
  const filterStatusDesc = container.querySelector('#filter-status-desc') as HTMLElement;

  const tabBtnOrders = container.querySelector('#tab-btn-orders') as HTMLButtonElement;
  const tabBtnReports = container.querySelector('#tab-btn-reports') as HTMLButtonElement;
  const tabPaneOrders = container.querySelector('#tab-pane-orders') as HTMLElement;
  const tabPaneReports = container.querySelector('#tab-pane-reports') as HTMLElement;

  const selectInvMonth = container.querySelector('#select-inventory-month') as HTMLSelectElement;
  const selectInvBuffer = container.querySelector('#select-inventory-buffer') as HTMLSelectElement;
  const invSummaryBadges = container.querySelector('#inventory-summary-badges') as HTMLElement;
  const invTableTbody = container.querySelector('#inventory-table-tbody') as HTMLElement;
  const btnExportInvCsv = container.querySelector('#btn-export-inventory-csv') as HTMLButtonElement;

  const availableMonths = getAvailableOrderMonths(orders);
  selectInvMonth.innerHTML = availableMonths
    .map((m) => `<option value="${m.key}">${m.label}</option>`)
    .join('');

  let selectedInvMonthKey = availableMonths.length > 0 ? availableMonths[0].key : '';
  let selectedBufferPercent = 10;

  function getFilteredOrders(): Order[] {
    const from = fromDateInput.value || undefined;
    const to = toDateInput.value || undefined;
    const query = searchInput.value.trim().toLowerCase();

    let filtered = filterOrdersByDateRange(orders, from, to);

    if (query) {
      filtered = filtered.filter((order) => {
        const matchNum = order.orderNumber.toLowerCase().includes(query);
        const matchTitle = (order.title || '').toLowerCase().includes(query);
        const matchCust = (order.customerName || '').toLowerCase().includes(query);
        const matchRecipe = order.items.some((i) => i.recipeName.toLowerCase().includes(query));
        return matchNum || matchTitle || matchCust || matchRecipe;
      });
    }

    return filtered;
  }

  function renderOrders(items: Order[]) {
    if (items.length === 0) {
      listContainer.innerHTML = `
        <div class="card" style="text-align: center; padding: 3rem; color: var(--text-muted);">
          No saved calculations or orders match the current filter.
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

        const recipesSummary = order.items
          .map((i) => `${i.recipeName} (${i.scaleMultiplier.toFixed(2)}x)`)
          .join(', ');
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
                  📅 Created: ${dateFormatted}
                  ${order.updatedAt ? ` • <em>(Edited: ${new Date(order.updatedAt).toLocaleDateString('en-IN')})</em>` : ''}
                  ${order.deliveryDate ? ` • 🚚 <strong>Delivery: ${new Date(order.deliveryDate).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</strong>` : ''}
                  • ${order.items.length} recipe(s)
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
                <a href="#calculator?edit=${order.id}" class="btn btn-secondary btn-sm" style="text-decoration: none;">✏️ Edit</a>
                <button class="btn btn-secondary btn-sm btn-print-order" data-id="${order.id}">🖨️ Print</button>
                <button class="btn btn-danger btn-sm btn-del-order" data-id="${order.id}">Delete</button>
              </div>
            </div>
          </div>
        `;
      })
      .join('');

    // Wire action listeners
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
          updateView();
          await fileSyncService.saveBackupToDisk();
          showToast('Order removed from history.');
        }
      });
    });
  }

  function renderReports(items: Order[]) {
    const summary = calculateFinancialSummary(items);

    const kpiRev = container.querySelector('#kpi-revenue') as HTMLElement;
    const kpiCount = container.querySelector('#kpi-orders-count') as HTMLElement;
    const kpiExp = container.querySelector('#kpi-expenses') as HTMLElement;
    const kpiExpBk = container.querySelector('#kpi-expenses-breakdown') as HTMLElement;
    const kpiProfit = container.querySelector('#kpi-profit') as HTMLElement;
    const kpiMargin = container.querySelector('#kpi-margin') as HTMLElement;
    const kpiAov = container.querySelector('#kpi-aov') as HTMLElement;

    if (kpiRev) kpiRev.textContent = formatCurrency(summary.totalRevenue);
    if (kpiCount) {
      kpiCount.textContent = `${summary.orderCount} order${summary.orderCount !== 1 ? 's' : ''} in period`;
    }
    if (kpiExp) kpiExp.textContent = formatCurrency(summary.totalExpenses);
    if (kpiExpBk) {
      kpiExpBk.textContent = `Ing: ${formatCurrency(summary.totalIngredientCost)} • Ovh: ${formatCurrency(summary.totalOverheadCost)}`;
    }
    if (kpiProfit) {
      kpiProfit.textContent = formatCurrency(summary.netProfit);
      kpiProfit.style.color = summary.netProfit >= 0 ? '#166534' : '#b91c1c';
    }
    if (kpiMargin) {
      kpiMargin.textContent = `${summary.profitMarginPercent >= 0 ? '+' : ''}${summary.profitMarginPercent}% profit margin`;
      kpiMargin.style.color = summary.profitMarginPercent >= 0 ? '#15803d' : '#b91c1c';
    }
    if (kpiAov) kpiAov.textContent = formatCurrency(summary.averageOrderValue);

    // Render SVG Bar Chart
    const chartContainer = container.querySelector('#reports-chart-container') as HTMLElement;
    if (chartContainer) {
      const timeData = aggregateByTimeframe(items, currentPeriod);
      chartContainer.innerHTML = renderSVGBarChart(timeData);
    }

    // Render Most Sold Items
    const topContainer = container.querySelector('#reports-top-items-container') as HTMLElement;
    if (topContainer) {
      const topItems = calculateTopSoldItems(items, 8);
      if (topItems.length === 0) {
        topContainer.innerHTML = `
          <div style="text-align: center; padding: 2rem; color: var(--text-muted);">
            No recipe sales data found for this period.
          </div>
        `;
      } else {
        topContainer.innerHTML = topItems
          .map(
            (item, idx) => `
          <div style="margin-bottom: 1rem;">
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.35rem; font-size: 0.92rem;">
              <div style="display: flex; align-items: center; gap: 0.4rem;">
                <span class="badge" style="background: ${idx === 0 ? '#fef3c7' : '#f1f5f9'}; color: ${idx === 0 ? '#b45309' : '#475569'}; font-weight: 700;">
                  #${idx + 1}
                </span>
                <strong style="color: #0f172a;">${escapeHtml(item.recipeName)}</strong>
                <span style="color: var(--text-muted); font-size: 0.8rem;">(${item.orderCount} batch${item.orderCount > 1 ? 'es' : ''})</span>
              </div>
              <div style="text-align: right;">
                <strong style="color: #0f172a; margin-right: 0.5rem;">${item.totalQuantity} ${item.outputUnit}</strong>
                <span style="color: #16a34a; font-weight: 700;">${formatCurrency(item.totalRevenue)}</span>
                <span style="color: var(--text-muted); font-size: 0.8rem; margin-left: 0.25rem;">(${item.percentageOfRevenue}%)</span>
              </div>
            </div>
            <div style="width: 100%; background: #e2e8f0; height: 8px; border-radius: 9999px; overflow: hidden;">
              <div style="width: ${Math.max(2, item.percentageOfRevenue)}%; background: linear-gradient(90deg, #f59e0b, #10b981); height: 100%; border-radius: 9999px;"></div>
            </div>
          </div>
        `
          )
          .join('');
      }
    }

    renderInventoryReport();
  }

  function renderInventoryReport() {
    if (!selectedInvMonthKey) {
      invTableTbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 2rem;">No historical orders available to plan inventory.</td></tr>`;
      return;
    }

    const report = calculateMonthlyIngredientUsage(orders, selectedInvMonthKey, selectedBufferPercent);

    if (report.items.length === 0) {
      invSummaryBadges.innerHTML = '';
      invTableTbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 2.5rem;">
            No ingredient usage recorded for ${report.monthLabel}.
          </td>
        </tr>
      `;
      return;
    }

    invSummaryBadges.innerHTML = `
      <div style="background: #f8fafc; border: 1px solid var(--border); padding: 0.4rem 0.75rem; border-radius: var(--radius); font-size: 0.82rem;">
        Total Ingredient Spend: <strong style="color: #0f172a;">${formatCurrency(report.totalIngredientSpend)}</strong>
      </div>
      <div style="background: #f8fafc; border: 1px solid var(--border); padding: 0.4rem 0.75rem; border-radius: var(--radius); font-size: 0.82rem;">
        Distinct Ingredients: <strong style="color: #0f172a;">${report.totalDistinctIngredients} items</strong>
      </div>
      ${
        report.topExpenseIngredient
          ? `<div style="background: #fef3c7; border: 1px solid #fde68a; padding: 0.4rem 0.75rem; border-radius: var(--radius); font-size: 0.82rem; color: #92400e;">
              Top Cost Driver: <strong>${escapeHtml(report.topExpenseIngredient)}</strong>
            </div>`
          : ''
      }
    `;

    invTableTbody.innerHTML = report.items
      .map((item) => {
        let momBadge = '<span style="color: var(--text-muted);">—</span>';
        if (typeof item.quantityChangePercent === 'number') {
          if (item.quantityChangePercent > 0) {
            momBadge = `<span style="color: #16a34a; font-weight: 700;">▲ +${item.quantityChangePercent}%</span>`;
          } else if (item.quantityChangePercent < 0) {
            momBadge = `<span style="color: #dc2626; font-weight: 700;">▼ ${item.quantityChangePercent}%</span>`;
          } else {
            momBadge = `<span style="color: #64748b; font-weight: 600;">0%</span>`;
          }
        }

        return `
          <tr>
            <td>
              <strong>${escapeHtml(item.name)}</strong>
              <div style="font-size: 0.75rem; color: var(--text-muted);">Used in ${item.orderCount} batch${item.orderCount > 1 ? 'es' : ''}</div>
            </td>
            <td>
              <strong style="color: #0f172a; font-size: 0.95rem;">${item.totalQuantity} ${item.unit}</strong>
            </td>
            <td style="font-weight: 600;">
              ${formatCurrency(item.totalCost)}
            </td>
            <td>
              <div style="display: flex; align-items: center; gap: 0.4rem;">
                <span style="font-size: 0.82rem; font-weight: 700; min-width: 42px;">${item.percentageOfSpend}%</span>
                <div style="width: 60px; background: #e2e8f0; height: 6px; border-radius: 9999px; overflow: hidden;">
                  <div style="width: ${Math.max(3, item.percentageOfSpend)}%; background: #d97706; height: 100%;"></div>
                </div>
              </div>
            </td>
            <td>${momBadge}</td>
            <td style="background: #f0fdf4; border-color: #dcfce7;">
              <strong style="color: #15803d; font-size: 0.95rem;">${item.recommendedOrderQty} ${item.unit}</strong>
              <span style="font-size: 0.75rem; color: #166534; display: block;">(+${selectedBufferPercent}% buffer)</span>
            </td>
            <td style="background: #f0fdf4; border-color: #dcfce7; font-weight: 700; color: #15803d;">
              ${formatCurrency(item.projectedOrderCost)}
            </td>
          </tr>
        `;
      })
      .join('');
  }

  function updateView() {
    const filtered = getFilteredOrders();
    ordersTabCountBadge.textContent = filtered.length.toString();

    const from = fromDateInput.value;
    const to = toDateInput.value;
    const q = searchInput.value.trim();

    if (from || to || q) {
      filterStatusDesc.textContent = `Filtered: ${filtered.length} of ${orders.length} orders (by delivery date)`;
    } else {
      filterStatusDesc.textContent = `Showing all ${orders.length} orders`;
    }

    renderOrders(filtered);
    renderReports(filtered);
  }

  // Preset button listeners
  const presetButtons = container.querySelectorAll('.btn-date-preset');
  presetButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = (btn as HTMLElement).dataset.preset;
      presetButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      const now = new Date();

      if (preset === '7d') {
        const past = new Date();
        past.setDate(now.getDate() - 6);
        fromDateInput.value = toLocalDateString(past);
        toDateInput.value = toLocalDateString(now);
      } else if (preset === 'month') {
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        fromDateInput.value = toLocalDateString(firstDay);
        toDateInput.value = toLocalDateString(now);
      } else if (preset === 'year') {
        const firstJan = new Date(now.getFullYear(), 0, 1);
        fromDateInput.value = toLocalDateString(firstJan);
        toDateInput.value = toLocalDateString(now);
      } else {
        // all
        fromDateInput.value = '';
        toDateInput.value = '';
      }

      updateView();
    });
  });

  // Date input change listeners
  fromDateInput.addEventListener('change', () => {
    presetButtons.forEach((b) => b.classList.remove('active'));
    updateView();
  });

  toDateInput.addEventListener('change', () => {
    presetButtons.forEach((b) => b.classList.remove('active'));
    updateView();
  });

  btnClearDates.addEventListener('click', () => {
    fromDateInput.value = '';
    toDateInput.value = '';
    presetButtons.forEach((b) => {
      if ((b as HTMLElement).dataset.preset === 'all') b.classList.add('active');
      else b.classList.remove('active');
    });
    updateView();
  });

  searchInput.addEventListener('input', () => {
    updateView();
  });

  // Tab switching
  tabBtnOrders.addEventListener('click', () => {
    tabBtnOrders.classList.add('active-tab');
    tabBtnReports.classList.remove('active-tab');
    tabPaneOrders.style.display = 'block';
    tabPaneReports.style.display = 'none';
  });

  tabBtnReports.addEventListener('click', () => {
    tabBtnReports.classList.add('active-tab');
    tabBtnOrders.classList.remove('active-tab');
    tabPaneReports.style.display = 'block';
    tabPaneOrders.style.display = 'none';
    renderReports(getFilteredOrders());
  });

  // Timeframe buttons
  const timeframeButtons = container.querySelectorAll('.btn-timeframe');
  timeframeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      currentPeriod = (btn as HTMLElement).dataset.period as TimeframePeriod;
      timeframeButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const filtered = getFilteredOrders();
      const chartContainer = container.querySelector('#reports-chart-container') as HTMLElement;
      if (chartContainer) {
        const timeData = aggregateByTimeframe(filtered, currentPeriod);
        chartContainer.innerHTML = renderSVGBarChart(timeData);
      }
    });
  });

  // Export to Excel (.csv)
  function exportOrdersToExcel(itemsToExport: Order[]) {
    if (itemsToExport.length === 0) {
      alert('No orders match current filter to export.');
      return;
    }

    const headers = [
      'Order ID',
      'Name',
      'Order Date',
      'Delivery Date',
      'Recipes (Name + Qty)',
      'Ingredients Cost (₹)',
      'Target Cost (₹)',
      'Target Price (₹)',
      'Sold At Cost (₹)',
      'Target Variance (₹)'
    ];

    const escapeCSV = (val: any) => {
      if (val === undefined || val === null) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = itemsToExport.map((order) => {
      const recipesStr = order.items
        .map((item) => `${item.recipeName} (${item.outputValue} ${item.outputUnit})`)
        .join(', ');

      const soldAt = order.totalSoldAtPrice ?? order.totalSellingPrice;
      const diff = order.quotaDifference !== undefined ? order.quotaDifference : 0;
      const orderDate = new Date(order.date).toLocaleDateString('en-IN');
      const deliveryDate = order.deliveryDate
        ? new Date(order.deliveryDate).toLocaleDateString('en-IN')
        : '—';

      return [
        escapeCSV(order.orderNumber),
        escapeCSV(order.title || order.customerName || 'Untitled'),
        escapeCSV(orderDate),
        escapeCSV(deliveryDate),
        escapeCSV(recipesStr),
        escapeCSV(order.totalIngredientCost.toFixed(2)),
        escapeCSV(order.totalCost.toFixed(2)),
        escapeCSV(order.totalSellingPrice.toFixed(2)),
        escapeCSV(soldAt.toFixed(2)),
        escapeCSV(diff >= 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2))
      ].join(',');
    });

    const csvContent = '\uFEFF' + [headers.map(escapeCSV).join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dateStr = new Date().toISOString().split('T')[0];
    a.download = `cloud-crust-orders-${dateStr}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Orders exported to Excel (.csv)');
  }

  container.querySelector('#btn-export-excel')?.addEventListener('click', () => {
    exportOrdersToExcel(getFilteredOrders());
  });

  // Export Monthly Ingredient Inventory Plan (.csv)
  function exportInventoryPlanCSV() {
    if (!selectedInvMonthKey) {
      alert('No month selected.');
      return;
    }

    const report = calculateMonthlyIngredientUsage(orders, selectedInvMonthKey, selectedBufferPercent);
    if (report.items.length === 0) {
      alert(`No ingredient data found for ${report.monthLabel} to export.`);
      return;
    }

    const headers = [
      'Ingredient',
      'Usage This Month',
      'Unit',
      'Monthly Expense (₹)',
      'Budget Share (%)',
      'MoM Usage Change (%)',
      `Recommended Order Qty (+${selectedBufferPercent}%)`,
      'Projected Expense (₹)'
    ];

    const escapeCSV = (val: any) => {
      if (val === undefined || val === null) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = report.items.map((item) =>
      [
        escapeCSV(item.name),
        escapeCSV(item.totalQuantity),
        escapeCSV(item.unit),
        escapeCSV(item.totalCost.toFixed(2)),
        escapeCSV(`${item.percentageOfSpend}%`),
        escapeCSV(
          typeof item.quantityChangePercent === 'number'
            ? `${item.quantityChangePercent > 0 ? '+' : ''}${item.quantityChangePercent}%`
            : '—'
        ),
        escapeCSV(item.recommendedOrderQty),
        escapeCSV(item.projectedOrderCost.toFixed(2))
      ].join(',')
    );

    const csvContent = '\uFEFF' + [headers.map(escapeCSV).join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cloud-crust-ingredient-plan-${report.monthKey}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Exported ${report.monthLabel} ingredient plan to CSV.`);
  }

  btnExportInvCsv.addEventListener('click', exportInventoryPlanCSV);

  selectInvMonth.addEventListener('change', () => {
    selectedInvMonthKey = selectInvMonth.value;
    renderInventoryReport();
  });

  selectInvBuffer.addEventListener('change', () => {
    selectedBufferPercent = parseInt(selectInvBuffer.value, 10) || 0;
    renderInventoryReport();
  });

  // Initial render
  updateView();
}
