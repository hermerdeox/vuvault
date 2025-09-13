import Dexie, { Table } from 'dexie';
import { encrypt, decrypt } from '@metamask/browser-passworder';

export interface VaultItem {
  id?: string;
  service: string;
  username: string;
  encryptedPassword: string;
  notes?: string;
  url?: string;
  tags?: string[];
  favorite?: boolean;
  lastAccessed?: number;
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  id?: string;
  key: string;
  value: any;
}

class VaultDatabase extends Dexie {
  vaults!: Table<VaultItem>;
  settings!: Table<Settings>;

  constructor() {
    super('EOXVaultDB');
    
    this.version(1).stores({
      vaults: '++id, service, username, favorite, createdAt, updatedAt',
      settings: '++id, &key'
    });

    // Encryption middleware
    this.vaults.hook('creating', async (primKey, obj, trans) => {
      const masterKey = await this.getMasterKey();
      if (!masterKey) throw new Error('No master key available');
      
      // Encrypt sensitive data
      if (obj.encryptedPassword) {
        obj.encryptedPassword = await encrypt(masterKey, obj.encryptedPassword);
      }
      if (obj.notes) {
        obj.notes = await encrypt(masterKey, obj.notes);
      }
      
      obj.createdAt = Date.now();
      obj.updatedAt = Date.now();
    });

    this.vaults.hook('updating', async (mods: any, primKey, obj, trans) => {
      const masterKey = await this.getMasterKey();
      if (!masterKey) throw new Error('No master key available');
      
      if (mods.encryptedPassword !== undefined) {
        mods.encryptedPassword = await encrypt(masterKey, mods.encryptedPassword);
      }
      if (mods.notes !== undefined) {
        mods.notes = await encrypt(masterKey, mods.notes);
      }
      
      mods.updatedAt = Date.now();
      return mods;
    });

    this.vaults.hook('reading', async (obj: any) => {
      const masterKey = await this.getMasterKey();
      if (!masterKey) return obj;
      
      try {
        if (obj.encryptedPassword) {
          obj.encryptedPassword = await decrypt(masterKey, obj.encryptedPassword);
        }
        if (obj.notes) {
          obj.notes = await decrypt(masterKey, obj.notes);
        }
      } catch (error) {
        console.error('Decryption failed:', error);
      }
      
      return obj;
    });
  }

  private async getMasterKey(): Promise<string | null> {
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

export class DatabaseService {
  private static instance: DatabaseService;
  private db: VaultDatabase;

  private constructor() {
    this.db = new VaultDatabase();
  }

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
          const urlMatch = item.url ? item.url.toLowerCase().includes(lowerQuery) : false;
          const tagsMatch = item.tags ? item.tags.some(tag => tag.toLowerCase().includes(lowerQuery)) : false;
          
          return serviceMatch || usernameMatch || urlMatch || tagsMatch;
        })
        .toArray();
    } catch (error) {
      console.error('Search failed:', error);
      return [];
    }
  }

  async setMasterKey(key: string): Promise<void> {
    await this.db.setMasterKey(key);
  }

  async clearAllData(): Promise<void> {
    try {
      await this.db.vaults.clear();
      await this.db.settings.clear();
    } catch (error) {
      console.error('Failed to clear data:', error);
      throw new Error('Failed to clear vault data');
    }
  }
}
