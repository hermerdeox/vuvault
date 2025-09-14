// Master File Handler for VuVault Zero
// Handles .vu files - encrypted containers with all vault data, settings, and metadata
// Format: {random5}_date.vu (e.g., A3X9K_141225.vu)

import { VaultItem, DatabaseService, db } from '../db/database';
import { EnhancedCryptoService } from '../crypto/enhanced-crypto-service';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha512 } from '@noble/hashes/sha2';
import { randomBytes } from '@noble/hashes/utils';
import { chacha20poly1305 } from '@noble/ciphers/chacha';

export interface MasterFileData {
  version: string;
  exported: string;
  deviceId: string;
  metadata: {
    itemCount: number;
    settingsCount: number;
    exportDevice: string;
    exportOS: string;
    lastModified: string;
  };
  settings: {
    autoLockTimeout?: number;
    theme?: 'dark' | 'light' | 'auto';
    biometricEnabled?: boolean;
    passwordGeneratorSettings?: {
      length: number;
      includeUppercase: boolean;
      includeLowercase: boolean;
      includeNumbers: boolean;
      includeSymbols: boolean;
    };
    securitySettings?: {
      requireMasterPasswordReentry: number;
      clearClipboardTimeout: number;
      hidePasswords: boolean;
    };
    [key: string]: any;
  };
  vaultItems: VaultItem[];
  customData?: {
    folders?: string[];
    tags?: string[];
    templates?: any[];
    quickAccess?: string[];
  };
  checksum: string;
}

export interface MasterFileContainer {
  magic: string; // 'VUVAULT'
  version: number; // File format version
  encrypted: string; // Base64 encrypted data
  salt: string; // Base64 salt
  nonce: string; // Base64 nonce
  iterations: number; // PBKDF2 iterations
  timestamp: number;
  fingerprint: string; // File fingerprint for verification
}

export class MasterFileHandler {
  private static readonly MAGIC_HEADER = 'VUVAULT';
  private static readonly CURRENT_VERSION = 1;
  private static readonly ITERATIONS = 210000;
  private static readonly FILE_EXTENSION = '.vu';
  
