import {
  CatalogIngredient,
  Recipe,
  Order,
  AppSettings,
  FullBackupData
} from '../types';

const DB_NAME = 'BakeMasterDB';
const DB_VERSION = 1;

export class DatabaseService {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('ingredients')) {
          db.createObjectStore('ingredients', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('recipes')) {
          db.createObjectStore('recipes', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('orders')) {
          db.createObjectStore('orders', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('handles')) {
          db.createObjectStore('handles', { keyPath: 'key' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return this.dbPromise;
  }

  private async perform<T>(
    storeName: string,
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest
  ): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const req = action(store);

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private async getAll<T>(storeName: string): Promise<T[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  // --- Ingredients ---
  async getIngredients(): Promise<CatalogIngredient[]> {
    return this.getAll<CatalogIngredient>('ingredients');
  }

  async saveIngredient(ingredient: CatalogIngredient): Promise<void> {
    await this.perform('ingredients', 'readwrite', (store) => store.put(ingredient));
  }

  async deleteIngredient(id: string): Promise<void> {
    await this.perform('ingredients', 'readwrite', (store) => store.delete(id));
  }

  // --- Recipes ---
  async getRecipes(): Promise<Recipe[]> {
    return this.getAll<Recipe>('recipes');
  }

  async saveRecipe(recipe: Recipe): Promise<void> {
    await this.perform('recipes', 'readwrite', (store) => store.put(recipe));
  }

  async deleteRecipe(id: string): Promise<void> {
    await this.perform('recipes', 'readwrite', (store) => store.delete(id));
  }

  // --- Orders ---
  async getOrders(): Promise<Order[]> {
    const orders = await this.getAll<Order>('orders');
    return orders.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  async saveOrder(order: Order): Promise<void> {
    await this.perform('orders', 'readwrite', (store) => store.put(order));
  }

  async deleteOrder(id: string): Promise<void> {
    await this.perform('orders', 'readwrite', (store) => store.delete(id));
  }

  // --- Settings ---
  async getSettings(): Promise<AppSettings> {
    const defaultSettings: AppSettings = {
      currencySymbol: '₹',
      bakeryName: 'Cloud & Crust',
      isFolderConnected: false
    };

    try {
      const record = await this.perform<{ key: string; value: AppSettings } | undefined>(
        'settings',
        'readonly',
        (store) => store.get('app_settings')
      );
      return record?.value ?? defaultSettings;
    } catch {
      return defaultSettings;
    }
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    await this.perform('settings', 'readwrite', (store) =>
      store.put({ key: 'app_settings', value: settings })
    );
  }

  // --- Directory Handle for File System Access API ---
  async saveDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
    await this.perform('handles', 'readwrite', (store) =>
      store.put({ key: 'sync_folder', handle })
    );
  }

  async getDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
    try {
      const record = await this.perform<{ key: string; handle: FileSystemDirectoryHandle } | undefined>(
        'handles',
        'readonly',
        (store) => store.get('sync_folder')
      );
      return record?.handle ?? null;
    } catch {
      return null;
    }
  }

  async clearDirectoryHandle(): Promise<void> {
    await this.perform('handles', 'readwrite', (store) => store.delete('sync_folder'));
  }

  // --- Full Backup & Restore ---
  async getAllData(): Promise<FullBackupData> {
    const [ingredients, recipes, orders, settings] = await Promise.all([
      this.getIngredients(),
      this.getRecipes(),
      this.getOrders(),
      this.getSettings()
    ]);

    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      ingredients,
      recipes,
      orders,
      settings
    };
  }

  async restoreAllData(data: FullBackupData): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(['ingredients', 'recipes', 'orders', 'settings'], 'readwrite');

    const ingStore = tx.objectStore('ingredients');
    const recStore = tx.objectStore('recipes');
    const ordStore = tx.objectStore('orders');
    const setStore = tx.objectStore('settings');

    ingStore.clear();
    recStore.clear();
    ordStore.clear();

    for (const ing of data.ingredients || []) {
      ingStore.put(ing);
    }
    for (const rec of data.recipes || []) {
      recStore.put(rec);
    }
    for (const ord of data.orders || []) {
      ordStore.put(ord);
    }
    if (data.settings) {
      setStore.put({ key: 'app_settings', value: data.settings });
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // Initialize with seed data if DB is empty
  async seedIfEmpty(): Promise<void> {
    const recipes = await this.getRecipes();
    if (recipes.length > 0) return;

    const defaultIngredients: CatalogIngredient[] = [
      { id: 'ing-1', name: 'Bread Flour', defaultUnit: 'kg', costPerUnit: 60, updatedAt: new Date().toISOString() },
      { id: 'ing-2', name: 'Water', defaultUnit: 'ml', costPerUnit: 0.005, gramEquivalent: 1, updatedAt: new Date().toISOString() },
      { id: 'ing-3', name: 'Sea Salt', defaultUnit: 'g', costPerUnit: 0.03, updatedAt: new Date().toISOString() },
      { id: 'ing-4', name: 'Active Dry Yeast', defaultUnit: 'g', costPerUnit: 0.5, updatedAt: new Date().toISOString() },
      { id: 'ing-5', name: 'Butter (Unsalted)', defaultUnit: 'g', costPerUnit: 0.6, updatedAt: new Date().toISOString() },
      { id: 'ing-6', name: 'Granulated Sugar', defaultUnit: 'kg', costPerUnit: 48, updatedAt: new Date().toISOString() },
      { id: 'ing-7', name: 'Fresh Farm Egg', defaultUnit: 'pcs', costPerUnit: 8, gramEquivalent: 50, updatedAt: new Date().toISOString() },
      { id: 'ing-8', name: 'Whole Milk', defaultUnit: 'ml', costPerUnit: 0.07, gramEquivalent: 1.03, updatedAt: new Date().toISOString() }
    ];

    for (const ing of defaultIngredients) {
      await this.saveIngredient(ing);
    }

    const sourdough: Recipe = {
      id: 'rec-1',
      name: 'Artisan Country Sourdough',
      category: 'Breads',
      description: 'Classic rustic sourdough loaf with crisp blistered crust and open crumb.',
      outputValue: 1,
      outputUnit: 'kg',
      defaultMarkupPercent: 40,
      defaultOverheadCost: 35,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ingredients: [
        { id: 'ri-1', ingredientId: 'ing-1', name: 'Bread Flour', quantity: 500, unit: 'g', costPerUnit: 0.06 },
        { id: 'ri-2', ingredientId: 'ing-2', name: 'Water', quantity: 350, unit: 'ml', costPerUnit: 0.005, gramEquivalent: 1 },
        { id: 'ri-3', ingredientId: 'ing-3', name: 'Sea Salt', quantity: 10, unit: 'g', costPerUnit: 0.03 },
        { id: 'ri-4', ingredientId: 'ing-4', name: 'Active Dry Yeast', quantity: 5, unit: 'g', costPerUnit: 0.5 }
      ]
    };

    const butterCookies: Recipe = {
      id: 'rec-2',
      name: 'Rich Butter Cookies',
      category: 'Cookies',
      description: 'Melt-in-mouth golden vanilla butter cookies.',
      outputValue: 24,
      outputUnit: 'pcs',
      defaultMarkupPercent: 50,
      defaultOverheadCost: 40,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ingredients: [
        { id: 'ri-5', ingredientId: 'ing-5', name: 'Butter (Unsalted)', quantity: 200, unit: 'g', costPerUnit: 0.6 },
        { id: 'ri-6', ingredientId: 'ing-6', name: 'Granulated Sugar', quantity: 120, unit: 'g', costPerUnit: 0.048 },
        { id: 'ri-7', ingredientId: 'ing-7', name: 'Fresh Farm Egg', quantity: 1, unit: 'pcs', costPerUnit: 8, gramEquivalent: 50 },
        { id: 'ri-8', ingredientId: 'ing-1', name: 'Bread Flour', quantity: 300, unit: 'g', costPerUnit: 0.06 }
      ]
    };

    await this.saveRecipe(sourdough);
    await this.saveRecipe(butterCookies);
  }
}

export const dbService = new DatabaseService();
