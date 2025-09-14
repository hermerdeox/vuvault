// Flexible JSON Import System with Multi-Format Support
// Intelligently detects and imports from various password manager formats
// Non-breaking addition to existing functionality

import { VaultItem } from '../db/database';

interface ImportMapping {
  service: string[];
  username: string[];
  password: string[];
  url?: string[];
  notes?: string[];
  tags?: string[];
  totp?: string[];
  favorite?: string[];
  folder?: string[];
}

interface ImportResult {
  success: boolean;
  items: VaultItem[];
  errors: string[];
  warnings: string[];
  format: string;
  statistics: {
    total: number;
    imported: number;
    skipped: number;
    duplicates: number;
  };
}

export class FlexibleImporter {
  // Common field mappings from various password managers
  private static readonly FIELD_MAPPINGS: ImportMapping = {
    service: [
      'service', 'name', 'title', 'site', 'account', 'serviceName',
      'login_title', 'item_name', 'website_name', 'entry_name',
      'credential_name', 'label', 'display_name'
    ],
    username: [
      'username', 'user', 'email', 'login', 'account', 'userName',
      'user_name', 'login_username', 'login_email', 'account_name',
      'userid', 'user_id', 'identifier', 'principal'
    ],
    password: [
      'password', 'pass', 'pwd', 'secret', 'encryptedPassword',
      'encrypted_password', 'login_password', 'credential', 'passphrase',
      'key', 'access_key', 'api_key', 'token'
    ],
    url: [
      'url', 'website', 'uri', 'site', 'domain', 'web', 'link',
      'login_url', 'login_uri', 'website_url', 'site_url', 'address',
      'endpoint', 'host'
    ],
    notes: [
      'notes', 'note', 'comments', 'description', 'memo', 'extra',
      'additional_info', 'details', 'remarks', 'annotation', 'info',
      'custom_fields', 'fields'
    ],
    tags: [
      'tags', 'tag', 'categories', 'category', 'labels', 'groups',
      'folders', 'collections', 'types', 'keywords', 'classifications'
    ],
    totp: [
      'totp', 'two_factor', 'twoFactorSecret', 'otpauth', 'otp_secret',
      'authenticator_key', 'mfa_secret', '2fa_secret'
    ],
    favorite: [
      'favorite', 'starred', 'star', 'favourited', 'pinned', 'bookmark',
      'is_favorite', 'isFavorite', 'marked'
    ],
    folder: [
      'folder', 'group', 'collection', 'vault', 'category', 'directory',
      'parent', 'path', 'location'
    ]
  };
  
  // Format-specific patterns
  private static readonly FORMAT_PATTERNS = {
    lastpass: ['url', 'username', 'password', 'extra', 'name', 'grouping', 'fav'],
    '1password': ['uuid', 'vaultUuid', 'overview', 'details', 'createdAt', 'updatedAt'],
    bitwarden: ['folderId', 'organizationId', 'collectionIds', 'secureNote', 'identity', 'card'],
    dashlane: ['domain', 'login', 'secondaryLogin', 'password', 'note', 'category'],
    keepass: ['Title', 'UserName', 'Password', 'URL', 'Notes', 'IconID'],
    chrome: ['origin', 'action_url', 'username_value', 'password_value', 'date_created'],
    firefox: ['hostname', 'httpRealm', 'formSubmitURL', 'usernameField', 'passwordField'],
    safari: ['Title', 'URL', 'Username', 'Password', 'Notes', 'OTPAuth'],
    enpass: ['title', 'subtitle', 'note', 'fields', 'attachments', 'category'],
    nordpass: ['name', 'url', 'username', 'password', 'note', 'cardholdername'],
    roboform: ['Name', 'Url', 'Login', 'Pwd', 'Note', 'Folder', 'Launched']
  };
  
