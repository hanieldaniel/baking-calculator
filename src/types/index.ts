export type UnitType = 'g' | 'kg' | 'ml' | 'l' | 'pcs';

export interface CatalogIngredient {
  id: string;
  name: string;
  defaultUnit: UnitType;
  costPerUnit: number; // cost in ₹ per defaultUnit (e.g. ₹ per kg, ₹ per g, ₹ per piece)
  gramEquivalent?: number; // for non-weight units (ml, l, pcs): equivalent weight in grams for 1 unit
  purchaseQuantity?: number; // e.g. 400
  purchaseUnit?: UnitType; // e.g. 'g'
  purchasePrice?: number; // e.g. 240
  updatedAt: string;
}

export interface RecipeIngredientItem {
  id: string;
  ingredientId?: string; // Optional link to catalog ingredient
  name: string;
  quantity: number;
  unit: UnitType;
  costPerUnit: number;
  gramEquivalent?: number; // Weight in grams for 1 unit if count/volume
}

export interface Recipe {
  id: string;
  name: string;
  category: string;
  description?: string;
  outputValue: number; // e.g. 1 for 1 kg, or 12 for 12 pcs
  outputUnit: 'kg' | 'pcs'; // 'kg' or 'pcs'
  bakeLossPercent?: number;
  baseYieldWeightGrams?: number;
  baseYieldUnits?: number;
  ingredients: RecipeIngredientItem[];
  defaultMarkupPercent: number; // e.g. 40 for 40% markup
  defaultOverheadCost: number; // e.g. 50 in ₹
  createdAt: string;
  updatedAt: string;
}

export interface OrderItem {
  recipeId: string;
  recipeName: string;
  outputValue: number;
  outputUnit: 'kg' | 'pcs';
  scaleMultiplier: number;
  scaledIngredients: RecipeIngredientItem[];
  ingredientCost: number;
  overheadCost: number;
  markupPercent: number;
  totalCost: number;
  sellingPrice: number;
  unitPrice?: number;
  soldAtPrice?: number; // Optional actual price charged
  bakeLossPercent?: number;
  targetWeightGrams?: number;
  targetUnits?: number;
}

export interface AggregatedIngredient {
  name: string;
  quantity: number;
  unit: UnitType;
  totalCost: number;
}

export interface Order {
  id: string;
  orderNumber: string;
  title: string;
  customerName?: string;
  date: string;
  deliveryDate?: string;
  items: OrderItem[];
  aggregatedIngredients: AggregatedIngredient[];
  totalIngredientCost: number;
  totalOverheadCost: number;
  totalCost: number;
  totalSellingPrice: number;
  totalSoldAtPrice?: number; // Optional actual sold price
  quotaDifference?: number; // totalSoldAtPrice - totalSellingPrice
  notes?: string;
}

export interface AppSettings {
  currencySymbol: string;
  bakeryName: string;
  lastSyncTime?: string;
  isFolderConnected: boolean;
}

export interface FullBackupData {
  version: number;
  exportedAt: string;
  ingredients: CatalogIngredient[];
  recipes: Recipe[];
  orders: Order[];
  settings: AppSettings;
}
