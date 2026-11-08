import { Order, UnitType } from '../types';

export type TimeframePeriod = 'weekly' | 'monthly' | 'yearly';

export interface FinancialSummary {
  totalRevenue: number;
  totalIngredientCost: number;
  totalOverheadCost: number;
  totalExpenses: number;
  netProfit: number;
  profitMarginPercent: number;
  orderCount: number;
  averageOrderValue: number;
}

export interface TimeBucketData {
  periodKey: string;
  label: string;
  revenue: number;
  expenses: number;
  ingredientCost: number;
  overheadCost: number;
  profit: number;
  orderCount: number;
}

export interface TopSoldItem {
  recipeName: string;
  totalQuantity: number;
  outputUnit: 'kg' | 'pcs' | UnitType;
  orderCount: number;
  totalRevenue: number;
  percentageOfRevenue: number;
}

/**
 * Resolves the effective date for an order: delivery date if present, falling back to entered order date.
 * Returns date in YYYY-MM-DD string format.
 */
export function getOrderEffectiveDate(order: Order): string {
  if (order.deliveryDate && order.deliveryDate.trim()) {
    return order.deliveryDate.split('T')[0];
  }
  return (order.date || '').split('T')[0];
}

/**
 * Filter orders by date range (inclusive, based on delivery date with fallback to entered date).
 */
export function filterOrdersByDateRange(
  orders: Order[],
  startDate?: string,
  endDate?: string
): Order[] {
  if (!startDate && !endDate) return orders;

  return orders.filter((order) => {
    const effectiveDatePart = getOrderEffectiveDate(order);
    if (!effectiveDatePart) return false;
    if (startDate && effectiveDatePart < startDate) return false;
    if (endDate && effectiveDatePart > endDate) return false;
    return true;
  });
}

/**
 * Calculate high-level financial KPI metrics for a given set of orders.
 */
export function calculateFinancialSummary(orders: Order[]): FinancialSummary {
  if (orders.length === 0) {
    return {
      totalRevenue: 0,
      totalIngredientCost: 0,
      totalOverheadCost: 0,
      totalExpenses: 0,
      netProfit: 0,
      profitMarginPercent: 0,
      orderCount: 0,
      averageOrderValue: 0
    };
  }

  let totalRevenue = 0;
  let totalIngredientCost = 0;
  let totalOverheadCost = 0;

  for (const order of orders) {
    const rev = order.totalSoldAtPrice ?? order.totalSellingPrice;
    totalRevenue += rev;
    totalIngredientCost += order.totalIngredientCost;
    totalOverheadCost += order.totalOverheadCost;
  }

  totalRevenue = Math.round(totalRevenue * 100) / 100;
  totalIngredientCost = Math.round(totalIngredientCost * 100) / 100;
  totalOverheadCost = Math.round(totalOverheadCost * 100) / 100;

  const totalExpenses = Math.round((totalIngredientCost + totalOverheadCost) * 100) / 100;
  const netProfit = Math.round((totalRevenue - totalExpenses) * 100) / 100;
  const profitMarginPercent =
    totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 1000) / 10 : 0;
  const averageOrderValue =
    orders.length > 0 ? Math.round((totalRevenue / orders.length) * 100) / 100 : 0;

  return {
    totalRevenue,
    totalIngredientCost,
    totalOverheadCost,
    totalExpenses,
    netProfit,
    profitMarginPercent,
    orderCount: orders.length,
    averageOrderValue
  };
}

/**
 * Helper to get Monday-based start of the week for a Date.
 */