  /**
   * Main import function - detects format and imports JSON
   */
  static async importJSON(file: File): Promise<ImportResult> {
    const startTime = performance.now();
    const result: ImportResult = {
      success: false,
      items: [],
      errors: [],
      warnings: [],
      format: 'unknown',
      statistics: {
        total: 0,
        imported: 0,
        skipped: 0,
        duplicates: 0
      }
    };
    
    try {
      // Read and parse file
      const text = await file.text();
      let data: any;
      
      try {
        data = JSON.parse(text);
      } catch (parseError) {
        // Try to fix common JSON issues
        const fixedText = this.fixCommonJSONIssues(text);
        try {
          data = JSON.parse(fixedText);
          result.warnings.push('Fixed JSON formatting issues automatically');
        } catch {
          throw new Error('Invalid JSON format. Please ensure the file is valid JSON.');
        }
      }
      
      // Detect format
      result.format = await this.detectFormat(file, data);
      console.info(`Detected format: ${result.format}`);
      
      // Extract items based on format
      const rawItems = this.extractItems(data, result.format);
      result.statistics.total = rawItems.length;
      
      if (rawItems.length === 0) {
        throw new Error('No password entries found in the file');
      }
      
      // Process each item
      const existingItems = await this.getExistingItems();
      const existingUrls = new Set(existingItems.map(item => item.url?.toLowerCase()));
      const existingServices = new Set(existingItems.map(item => 
        `${item.service?.toLowerCase()}-${item.username?.toLowerCase()}`
      ));
      
      for (const rawItem of rawItems) {
        try {
          const vaultItem = this.mapToVaultItem(rawItem, result.format);
          
          if (!vaultItem) {
            result.statistics.skipped++;
            continue;
          }
          
          // Check for duplicates
          const itemKey = `${vaultItem.service?.toLowerCase()}-${vaultItem.username?.toLowerCase()}`;
          if (existingServices.has(itemKey)) {
            result.statistics.duplicates++;
            result.warnings.push(`Duplicate found: ${vaultItem.service} (${vaultItem.username})`);
            continue;
          }
          
          // Validate and clean item
          const validatedItem = this.validateAndCleanItem(vaultItem);
          result.items.push(validatedItem);
          result.statistics.imported++;
          
        } catch (itemError) {
          result.errors.push(`Failed to import item: ${itemError.message}`);
          result.statistics.skipped++;
        }
      }
      
      result.success = result.items.length > 0;
      
      // Performance logging
      const duration = performance.now() - startTime;
      console.info(`Import completed in ${duration.toFixed(2)}ms`);
      console.info(`Imported ${result.statistics.imported}/${result.statistics.total} items`);
      
    } catch (error) {
      result.errors.push(error.message || 'Unknown error during import');
      console.error('Import failed:', error);
    }
    
    return result;
  }
  
  /**
   * Fix common JSON formatting issues
   */
  private static fixCommonJSONIssues(text: string): string {
    // Remove BOM if present
    if (text.charCodeAt(0) === 0xFEFF) {
      text = text.slice(1);
    }
    
    // Fix single quotes (common in exported data)
    text = text.replace(/'/g, '"');
    
    // Fix trailing commas
    text = text.replace(/,\s*}/g, '}');
    text = text.replace(/,\s*\]/g, ']');
    
    // Fix unquoted keys (if simple)
    text = text.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
    
