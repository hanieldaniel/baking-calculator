import { describe, it, expect } from 'vitest';
import { Order } from '../types';
import {
  filterOrdersByDateRange,
  calculateFinancialSummary,
  aggregateByTimeframe,
  calculateTopSoldItems,
  getAvailableOrderMonths,
  calculateMonthlyIngredientUsage
} from './analytics';

const sampleOrders: Order[] = [
  {
    id: 'ord-1',
    orderNumber: 'ORD-000001',
    title: 'Morning Batch',
    date: '2026-03-01T08:00:00.000Z',
    items: [
      {
        recipeId: 'rec-1',
        recipeName: 'Country Sourdough',
        outputValue: 5,
        outputUnit: 'kg',
        scaleMultiplier: 5,
        scaledIngredients: [],
        ingredientCost: 200,
        overheadCost: 50,
        markupPercent: 40,
        totalCost: 250,
        sellingPrice: 350,
        soldAtPrice: 360
      }
    ],
    aggregatedIngredients: [],
    totalIngredientCost: 200,
    totalOverheadCost: 50,
    totalCost: 250,
    totalSellingPrice: 350,
    totalSoldAtPrice: 360,
    quotaDifference: 10
  },
  {
    id: 'ord-2',
    orderNumber: 'ORD-000002',
    title: 'Pastry Catering',
    date: '2026-03-05T10:00:00.000Z',
    items: [
      {
        recipeId: 'rec-2',
        recipeName: 'Butter Croissants',
        outputValue: 24,
        outputUnit: 'pcs',
        scaleMultiplier: 2,
        scaledIngredients: [],
        ingredientCost: 300,
        overheadCost: 60,
        markupPercent: 50,
        totalCost: 360,
        sellingPrice: 540,
        soldAtPrice: 500
      },
      {
        recipeId: 'rec-1',
        recipeName: 'Country Sourdough',
        outputValue: 2,
        outputUnit: 'kg',
        scaleMultiplier: 2,
        scaledIngredients: [],
        ingredientCost: 80,
        overheadCost: 20,
        markupPercent: 40,
        totalCost: 100,
        sellingPrice: 140
      }
    ],
    aggregatedIngredients: [],
    totalIngredientCost: 380,
    totalOverheadCost: 80,
    totalCost: 460,
    totalSellingPrice: 680,
    totalSoldAtPrice: 640,
    quotaDifference: -40
  },
  {
    id: 'ord-3',
    orderNumber: 'ORD-000003',
    title: 'Weekend Farmer Market',
    date: '2026-02-15T09:00:00.000Z',
    items: [
      {
        recipeId: 'rec-1',
        recipeName: 'Country Sourdough',
        outputValue: 10,
        outputUnit: 'kg',
        scaleMultiplier: 10,
        scaledIngredients: [],
        ingredientCost: 400,
        overheadCost: 100,
        markupPercent: 40,
        totalCost: 500,
        sellingPrice: 700
      }
    ],
    aggregatedIngredients: [],
    totalIngredientCost: 400,
    totalOverheadCost: 100,
    totalCost: 500,
    totalSellingPrice: 700
  }
];