  /**
   * Generate a random filename for the master file
   */
  static generateFilename(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let random = '';
    for (let i = 0; i < 5; i++) {
      random += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    const date = new Date();
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear().toString().slice(-2);
    
    return `${random}_${day}${month}${year}${this.FILE_EXTENSION}`;
  }
  
  /**
   * Export all vault data to a master .vu file
   */
  static async exportMasterFile(password: string): Promise<{ data: string; filename: string }> {
    try {
      const dbService = DatabaseService.getInstance();
      const crypto = EnhancedCryptoService.getEnhancedInstance();
      
      // Gather all data
      const vaultItems = await dbService.getAllVaultItems();
      const settings = await this.getAllSettings();
      
      // Create master data structure
      const masterData: MasterFileData = {
        version: '2.0.0',
        exported: new Date().toISOString(),
        deviceId: await this.getDeviceId(),
        metadata: {
          itemCount: vaultItems.length,
          settingsCount: Object.keys(settings).length,
          exportDevice: navigator.userAgent,
          exportOS: navigator.platform,
          lastModified: new Date().toISOString()
        },
        settings: {
          ...settings,
          autoLockTimeout: settings.autoLockTimeout || 900000, // 15 minutes
          theme: settings.theme || 'dark',
          biometricEnabled: settings.biometricEnabled || false,
          passwordGeneratorSettings: settings.passwordGeneratorSettings || {
            length: 20,
            includeUppercase: true,
            includeLowercase: true,
            includeNumbers: true,
            includeSymbols: true
          },
          securitySettings: settings.securitySettings || {
            requireMasterPasswordReentry: 30, // minutes
            clearClipboardTimeout: 60, // seconds
            hidePasswords: true
          }
        },
        vaultItems: vaultItems,
        customData: {
          folders: await this.getFolders(),
          tags: await this.getAllTags(vaultItems),
          templates: await this.getTemplates(),
          quickAccess: await this.getQuickAccessItems()
        },
        checksum: ''
      };
      
      // Calculate checksum
      masterData.checksum = await this.calculateChecksum(masterData);
      
      // Serialize data
      const jsonData = JSON.stringify(masterData);
      const dataBytes = new TextEncoder().encode(jsonData);
      
      // Generate encryption parameters
      const salt = randomBytes(32);
      const nonce = randomBytes(12);
      
      // Derive key from password
      const passwordBytes = new TextEncoder().encode(password);
      const key = await pbkdf2(sha512, passwordBytes, salt, {
        c: this.ITERATIONS,
        dkLen: 32
      });
      
      // Encrypt data
      const cipher = chacha20poly1305(key, nonce);
      const encrypted = cipher.encrypt(dataBytes);
      
      // Create container
      const container: MasterFileContainer = {
        magic: this.MAGIC_HEADER,
        version: this.CURRENT_VERSION,
        encrypted: this.bytesToBase64(encrypted),
        salt: this.bytesToBase64(salt),
        nonce: this.bytesToBase64(nonce),
        iterations: this.ITERATIONS,
        timestamp: Date.now(),
        fingerprint: await this.generateFingerprint(encrypted)
      };
      
      // Generate filename
      const filename = this.generateFilename();
      
      // Return base64 encoded container
      const containerData = btoa(JSON.stringify(container));
      
      return {
        data: containerData,
        filename
      };
      
    } catch (error) {
      console.error('Failed to export master file:', error);
      throw new Error('Failed to create master backup file');
    }
  }
  
  /**
   * Import a master .vu file
   */
  static async importMasterFile(fileContent: string, password: string): Promise<{
    success: boolean;
    itemsImported: number;
    settingsImported: number;
    errors: string[];
  }> {
    const result = {
      success: false,
      itemsImported: 0,
      settingsImported: 0,
      errors: [] as string[]
    };
    
    try {
      // Decode container
      let container: MasterFileContainer;
      try {
        const decoded = atob(fileContent);
        container = JSON.parse(decoded);
      } catch {
        // Try parsing as direct JSON (for backwards compatibility)
        container = JSON.parse(fileContent);
      }
      
      // Verify magic header
      if (container.magic !== this.MAGIC_HEADER) {
        throw new Error('Invalid VuVault master file format');
      }
      
      // Verify version compatibility
      if (container.version > this.CURRENT_VERSION) {
        throw new Error(`File version ${container.version} is not supported. Please update VuVault.`);
      }
      
      // Decode encryption parameters
      const salt = this.base64ToBytes(container.salt);
      const nonce = this.base64ToBytes(container.nonce);
      const encrypted = this.base64ToBytes(container.encrypted);
      
      // Derive key from password
      const passwordBytes = new TextEncoder().encode(password);
      const key = await pbkdf2(sha512, passwordBytes, salt, {
        c: container.iterations,
        dkLen: 32
      });
      
      // Decrypt data
      const cipher = chacha20poly1305(key, nonce);
      let decrypted: Uint8Array;
      
      try {
        decrypted = cipher.decrypt(encrypted);
      } catch (error) {
        throw new Error('Invalid password or corrupted file');
      }
      
      // Parse decrypted data
      const jsonData = new TextDecoder().decode(decrypted);
      const masterData: MasterFileData = JSON.parse(jsonData);
      
      // Verify checksum
      const calculatedChecksum = await this.calculateChecksum({
        ...masterData,
        checksum: ''
      });
      
      if (calculatedChecksum !== masterData.checksum) {
        result.errors.push('Warning: File checksum mismatch. Data may be corrupted.');
      }
      
      // Import settings
      if (masterData.settings) {
        try {
          await this.importSettings(masterData.settings);
          result.settingsImported = Object.keys(masterData.settings).length;
        } catch (error) {
          result.errors.push(`Failed to import settings: ${error.message}`);
        }
      }
      
      // Import vault items
      if (masterData.vaultItems && masterData.vaultItems.length > 0) {
        const dbService = DatabaseService.getInstance();
        let imported = 0;
        
        for (const item of masterData.vaultItems) {
          try {
            // Remove the id to let the database generate a new one
            const { id, ...itemData } = item;
            await dbService.addVaultItem(itemData);
            imported++;
          } catch (error) {
            result.errors.push(`Failed to import item ${item.service}: ${error.message}`);
          }
        }
        
        result.itemsImported = imported;
      }
      
      // Import custom data
      if (masterData.customData) {
        try {
          await this.importCustomData(masterData.customData);
        } catch (error) {
          result.errors.push(`Failed to import custom data: ${error.message}`);
        }
      }
      
      result.success = result.itemsImported > 0 || result.settingsImported > 0;
      
    } catch (error) {
      result.errors.push(error.message || 'Failed to import master file');
      console.error('Import error:', error);
    }
    
    return result;
  }
  
  /**
   * Validate a master file without importing
   */
  static async validateMasterFile(fileContent: string): Promise<{
    valid: boolean;
    version: number;
    itemCount: number;
    exported: string;
    errors: string[];
  }> {
    const result = {
      valid: false,
      version: 0,
      itemCount: 0,
      exported: '',
      errors: [] as string[]
    };
    
    try {
      // Decode container
      let container: MasterFileContainer;
      try {
        const decoded = atob(fileContent);
        container = JSON.parse(decoded);
      } catch {
        container = JSON.parse(fileContent);
      }
      
      // Check magic header
      if (container.magic !== this.MAGIC_HEADER) {
        result.errors.push('Invalid file format');
        return result;
      }
      
      // Check version
      result.version = container.version;
      if (container.version > this.CURRENT_VERSION) {
        result.errors.push(`Unsupported version ${container.version}`);
        return result;
      }
      
      // Basic structure validation
      if (!container.encrypted || !container.salt || !container.nonce) {
        result.errors.push('Missing encryption data');
        return result;
      }
      
      result.valid = true;
      
      // Try to extract metadata without password (if possible)
      if (container.timestamp) {
        result.exported = new Date(container.timestamp).toISOString();
      }
      
    } catch (error) {
      result.errors.push('Failed to parse file');
    }
    
    return result;
  }
  
  // Helper methods
  
  private static async getAllSettings(): Promise<any> {
    try {
      const settings = await db.settings.toArray();
      const settingsObj: any = {};
      
      for (const setting of settings) {
        settingsObj[setting.key] = setting.value;
      }
      
      return settingsObj;
    } catch {
      return {};
    }
  }
  
  private static async importSettings(settings: any): Promise<void> {
    for (const [key, value] of Object.entries(settings)) {
      await db.settings.put({
        key,
        value,
        updatedAt: Date.now()
      });
    }
  }
  
  private static async getFolders(): Promise<string[]> {
    try {
      const items = await db.vaults.toArray();
      const folders = new Set<string>();
      
      items.forEach(item => {
        if (item.folder) {
          folders.add(item.folder);
        }
      });
      
      return Array.from(folders);
    } catch {
      return [];
    }
  }
  
  private static async getAllTags(items: VaultItem[]): Promise<string[]> {
    const tags = new Set<string>();
    
    items.forEach(item => {
      if (item.tags) {
        item.tags.forEach(tag => tags.add(tag));
      }
    });
    
    return Array.from(tags);
  }
  
  private static async getTemplates(): Promise<any[]> {
    // Placeholder for future template system
    return [];
  }
  
  private static async getQuickAccessItems(): Promise<string[]> {
    try {
      const items = await db.vaults.where('favorite').equals(true).toArray();
      return items.map(item => item.id).filter(Boolean) as string[];
    } catch {
      return [];
    }
  }
  
  private static async importCustomData(customData: any): Promise<void> {
    // Store custom data in settings for future use
    if (customData.folders) {
      await db.settings.put({
        key: 'folders',
        value: customData.folders,
        updatedAt: Date.now()
      });
    }
    
    if (customData.tags) {
      await db.settings.put({
        key: 'availableTags',
        value: customData.tags,
        updatedAt: Date.now()
      });
    }
    
    if (customData.quickAccess) {
      await db.settings.put({
        key: 'quickAccess',
        value: customData.quickAccess,
        updatedAt: Date.now()
      });
    }
  }
  
  private static async getDeviceId(): Promise<string> {
    try {
      // Try to get existing device ID
      const existing = await db.settings.where('key').equals('deviceId').first();
      if (existing?.value) {
        return existing.value;
      }
      
      // Generate new device ID
      const id = crypto.randomUUID();
      await db.settings.put({
        key: 'deviceId',
        value: id,
        updatedAt: Date.now()
      });
      
      return id;
    } catch {
      return 'unknown';
    }
  }
  
  private static async calculateChecksum(data: any): Promise<string> {
    const str = JSON.stringify(data);
    const bytes = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return this.bytesToBase64(new Uint8Array(hash));
  }
  
  private static async generateFingerprint(data: Uint8Array): Promise<string> {
    const hash = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hash));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex.substring(0, 16); // First 16 chars of hash
  }
  
  private static bytesToBase64(bytes: Uint8Array): string {
    const binString = Array.from(bytes, (x) => String.fromCodePoint(x)).join('');
    return btoa(binString);
  }
  
  private static base64ToBytes(base64: string): Uint8Array {
    const binString = atob(base64);
    return Uint8Array.from(binString, (m) => m.codePointAt(0)!);
  }
}

// Export types
export type { MasterFileContainer };
