import { RecipeIngredientItem, UnitType, AggregatedIngredient, OrderItem } from '../types';

/**
 * Returns estimated weight in grams for an ingredient amount.
 */
export function getIngredientWeightInGrams(
  quantity: number,
  unit: UnitType,
  gramEquivalent?: number
): number {
  switch (unit) {
    case 'g':
      return quantity;
    case 'kg':
      return quantity * 1000;
    case 'ml':
      return quantity * (gramEquivalent ?? 1); // default water density: 1g/ml
    case 'l':
      return quantity * 1000 * (gramEquivalent ? gramEquivalent / 1000 : 1);
    case 'pcs':
      return quantity * (gramEquivalent ?? 50); // default egg/piece: 50g
    default:
      return quantity;
  }
}

/**
 * Calculates total raw dough/batter weight in grams from ingredients.
 */
export function calculateRecipeRawWeight(ingredients: RecipeIngredientItem[]): number {
  return ingredients.reduce((sum, item) => {
    return sum + getIngredientWeightInGrams(item.quantity, item.unit, item.gramEquivalent);
  }, 0);
}

/**
 * Normalizes cost per unit when switching between units.
 * Example: ₹60 per kg -> ₹0.06 per g.
 */
export function convertCostUnit(
  cost: number,
  fromUnit: UnitType,
  toUnit: UnitType
): number {
  if (fromUnit === toUnit) return cost;
  if (fromUnit === 'kg' && toUnit === 'g') return cost / 1000;
  if (fromUnit === 'g' && toUnit === 'kg') return cost * 1000;
  if (fromUnit === 'l' && toUnit === 'ml') return cost / 1000;
  if (fromUnit === 'ml' && toUnit === 'l') return cost * 1000;
  return cost;
}

/**
 * Calculates unit cost from a fractional / pack purchase.
 * Example: 400 g costs ₹240, target unit is kg -> returns 600 (₹600/kg)
 * Example: 400 g costs ₹240, target unit is g -> returns 0.6 (₹0.6/g)
 */
export function calculateFractionalCost(options: {
  packQuantity: number;
  packUnit: UnitType;
  packPrice: number;
  targetUnit: UnitType;
}): number {
  const { packQuantity, packUnit, packPrice, targetUnit } = options;
  if (packQuantity <= 0 || packPrice < 0) return 0;
  const rawCost = packPrice / packQuantity;
  const converted = convertCostUnit(rawCost, packUnit, targetUnit);
  return Math.round(converted * 10000) / 10000;
}

/**
 * Computes multiplier for recipe scaling given base output and target output.
 * Example: base recipe yields 1 kg, target is 3.5 kg -> multiplier is 3.5x.
 * Example: base recipe yields 12 pcs, target is 36 pcs -> multiplier is 3x.
 */
export function calculateScaleMultiplier(
  baseOutput: number,
  targetOutput: number
): number {
  if (baseOutput <= 0 || targetOutput <= 0) return 1;
  return Math.round((targetOutput / baseOutput) * 10000) / 10000;
}

/**
 * Scales ingredient items by a given multiplier.
 */
export function scaleIngredients(
  ingredients: RecipeIngredientItem[],
  multiplier: number
): RecipeIngredientItem[] {
  return ingredients.map((item) => {
    const rawQty = item.quantity * multiplier;
    // Round to sensible precision (2 decimals)
    const quantity = Math.round(rawQty * 100) / 100;
    return {
      ...item,
      quantity
    };
  });
}

/**
 * Computes cost for a single scaled ingredient line item.
 */
export function calculateIngredientCost(item: RecipeIngredientItem): number {
  return Math.round(item.quantity * item.costPerUnit * 100) / 100;
}

/**
 * Computes overall recipe / order item pricing.
 */
export function calculateItemPricing(options: {
  scaledIngredients: RecipeIngredientItem[];
  overheadCost?: number;
  markupPercent?: number;
  targetUnits?: number;
}): {
  ingredientCost: number;
  overheadCost: number;
  totalCost: number;
  sellingPrice: number;
  unitPrice?: number;
} {
  const { scaledIngredients, overheadCost = 0, markupPercent = 0, targetUnits } = options;

  const ingredientCost = scaledIngredients.reduce((acc, item) => {
    return acc + calculateIngredientCost(item);
  }, 0);

  const roundedIngredientCost = Math.round(ingredientCost * 100) / 100;
  const totalCost = Math.round((roundedIngredientCost + overheadCost) * 100) / 100;
  const markupMultiplier = 1 + markupPercent / 100;
  const sellingPrice = Math.round(totalCost * markupMultiplier * 100) / 100;

  const unitPrice =
    targetUnits && targetUnits > 0
      ? Math.round((sellingPrice / targetUnits) * 100) / 100
      : undefined;

  return {
    ingredientCost: roundedIngredientCost,
    overheadCost,
    totalCost,
    sellingPrice,
    unitPrice
  };
}

/**
 * Combines identical ingredients across multiple order items into a consolidated prep/grocery list.
 */
export function aggregateOrderIngredients(items: OrderItem[]): AggregatedIngredient[] {
  const map = new Map<string, { quantity: number; unit: UnitType; totalCost: number }>();

  for (const item of items) {
    for (const ing of item.scaledIngredients) {
      const key = `${ing.name.trim().toLowerCase()}__${ing.unit}`;
      const cost = calculateIngredientCost(ing);
      const existing = map.get(key);

      if (existing) {
        existing.quantity = Math.round((existing.quantity + ing.quantity) * 100) / 100;
        existing.totalCost = Math.round((existing.totalCost + cost) * 100) / 100;
      } else {
        map.set(key, {
          quantity: ing.quantity,
          unit: ing.unit,
          totalCost: cost
        });
      }
    }
  }

  const results: AggregatedIngredient[] = [];
  map.forEach((val, key) => {
    const [name] = key.split('__');
    // Capitalize first letter of name
    const formattedName = name.charAt(0).toUpperCase() + name.slice(1);
    results.push({
      name: formattedName,
      quantity: val.quantity,
      unit: val.unit,
      totalCost: val.totalCost
    });
  });

  return results.sort((a, b) => a.name.localeCompare(b.name));
}