describe('Analytics & Reporting Utils', () => {
  it('filters orders by delivery date prioritizing deliveryDate over date with fallback', () => {
    const ordersWithDelivery: Order[] = [
      {
        ...sampleOrders[0],
        date: '2026-03-01T08:00:00.000Z',
        deliveryDate: '2026-03-15' // Placed on March 1, delivered March 15
      },
      {
        ...sampleOrders[1],
        date: '2026-03-05T10:00:00.000Z',
        deliveryDate: undefined // Fallback to March 5
      }
    ];

    // Filtering for March 10 to March 20 should catch order 1 (delivered March 15), but not order 2 (March 5)
    const midMarch = filterOrdersByDateRange(ordersWithDelivery, '2026-03-10', '2026-03-20');
    expect(midMarch).toHaveLength(1);
    expect(midMarch[0].orderNumber).toBe('ORD-000001');

    // Filtering for March 1 to March 6 should catch order 2 (fallback to date March 5), but not order 1 (delivered March 15)
    const earlyMarch = filterOrdersByDateRange(ordersWithDelivery, '2026-03-01', '2026-03-06');
    expect(earlyMarch).toHaveLength(1);
    expect(earlyMarch[0].orderNumber).toBe('ORD-000002');
  });

  it('filters orders by start and end date inclusive', () => {
    const marchOnly = filterOrdersByDateRange(sampleOrders, '2026-03-01', '2026-03-31');
    expect(marchOnly).toHaveLength(2);
    expect(marchOnly.map((o) => o.orderNumber)).toEqual(['ORD-000001', 'ORD-000002']);

    const febOnly = filterOrdersByDateRange(sampleOrders, '2026-02-01', '2026-02-28');
    expect(febOnly).toHaveLength(1);
    expect(febOnly[0].orderNumber).toBe('ORD-000003');

    const all = filterOrdersByDateRange(sampleOrders);
    expect(all).toHaveLength(3);
  });

  it('calculates financial KPIs correctly', () => {
    // ord-1: rev 360, ing 200, ovh 50
    // ord-2: rev 640, ing 380, ovh 80
    // ord-3: rev 700, ing 400, ovh 100
    // total rev: 1700
    // total ing: 980
    // total ovh: 230
    // total expenses: 1210
    // net profit: 490
    // margin: 490 / 1700 = 28.8%
    const summary = calculateFinancialSummary(sampleOrders);
    expect(summary.totalRevenue).toBe(1700);
    expect(summary.totalExpenses).toBe(1210);
    expect(summary.netProfit).toBe(490);
    expect(summary.profitMarginPercent).toBe(28.8);
    expect(summary.orderCount).toBe(3);
    expect(summary.averageOrderValue).toBeCloseTo(566.67, 1);
  });

  it('aggregates financials by monthly timeframe', () => {
    const monthly = aggregateByTimeframe(sampleOrders, 'monthly');
    expect(monthly).toHaveLength(2); // Feb and Mar 2026

    const feb = monthly.find((m) => m.periodKey === '2026-02');
    expect(feb).toBeDefined();
    expect(feb?.revenue).toBe(700);
    expect(feb?.profit).toBe(200);

    const mar = monthly.find((m) => m.periodKey === '2026-03');
    expect(mar).toBeDefined();
    expect(mar?.revenue).toBe(1000); // 360 + 640
    expect(mar?.expenses).toBe(710); // (200+50) + (380+80)
    expect(mar?.profit).toBe(290);
  });

  it('aggregates financials by yearly timeframe', () => {
    const yearly = aggregateByTimeframe(sampleOrders, 'yearly');
    expect(yearly).toHaveLength(1);
    expect(yearly[0].periodKey).toBe('2026');
    expect(yearly[0].revenue).toBe(1700);
  });

  it('calculates top sold recipes by total revenue and quantity', () => {
    const top = calculateTopSoldItems(sampleOrders);
    expect(top).toHaveLength(2);

    // Country Sourdough was in:
    // ord-1: 5kg, sold for 360
    // ord-2: 2kg, sold for 140
    // ord-3: 10kg, sold for 700
    // Total qty: 17kg, Total rev: 1200
    const sourdough = top[0];
    expect(sourdough.recipeName).toBe('Country Sourdough');
    expect(sourdough.totalQuantity).toBe(17);
    expect(sourdough.outputUnit).toBe('kg');
    expect(sourdough.totalRevenue).toBe(1200);
    expect(sourdough.orderCount).toBe(3);

    // Butter Croissants: 24 pcs, rev: 500
    const croissants = top[1];
    expect(croissants.recipeName).toBe('Butter Croissants');
    expect(croissants.totalQuantity).toBe(24);
    expect(croissants.outputUnit).toBe('pcs');
    expect(croissants.totalRevenue).toBe(500);
  });

  it('calculates monthly ingredient usage, unit conversions, and inventory recommendations', () => {
    const ordersWithIngredients: Order[] = [
      {
        ...sampleOrders[0],
        date: '2026-03-02T10:00:00.000Z',
        aggregatedIngredients: [
          { name: 'Bread Flour', quantity: 2500, unit: 'g', totalCost: 150 },
          { name: 'Butter', quantity: 500, unit: 'g', totalCost: 300 }
        ]
      },
      {
        ...sampleOrders[1],
        date: '2026-03-15T12:00:00.000Z',
        aggregatedIngredients: [
          { name: 'Bread Flour', quantity: 1.5, unit: 'kg', totalCost: 90 },
          { name: 'Fresh Farm Egg', quantity: 12, unit: 'pcs', totalCost: 96 }
        ]
      },
      {
        ...sampleOrders[2],
        date: '2026-02-20T10:00:00.000Z',
        aggregatedIngredients: [
          { name: 'Bread Flour', quantity: 3, unit: 'kg', totalCost: 180 }
        ]
      }
    ];

    const months = getAvailableOrderMonths(ordersWithIngredients);
    expect(months.map((m) => m.key)).toEqual(['2026-03', '2026-02']);

    const marchReport = calculateMonthlyIngredientUsage(ordersWithIngredients, '2026-03', 10);
    expect(marchReport.monthKey).toBe('2026-03');
    expect(marchReport.totalDistinctIngredients).toBe(3);
    expect(marchReport.totalIngredientSpend).toBe(636); // 150+300+90+96

    // Bread flour: 2500g + 1.5kg = 4kg total
    const flour = marchReport.items.find((i) => i.name.toLowerCase().includes('flour'));
    expect(flour).toBeDefined();
    expect(flour?.totalQuantity).toBe(4);
    expect(flour?.unit).toBe('kg');
    expect(flour?.totalCost).toBe(240); // 150 + 90
    expect(flour?.previousMonthQuantity).toBe(3); // 3kg in Feb
    expect(flour?.quantityChangePercent).toBe(33.3); // (4-3)/3 = +33.3%
    expect(flour?.recommendedOrderQty).toBe(4.4); // 4 + 10%
    expect(flour?.projectedOrderCost).toBe(264);

    // Butter: 500g (stays in g because < 1000g)
    const butter = marchReport.items.find((i) => i.name === 'Butter');
    expect(butter).toBeDefined();
    expect(butter?.totalQuantity).toBe(500);
    expect(butter?.unit).toBe('g');
    expect(butter?.recommendedOrderQty).toBe(550);
  });
});