function getWeekStartDate(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * Aggregate order financials into weekly, monthly, or yearly buckets.
 */
export function aggregateByTimeframe(
  orders: Order[],
  period: TimeframePeriod
): TimeBucketData[] {
  if (orders.length === 0) return [];

  // Group by calculated key
  const bucketMap = new Map<string, { label: string; orders: Order[] }>();

  // Sort orders chronologically by effective date (delivery date or entered date)
  const sorted = [...orders].sort(
    (a, b) =>
      new Date(getOrderEffectiveDate(a)).getTime() -
      new Date(getOrderEffectiveDate(b)).getTime()
  );

  for (const order of sorted) {
    const d = new Date(getOrderEffectiveDate(order));
    let key = '';
    let label = '';

    if (period === 'yearly') {
      const year = d.getFullYear().toString();
      key = year;
      label = year;
    } else if (period === 'monthly') {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      key = `${year}-${month}`;
      label = d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
    } else {
      // weekly
      const weekStart = getWeekStartDate(d);
      const year = weekStart.getFullYear();
      const month = String(weekStart.getMonth() + 1).padStart(2, '0');
      const day = String(weekStart.getDate()).padStart(2, '0');
      key = `${year}-${month}-${day}`;
      label = weekStart.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    }

    if (!bucketMap.has(key)) {
      bucketMap.set(key, { label, orders: [] });
    }
    bucketMap.get(key)!.orders.push(order);
  }

  const result: TimeBucketData[] = [];

  for (const [key, { label, orders: bucketOrders }] of bucketMap.entries()) {
    let rev = 0;
    let ing = 0;
    let ovh = 0;

    for (const o of bucketOrders) {
      rev += o.totalSoldAtPrice ?? o.totalSellingPrice;
      ing += o.totalIngredientCost;
      ovh += o.totalOverheadCost;
    }

    rev = Math.round(rev * 100) / 100;
    ing = Math.round(ing * 100) / 100;
    ovh = Math.round(ovh * 100) / 100;
    const expenses = Math.round((ing + ovh) * 100) / 100;
    const profit = Math.round((rev - expenses) * 100) / 100;

    result.push({
      periodKey: key,
      label,
      revenue: rev,
      expenses,
      ingredientCost: ing,
      overheadCost: ovh,
      profit,
      orderCount: bucketOrders.length
    });
  }

  return result;
}

/**
 * Calculate top selling recipes across orders, ordered by total revenue.
 */
export function calculateTopSoldItems(orders: Order[], limit = 5): TopSoldItem[] {
  if (orders.length === 0) return [];

  const map = new Map<
    string,
    {
      recipeName: string;
      totalQuantity: number;
      outputUnit: 'kg' | 'pcs' | UnitType;
      orderCount: number;
      totalRevenue: number;
    }
  >();

  let grandTotalRevenue = 0;

  for (const order of orders) {
    for (const item of order.items) {
      const effectiveItemRev = item.soldAtPrice ?? item.sellingPrice;
      grandTotalRevenue += effectiveItemRev;

      const key = `${item.recipeName}__${item.outputUnit || 'kg'}`;
      if (!map.has(key)) {
        map.set(key, {
          recipeName: item.recipeName,
          totalQuantity: 0,
          outputUnit: item.outputUnit || 'kg',
          orderCount: 0,
          totalRevenue: 0
        });
      }

      const entry = map.get(key)!;
      entry.totalQuantity += item.outputValue || 0;
      entry.orderCount += 1;
      entry.totalRevenue += effectiveItemRev;
    }
  }

  const items = Array.from(map.values()).map((entry) => ({
    recipeName: entry.recipeName,
    totalQuantity: Math.round(entry.totalQuantity * 100) / 100,
    outputUnit: entry.outputUnit,
    orderCount: entry.orderCount,
    totalRevenue: Math.round(entry.totalRevenue * 100) / 100,
    percentageOfRevenue:
      grandTotalRevenue > 0
        ? Math.round((entry.totalRevenue / grandTotalRevenue) * 1000) / 10
        : 0
  }));

  // Sort descending by total revenue
  items.sort((a, b) => b.totalRevenue - a.totalRevenue);

  return items.slice(0, limit);
}

export interface IngredientUsageDetail {
  name: string;
  unit: UnitType;
  totalQuantity: number;
  totalCost: number;
  percentageOfSpend: number;
  orderCount: number;
  previousMonthQuantity?: number;
  quantityChangePercent?: number;
  recommendedOrderQty: number;
  projectedOrderCost: number;
}

export interface MonthlyInventoryReport {
  monthKey: string;
  monthLabel: string;
  totalIngredientSpend: number;
  totalDistinctIngredients: number;
  topExpenseIngredient?: string;
  items: IngredientUsageDetail[];
}

/**
 * Get sorted unique list of YYYY-MM months that have orders based on effective date.
 */
export function getAvailableOrderMonths(orders: Order[]): { key: string; label: string }[] {
  const map = new Map<string, string>();
  for (const order of orders) {
    const effectiveStr = getOrderEffectiveDate(order);
    if (!effectiveStr) continue;
    const d = new Date(effectiveStr);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!map.has(key)) {
      map.set(key, d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }));
    }
  }

  if (map.size === 0) {
    const d = new Date();
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    map.set(key, d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }));
  }

  return Array.from(map.entries())
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => b.key.localeCompare(a.key));
}

/**
 * Calculate monthly ingredient usage, cost breakdown, MoM changes, and inventory planning recommendations.
 */