    return text;
  }
  
  /**
   * Detect the format of the imported file
   */
  private static async detectFormat(file: File, data: any): Promise<string> {
    // Check for EOXVault/VuVault format first
    if (data.metadata && (data.metadata.format === 'EOXVault' || data.metadata.format === 'vuvault')) {
      return 'eoxvault';
    }
    if (data.vaultItems && Array.isArray(data.vaultItems)) {
      return 'eoxvault';
    }
    
    // Check filename hints
    const filename = file.name.toLowerCase();
    if (filename.includes('lastpass')) return 'lastpass';
    if (filename.includes('1password')) return '1password';
    if (filename.includes('bitwarden')) return 'bitwarden';
    if (filename.includes('dashlane')) return 'dashlane';
    if (filename.includes('keepass')) return 'keepass';
    if (filename.includes('chrome')) return 'chrome';
    if (filename.includes('firefox')) return 'firefox';
    if (filename.includes('safari')) return 'safari';
    if (filename.includes('enpass')) return 'enpass';
    if (filename.includes('nordpass')) return 'nordpass';
    if (filename.includes('roboform')) return 'roboform';
    
    // Check data structure
    const sampleItem = Array.isArray(data) ? data[0] : 
                      data.items ? data.items[0] :
                      data.logins ? data.logins[0] :
                      data.accounts ? data.accounts[0] :
                      data.passwords ? data.passwords[0] :
                      data.entries ? data.entries[0] :
                      data;
    
    if (!sampleItem || typeof sampleItem !== 'object') {
      return 'generic';
    }
    
    // Check for format-specific fields
    const itemKeys = Object.keys(sampleItem);
    
    for (const [format, patterns] of Object.entries(this.FORMAT_PATTERNS)) {
      const matchCount = patterns.filter(pattern => 
        itemKeys.some(key => key.toLowerCase() === pattern.toLowerCase())
      ).length;
      
      if (matchCount >= Math.min(3, patterns.length * 0.5)) {
        return format;
      }
    }
    
    return 'generic';
  }
  
  /**
   * Extract items array from various data structures
   */
  private static extractItems(data: any, format: string): any[] {
    // Handle array directly
    if (Array.isArray(data)) {
      return data;
    }
    
    // Handle common container properties
    const containers = [
      'vaultItems', 'items', 'logins', 'accounts', 'passwords', 'entries',
      'credentials', 'records', 'data', 'vaults', 'list'
    ];
    
    for (const container of containers) {
      if (data[container] && Array.isArray(data[container])) {
        return data[container];
      }
    }
    
    // Handle nested format-specific structures
    if (format === '1password' && data.accounts) {
      const items = [];
      for (const account of data.accounts) {
        if (account.vaults) {
          for (const vault of account.vaults) {
            if (vault.items) {
              items.push(...vault.items);
            }
          }
        }
      }
      return items;
    }
    
    if (format === 'bitwarden' && data.encrypted) {
      return data.items || [];
    }
    
    // Single item
    if (typeof data === 'object' && !Array.isArray(data)) {
      return [data];
    }
    
    return [];
  }
  
  /**
   * Map raw item to VaultItem structure
   */
  private static mapToVaultItem(input: any, format: string): VaultItem | null {
    if (!input || typeof input !== 'object') return null;
    
    // Format-specific mappers
    if (format !== 'generic') {
      const formatter = this.getFormatSpecificMapper(format);
      if (formatter) {
        const formatted = formatter(input);
        if (formatted) return formatted;
      }
    }
    
    // Generic field detection
    const findField = (fieldNames: string[]): any => {
      for (const name of fieldNames) {
        // Case-insensitive search
        const key = Object.keys(input).find(k => 
          k.toLowerCase() === name.toLowerCase()
        );
        if (key && input[key] !== undefined && input[key] !== null && input[key] !== '') {
          return input[key];
        }
      }
      
      // Deep search in nested objects
      for (const key of Object.keys(input)) {
        if (typeof input[key] === 'object' && !Array.isArray(input[key])) {
          for (const name of fieldNames) {
            const nestedKey = Object.keys(input[key]).find(k =>
              k.toLowerCase() === name.toLowerCase()
            );
            if (nestedKey && input[key][nestedKey]) {
              return input[key][nestedKey];
            }
          }
        }
      }
      
      return undefined;
    };
    
    const service = findField(this.FIELD_MAPPINGS.service);
    const username = findField(this.FIELD_MAPPINGS.username);
    const password = findField(this.FIELD_MAPPINGS.password);
    
    // Must have at least service/title and password
    if (!service || !password) {
      return null;
    }
    
    // Extract other fields
    const url = findField(this.FIELD_MAPPINGS.url || []);
    const notes = findField(this.FIELD_MAPPINGS.notes || []);
    const tags = this.extractTags(input);
    const totp = findField(this.FIELD_MAPPINGS.totp || []);
    const favorite = this.extractBoolean(input, this.FIELD_MAPPINGS.favorite || []);
    const folder = findField(this.FIELD_MAPPINGS.folder || []);
    
    return {
      id: crypto.randomUUID(),
      service: String(service).substring(0, 255),
      username: username ? String(username).substring(0, 255) : '',
      encryptedPassword: String(password),
      url: url ? this.normalizeUrl(String(url)) : undefined,
      notes: notes ? String(notes).substring(0, 5000) : undefined,
      tags: tags,
      totp: totp ? String(totp) : undefined,
      favorite: favorite,
      folder: folder ? String(folder).substring(0, 100) : undefined,
      createdAt: this.parseDate(input.createdAt || input.created || input.date_created),
      updatedAt: this.parseDate(input.updatedAt || input.modified || input.date_modified),
      lastUsed: this.parseDate(input.lastUsed || input.last_used || input.accessed)
    };
  }
  
  /**
   * Get format-specific mapper function
   */
  private static getFormatSpecificMapper(format: string): ((input: any) => VaultItem | null) | null {
    const mappers: Record<string, (input: any) => VaultItem | null> = {
      eoxvault: (input) => {
        // Handle EOXVault/VuVault format
        if (!input.name && !input.service) return null;
        if (!input.password && !input.encryptedPassword) return null;
        
        return {
          id: input.id || crypto.randomUUID(),
          service: input.name || input.service,
          username: input.username || '',
          encryptedPassword: input.password || input.encryptedPassword,
          url: input.url,
          notes: input.notes,
          tags: Array.isArray(input.tags) ? input.tags : [],
          favorite: input.favorite || false,
          folder: input.folder,
          totp: input.totp,
          createdAt: input.createdAt || Date.now(),
          updatedAt: input.updatedAt || Date.now()
        };
      },
      
      lastpass: (input) => {
        if (!input.name || !input.password) return null;
        return {
          id: crypto.randomUUID(),
          service: input.name,
          username: input.username || '',
          encryptedPassword: input.password,
          url: input.url,
          notes: input.extra,
          tags: input.grouping ? [input.grouping] : [],
          favorite: input.fav === '1' || input.fav === true,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
      },
      
      '1password': (input) => {
        const overview = input.overview || {};
        const details = input.details || {};
        
        if (!overview.title && !input.title) return null;
        
        // Find password field in details
        let password = '';
        let username = '';
        
        if (details.fields) {
          for (const field of details.fields) {
            if (field.designation === 'password' || field.type === 'P') {
              password = field.value;
            }
            if (field.designation === 'username' || field.type === 'T') {
              username = field.value;
            }
          }
        }
        
        if (!password) return null;
        
        return {
          id: input.uuid || crypto.randomUUID(),
          service: overview.title || input.title,
          username: username || overview.ainfo || '',
          encryptedPassword: password,
          url: overview.url || input.url,
          notes: details.notesPlain || input.notes,
          tags: overview.tags || [],
          favorite: input.favorite || false,
          createdAt: input.createdAt ? input.createdAt * 1000 : Date.now(),
          updatedAt: input.updatedAt ? input.updatedAt * 1000 : Date.now()
        };
      },
      
      bitwarden: (input) => {
        if (!input.name || !input.login?.password) return null;
        
        return {
          id: input.id || crypto.randomUUID(),
          service: input.name,
          username: input.login.username || '',
          encryptedPassword: input.login.password,
          url: input.login.uris?.[0]?.uri,
          notes: input.notes,
          tags: input.collectionIds || [],
          totp: input.login.totp,
          favorite: input.favorite || false,
          folder: input.folderId,
          createdAt: input.creationDate ? Date.parse(input.creationDate) : Date.now(),
          updatedAt: input.revisionDate ? Date.parse(input.revisionDate) : Date.now()
        };
      }
    };
    
    return mappers[format] || null;
  }
  
  /**
   * Extract tags from various formats
   */
  private static extractTags(input: any): string[] {
    const tagField = this.findField(input, this.FIELD_MAPPINGS.tags || []);
    if (!tagField) return [];
    
    // Handle array
    if (Array.isArray(tagField)) {
      return tagField.map(t => String(t)).filter(Boolean).slice(0, 10);
    }
    
    // Handle string (comma/semicolon/pipe separated)
    if (typeof tagField === 'string') {
      return tagField
        .split(/[,;|]/)
        .map(t => t.trim())
        .filter(Boolean)
        .slice(0, 10);
    }
    
    return [];
  }
  
  /**
   * Extract boolean value
   */
  private static extractBoolean(input: any, fieldNames: string[]): boolean {
    const value = this.findField(input, fieldNames);
    if (value === undefined) return false;
    
    // Handle various boolean representations
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value > 0;
    if (typeof value === 'string') {
      const lower = value.toLowerCase();
      return lower === 'true' || lower === 'yes' || lower === '1' || lower === 'on';
    }
    
    return false;
  }
  
  /**
   * Find field in object (case-insensitive)
   */
  private static findField(obj: any, fieldNames: string[]): any {
    for (const name of fieldNames) {
      const key = Object.keys(obj).find(k => 
        k.toLowerCase() === name.toLowerCase()
      );
      if (key && obj[key] !== undefined && obj[key] !== null) {
        return obj[key];
      }
    }
    return undefined;
  }
  
  /**
   * Parse date from various formats
   */
  private static parseDate(value: any): number {
    if (!value) return Date.now();
    
    // Already a timestamp
    if (typeof value === 'number') {
      // Check if it's seconds vs milliseconds
      if (value < 10000000000) {
        return value * 1000; // Convert seconds to milliseconds
      }
      return value;
    }
    
    // Parse string date
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return isNaN(parsed) ? Date.now() : parsed;
    }
    
    return Date.now();
  }
  
  /**
   * Normalize URL
   */
  private static normalizeUrl(url: string): string {
    if (!url) return '';
    
    url = url.trim();
    
    // Add protocol if missing
    if (!url.match(/^[a-zA-Z]+:\/\//)) {
      url = 'https://' + url;
    }
    
    // Validate URL
    try {
      const parsed = new URL(url);
      return parsed.href;
    } catch {
      // Return as-is if not a valid URL
      return url.substring(0, 500);
    }
  }
  
  /**
   * Validate and clean vault item
   */
  private static validateAndCleanItem(item: VaultItem): VaultItem {
    // Ensure required fields
    if (!item.service) {
      throw new Error('Service name is required');
    }
    
    if (!item.encryptedPassword) {
      throw new Error('Password is required');
    }
    
    // Clean and validate fields
    item.service = item.service.substring(0, 255);
    item.username = (item.username || '').substring(0, 255);
    
    if (item.url) {
      item.url = item.url.substring(0, 500);
    }
    
    if (item.notes) {
      item.notes = item.notes.substring(0, 5000);
    }
    
    if (item.tags) {
      item.tags = item.tags.slice(0, 10).map(t => t.substring(0, 50));
    }
    
    // Ensure valid dates
    const now = Date.now();
    if (!item.createdAt || item.createdAt > now) {
      item.createdAt = now;
    }
    
    if (!item.updatedAt || item.updatedAt > now) {
      item.updatedAt = item.createdAt;
    }
    
    return item;
  }
  
  /**
   * Get existing vault items (stub - would connect to database)
   */
  private static async getExistingItems(): Promise<VaultItem[]> {
    // This would normally query the database
    // For now, return empty array to avoid duplicates on first import
    try {
      const { db } = await import('../db/database');
      return await db.vaultItems.toArray();
    } catch {
      return [];
    }
  }
  
  /**
   * Export vault items to JSON (for backup)
   */
  static async exportJSON(items: VaultItem[], format: 'vuvault' | 'generic' = 'vuvault'): Promise<string> {
    const exportData = {
      version: '2.0.0',
      exported: new Date().toISOString(),
      format: format,
      count: items.length,
      items: items.map(item => {
        // Remove internal fields for export
        const { id, ...exportItem } = item;
        return {
          ...exportItem,
          // Ensure password is marked as encrypted
          password: exportItem.encryptedPassword,
          encryptedPassword: undefined
        };
      })
    };
    
    return JSON.stringify(exportData, null, 2);
  }
}

// Export for use in components
export type { ImportResult, ImportMapping };
