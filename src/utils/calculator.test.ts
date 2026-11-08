import { describe, it, expect } from 'vitest';
import {
  getIngredientWeightInGrams,
  calculateRecipeRawWeight,
  calculateScaleMultiplier,
  scaleIngredients,
  calculateItemPricing,
  aggregateOrderIngredients,
  convertCostUnit,
  calculateFractionalCost
} from './calculator';
import { RecipeIngredientItem, OrderItem } from '../types';

describe('Calculator Utility Math', () => {
  it('converts units to grams accurately', () => {
    expect(getIngredientWeightInGrams(500, 'g')).toBe(500);
    expect(getIngredientWeightInGrams(1.5, 'kg')).toBe(1500);
    expect(getIngredientWeightInGrams(250, 'ml')).toBe(250);
    expect(getIngredientWeightInGrams(2, 'pcs', 60)).toBe(120);
    expect(getIngredientWeightInGrams(3, 'pcs')).toBe(150);
  });

  it('calculates total raw recipe weight', () => {
    const ingredients: RecipeIngredientItem[] = [
      { id: '1', name: 'Flour', quantity: 500, unit: 'g', costPerUnit: 0.05 },
      { id: '2', name: 'Water', quantity: 350, unit: 'ml', costPerUnit: 0.001 },
      { id: '3', name: 'Salt', quantity: 10, unit: 'g', costPerUnit: 0.02 },
      { id: '4', name: 'Yeast', quantity: 5, unit: 'g', costPerUnit: 0.2 }
    ];
    expect(calculateRecipeRawWeight(ingredients)).toBe(865);
  });

  it('scales recipe based on target kg output', () => {
    // Base recipe yields 1 kg, user wants 2.5 kg -> 2.5x multiplier
    const multiplier = calculateScaleMultiplier(1, 2.5);
    expect(multiplier).toBe(2.5);

    const ingredients: RecipeIngredientItem[] = [
      { id: '1', name: 'Flour', quantity: 500, unit: 'g', costPerUnit: 0.05 }
    ];
    const scaled = scaleIngredients(ingredients, multiplier);
    expect(scaled[0].quantity).toBe(1250);
  });

  it('scales recipe by number of pieces', () => {
    // Base recipe yields 12 pieces, user wants 36 pieces -> 3x multiplier
    const multiplier = calculateScaleMultiplier(12, 36);
    expect(multiplier).toBe(3);
  });

  it('calculates cost, markup and unit price in ₹', () => {
    const scaledIngredients: RecipeIngredientItem[] = [
      { id: '1', name: 'Flour', quantity: 1000, unit: 'g', costPerUnit: 0.06 }, // ₹60
      { id: '2', name: 'Butter', quantity: 200, unit: 'g', costPerUnit: 0.5 }, // ₹100
      { id: '3', name: 'Sugar', quantity: 150, unit: 'g', costPerUnit: 0.05 }  // ₹7.5
    ]; // Total ingredients = 167.50

    const pricing = calculateItemPricing({
      scaledIngredients,
      overheadCost: 32.50, // Total cost = 167.50 + 32.50 = 200.00
      markupPercent: 50,   // 50% markup -> ₹300.00
      targetUnits: 4       // 4 cakes -> ₹75.00 each
    });

    expect(pricing.ingredientCost).toBe(167.50);
    expect(pricing.overheadCost).toBe(32.50);
    expect(pricing.totalCost).toBe(200.00);
    expect(pricing.sellingPrice).toBe(300.00);
    expect(pricing.unitPrice).toBe(75.00);
  });

  it('aggregates ingredients across multiple recipes in an order', () => {
    const orderItems: OrderItem[] = [
      {
        recipeId: 'r1',
        recipeName: 'Sourdough',
        outputValue: 2,
        outputUnit: 'kg',
        scaleMultiplier: 2,
        ingredientCost: 100,
        overheadCost: 20,
        markupPercent: 40,
        totalCost: 120,
        sellingPrice: 168,
        scaledIngredients: [
          { id: 'i1', name: 'Flour', quantity: 1000, unit: 'g', costPerUnit: 0.05 },
          { id: 'i2', name: 'Salt', quantity: 20, unit: 'g', costPerUnit: 0.02 }
        ]
      },
      {
        recipeId: 'r2',
        recipeName: 'Baguette',
        outputValue: 1,
        outputUnit: 'kg',
        scaleMultiplier: 1,
        ingredientCost: 55,
        overheadCost: 10,
        markupPercent: 40,
        totalCost: 65,
        sellingPrice: 91,
        scaledIngredients: [
          { id: 'i3', name: 'Flour', quantity: 500, unit: 'g', costPerUnit: 0.05 },
          { id: 'i4', name: 'Yeast', quantity: 5, unit: 'g', costPerUnit: 0.2 }
        ]
      }
    ];

    const aggregated = aggregateOrderIngredients(orderItems);
    expect(aggregated).toHaveLength(3);

    const flour = aggregated.find((i) => i.name.toLowerCase() === 'flour');
    expect(flour).toBeDefined();
    expect(flour?.quantity).toBe(1500);
    expect(flour?.totalCost).toBe(75);
  });

  it('converts cost unit correctly', () => {
    expect(convertCostUnit(60, 'kg', 'g')).toBe(0.06);
    expect(convertCostUnit(0.06, 'g', 'kg')).toBe(60);
    expect(convertCostUnit(100, 'l', 'ml')).toBe(0.1);
  });

  it('calculates fractional pack cost accurately', () => {
    // 400 gms costs ₹240 -> unit cost in g is ₹0.6/g, unit cost in kg is ₹600/kg
    expect(
      calculateFractionalCost({
        packQuantity: 400,
        packUnit: 'g',
        packPrice: 240,
        targetUnit: 'g'
      })
    ).toBe(0.6);

    expect(
      calculateFractionalCost({
        packQuantity: 400,
        packUnit: 'g',
        packPrice: 240,
        targetUnit: 'kg'
      })
    ).toBe(600);

    // 25 kg sack costs ₹1000 -> in g is ₹0.04/g
    expect(
      calculateFractionalCost({
        packQuantity: 25,
        packUnit: 'kg',
        packPrice: 1000,
        targetUnit: 'g'
      })
    ).toBe(0.04);
  });
});
