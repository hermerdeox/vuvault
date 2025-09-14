import Dexie, { Table } from 'dexie';

export interface VaultItem {
  id?: string;
  service: string;
  username: string;
  encryptedPassword: string;
  password?: string; // Decrypted password (populated by reading hook)
  notes?: string;
  url?: string;
  tags?: string[];
  favorite?: boolean;
  folder?: string;
  totp?: string;
  lastAccessed?: number;
  lastUsed?: number;
  nonce?: number[];
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  id?: string;
  key: string;
  value: any;
  updatedAt?: number;
}

class VaultDatabase extends Dexie {
  vaults!: Table<VaultItem>;
  settings!: Table<Settings>;

  constructor() {
    super('VuVaultDB');
    
    this.version(1).stores({
      vaults: '++id, service, username, favorite, createdAt, updatedAt',
      settings: '++id, &key'
    });

    // Encryption middleware
    this.vaults.hook('creating', async (primKey, obj, trans) => {
      const masterKey = await this.getMasterKey();
      if (!masterKey) throw new Error('No master key available');
      
      // Encrypt sensitive data - encryptedPassword should contain plain password at this point
      if (obj.encryptedPassword) {
        // Simple base64 encoding for now to test the flow
        // We'll replace with real encryption once flow is working
        const encoded = btoa(unescape(encodeURIComponent(obj.encryptedPassword)));
        obj.encryptedPassword = `ENC:${masterKey.substring(0, 4)}:${encoded}`;
      }
      if (obj.notes) {
        const encoded = btoa(unescape(encodeURIComponent(obj.notes)));
        obj.notes = `ENC:${masterKey.substring(0, 4)}:${encoded}`;
      }
      
      obj.createdAt = Date.now();
      obj.updatedAt = Date.now();
    });

    this.vaults.hook('updating', async (mods: any, primKey, obj, trans) => {
      const masterKey = await this.getMasterKey();
      if (!masterKey) throw new Error('No master key available');
      
      if (mods.encryptedPassword !== undefined) {
        const encoded = btoa(unescape(encodeURIComponent(mods.encryptedPassword)));
        mods.encryptedPassword = `ENC:${masterKey.substring(0, 4)}:${encoded}`;
      }
      if (mods.notes !== undefined) {
        const encoded = btoa(unescape(encodeURIComponent(mods.notes)));
        mods.notes = `ENC:${masterKey.substring(0, 4)}:${encoded}`;
      }
      
      mods.updatedAt = Date.now();
      return mods;
    });

    this.vaults.hook('reading', async (obj: any) => {
      const masterKey = await this.getMasterKey();
      if (!masterKey) return obj;
      
      try {
        if (obj.encryptedPassword && typeof obj.encryptedPassword === 'string') {
          // Check if it's encrypted (starts with ENC:)
          if (obj.encryptedPassword.startsWith('ENC:')) {
            const parts = obj.encryptedPassword.split(':');
            if (parts.length >= 3 && parts[1] === masterKey.substring(0, 4)) {
              // Decrypt and store in 'password' field for UI components
              const decoded = decodeURIComponent(escape(atob(parts[2])));
              obj.password = decoded;
            } else {
              // Wrong key or corrupted data
              obj.password = '';
            }
          } else {
            // Not encrypted, use as-is (migration case)
            obj.password = obj.encryptedPassword;
          }
        }
        
        if (obj.notes && typeof obj.notes === 'string' && obj.notes.startsWith('ENC:')) {
          const parts = obj.notes.split(':');
          if (parts.length >= 3 && parts[1] === masterKey.substring(0, 4)) {
            obj.notes = decodeURIComponent(escape(atob(parts[2])));
          }
        }
      } catch (error) {
        console.error('Decryption failed:', error);
        obj.password = '';
      }
      
      return obj;
    });
  }

  async getMasterKey(): Promise<string | null> {
    try {
      const keyData = await this.settings.where('key').equals('masterKey').first();
      return keyData?.value || null;
    } catch {
      return null;
    }
  }

  async setMasterKey(key: string): Promise<void> {
    await this.settings.put({ key: 'masterKey', value: key });
  }
}

export const db = new VaultDatabase();

// Export convenience functions for master key management
export async function getMasterKey(): Promise<string | null> {
  return await db.getMasterKey();
}

export async function setMasterKey(key: string): Promise<void> {
  return await db.setMasterKey(key);
}

export class DatabaseService {
  private static instance: DatabaseService;
  private db = db;

  private constructor() {}

  static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  async initialize(): Promise<void> {
    try {
      await this.db.open();
      console.log('Database initialized');
    } catch (error) {
      console.error('Database initialization failed:', error);
      throw error;
    }
  }

  async addVaultItem(item: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    try {
      const id = await this.db.vaults.add({
        ...item,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      return String(id);
    } catch (error) {
      console.error('Failed to add vault item:', error);
      throw new Error('Failed to save password');
    }
  }

  async updateVaultItem(id: string, updates: Partial<VaultItem>): Promise<void> {
    try {
      await this.db.vaults.update(id, updates);
    } catch (error) {
      console.error('Failed to update vault item:', error);
      throw new Error('Failed to update password');
    }
  }

  async deleteVaultItem(id: string): Promise<void> {
    try {
      await this.db.vaults.delete(id);
    } catch (error) {
      console.error('Failed to delete vault item:', error);
      throw new Error('Failed to delete password');
    }
  }

  async getVaultItem(id: string): Promise<VaultItem | undefined> {
    try {
      return await this.db.vaults.get(id);
    } catch (error) {
      console.error('Failed to get vault item:', error);
      return undefined;
    }
  }

  async getAllVaultItems(): Promise<VaultItem[]> {
    try {
      return await this.db.vaults.toArray();
    } catch (error) {
      console.error('Failed to get vault items:', error);
      return [];
    }
  }

  async searchVaultItems(query: string): Promise<VaultItem[]> {
    try {
      const lowerQuery = query.toLowerCase();
      return await this.db.vaults
        .filter(item => {
          const serviceMatch = item.service.toLowerCase().includes(lowerQuery);
          const usernameMatch = item.username.toLowerCase().includes(lowerQuery);
          const urlMatch = item.url?.toLowerCase().includes(lowerQuery) || false;
          return serviceMatch || usernameMatch || urlMatch;
        })
        .toArray();
    } catch (error) {
      console.error('Search failed:', error);
      return [];
    }
  }

  async clearAllData(): Promise<void> {
    try {
      await this.db.vaults.clear();
      await this.db.settings.clear();
    } catch (error) {
      console.error('Failed to clear data:', error);
      throw new Error('Failed to clear all data');
    }
  }

  async exportData(format: 'json' | 'csv' = 'json'): Promise<string> {
    try {
      const items = await this.getAllVaultItems();
      
      if (format === 'csv') {
        const { CSVImporter } = await import('../import/csv-importer');
        return CSVImporter.exportToCSV(items);
      }
      
      // JSON export
      const exportData = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        items: items.map(item => ({
          ...item,
          // Don't export the encrypted password, export the decrypted one
          password: item.password,
          encryptedPassword: undefined
        }))
      };
      
      return JSON.stringify(exportData, null, 2);
    } catch (error) {
      console.error('Export failed:', error);
      throw new Error('Failed to export data');
    }
  }
}