export function calculateMonthlyIngredientUsage(
  allOrders: Order[],
  targetMonthKey: string,
  bufferPercent = 10
): MonthlyInventoryReport {
  const [targetYear, targetMonth] = targetMonthKey.split('-').map(Number);
  const targetDate = new Date(targetYear, targetMonth - 1, 1);
  const monthLabel = targetDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  const prevMonthDate = new Date(targetYear, targetMonth - 2, 1);
  const prevMonthKey = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`;

  const currentOrders = allOrders.filter((o) => getOrderEffectiveDate(o).startsWith(targetMonthKey));
  const prevOrders = allOrders.filter((o) => getOrderEffectiveDate(o).startsWith(prevMonthKey));

  function aggregateOrders(orderList: Order[]) {
    const ingMap = new Map<
      string,
      {
        displayName: string;
        baseUnit: 'g' | 'ml' | 'pcs';
        baseQuantity: number;
        totalCost: number;
        orderCount: number;
      }
    >();

    for (const order of orderList) {
      const orderIngredientNames = new Set<string>();

      const ings =
        order.aggregatedIngredients && order.aggregatedIngredients.length > 0
          ? order.aggregatedIngredients
          : order.items.flatMap((i) => i.scaledIngredients || []);

      for (const ing of ings) {
        const rawName = ing.name.trim();
        const normKey = rawName.toLowerCase();
        const qty = ing.quantity || 0;
        const unit = (ing.unit || 'g').toLowerCase();
        const cost = 'totalCost' in ing ? ing.totalCost : (ing.costPerUnit || 0) * qty;

        let baseUnit: 'g' | 'ml' | 'pcs' = 'g';
        let baseQty = qty;

        if (unit === 'kg') {
          baseUnit = 'g';
          baseQty = qty * 1000;
        } else if (unit === 'g') {
          baseUnit = 'g';
          baseQty = qty;
        } else if (unit === 'l' || unit === 'ltr') {
          baseUnit = 'ml';
          baseQty = qty * 1000;
        } else if (unit === 'ml') {
          baseUnit = 'ml';
          baseQty = qty;
        } else {
          baseUnit = 'pcs';
          baseQty = qty;
        }

        if (!ingMap.has(normKey)) {
          ingMap.set(normKey, {
            displayName: rawName.charAt(0).toUpperCase() + rawName.slice(1),
            baseUnit,
            baseQuantity: 0,
            totalCost: 0,
            orderCount: 0
          });
        }

        const entry = ingMap.get(normKey)!;
        entry.baseQuantity += baseQty;
        entry.totalCost += cost;

        if (!orderIngredientNames.has(normKey)) {
          orderIngredientNames.add(normKey);
          entry.orderCount += 1;
        }
      }
    }

    return ingMap;
  }

  const currentMap = aggregateOrders(currentOrders);
  const prevMap = aggregateOrders(prevOrders);

  let grandTotalSpend = 0;
  for (const entry of currentMap.values()) {
    grandTotalSpend += entry.totalCost;
  }
  grandTotalSpend = Math.round(grandTotalSpend * 100) / 100;

  const items: IngredientUsageDetail[] = [];

  for (const [key, entry] of currentMap.entries()) {
    let finalUnit: UnitType = entry.baseUnit;
    let finalQty = entry.baseQuantity;

    if (entry.baseUnit === 'g' && entry.baseQuantity >= 1000) {
      finalUnit = 'kg';
      finalQty = entry.baseQuantity / 1000;
    } else if (entry.baseUnit === 'ml' && entry.baseQuantity >= 1000) {
      finalUnit = 'l' as UnitType;
      finalQty = entry.baseQuantity / 1000;
    }

    finalQty = Math.round(finalQty * 100) / 100;
    const itemCost = Math.round(entry.totalCost * 100) / 100;

    let prevQty: number | undefined = undefined;
    let changePct: number | undefined = undefined;

    const prevEntry = prevMap.get(key);
    if (prevEntry) {
      let pQty = prevEntry.baseQuantity;
      if (entry.baseUnit === 'g' && entry.baseQuantity >= 1000) {
        pQty = pQty / 1000;
      } else if (entry.baseUnit === 'ml' && entry.baseQuantity >= 1000) {
        pQty = pQty / 1000;
      }
      prevQty = Math.round(pQty * 100) / 100;
      if (prevQty > 0) {
        changePct = Math.round(((finalQty - prevQty) / prevQty) * 1000) / 10;
      }
    }

    const bufferMult = 1 + bufferPercent / 100;
    const recommendedOrderQty = Math.round(finalQty * bufferMult * 100) / 100;
    const projectedOrderCost = Math.round(itemCost * bufferMult * 100) / 100;
    const percentageOfSpend =
      grandTotalSpend > 0 ? Math.round((itemCost / grandTotalSpend) * 1000) / 10 : 0;

    items.push({
      name: entry.displayName,
      unit: finalUnit,
      totalQuantity: finalQty,
      totalCost: itemCost,
      percentageOfSpend,
      orderCount: entry.orderCount,
      previousMonthQuantity: prevQty,
      quantityChangePercent: changePct,
      recommendedOrderQty,
      projectedOrderCost
    });
  }

  items.sort((a, b) => b.totalCost - a.totalCost);

  return {
    monthKey: targetMonthKey,
    monthLabel,
    totalIngredientSpend: grandTotalSpend,
    totalDistinctIngredients: items.length,
    topExpenseIngredient: items.length > 0 ? items[0].name : undefined,
    items
  };
}
