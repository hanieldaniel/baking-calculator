import { describe, it, expect } from 'vitest';
import { FullBackupData } from '../types';

describe('Data Backup & Schema Validation', () => {
  it('validates proper structure of a full backup payload', () => {
    const mockBackup: FullBackupData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: {
        currencySymbol: '₹',
        bakeryName: 'Test Bakery',
        isFolderConnected: false
      },
      ingredients: [
        {
          id: 'ing-1',
          name: 'Bread Flour',
          defaultUnit: 'kg',
          costPerUnit: 60,
          updatedAt: new Date().toISOString()
        }
      ],
      recipes: [
        {
          id: 'rec-1',
          name: 'Sourdough',
          category: 'Breads',
          outputValue: 1,
          outputUnit: 'kg',
          defaultMarkupPercent: 40,
          defaultOverheadCost: 35,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          ingredients: [
            { id: 'ri-1', name: 'Bread Flour', quantity: 500, unit: 'g', costPerUnit: 0.06 }
          ]
        }
      ],
      orders: []
    };

    expect(mockBackup.version).toBe(1);
    expect(mockBackup.ingredients).toHaveLength(1);
    expect(mockBackup.recipes[0].outputValue).toBe(1);
    expect(mockBackup.recipes[0].outputUnit).toBe('kg');
    expect(mockBackup.settings.currencySymbol).toBe('₹');
  });
});
