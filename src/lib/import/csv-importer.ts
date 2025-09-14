// CSV Import functionality for VuVault Zero
// Supports generic CSV and AWS credentials format

import { VaultItem } from '../db/database';

export interface CSVImportResult {
  success: boolean;
  items: VaultItem[];
  errors: string[];
  format: string;
}

export class CSVImporter {
  /**
   * Parse CSV content and convert to VaultItem array
   */
  static async parseCSV(content: string): Promise<CSVImportResult> {
    const result: CSVImportResult = {
      success: false,
      items: [],
      errors: [],
      format: 'csv'
    };

    try {
      const lines = content.trim().split('\n');
      if (lines.length < 2) {
        throw new Error('CSV file must have at least a header row and one data row');
      }

      // Parse header
      const headers = this.parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
      
      // Detect format based on headers
      if (headers.includes('access key id') || headers.includes('secret access key')) {
        result.format = 'aws-credentials';
        return this.parseAWSCredentials(lines, headers);
      }
      
      // Generic CSV parsing
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const values = this.parseCSVLine(line);
        const item = this.mapCSVToVaultItem(headers, values);
        
        if (item) {
          result.items.push(item);
        }
      }
      
      result.success = result.items.length > 0;
      
    } catch (error) {
      result.errors.push(error.message || 'Failed to parse CSV');
    }
    
    return result;
  }

  /**
   * Parse AWS credentials CSV format
   */
  private static parseAWSCredentials(lines: string[], headers: string[]): CSVImportResult {
    const result: CSVImportResult = {
      success: false,
      items: [],
      errors: [],
      format: 'aws-credentials'
    };

    const userNameIdx = headers.findIndex(h => h.includes('user name'));
    const accessKeyIdx = headers.findIndex(h => h.includes('access key id'));
    const secretKeyIdx = headers.findIndex(h => h.includes('secret access key'));

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const values = this.parseCSVLine(line);
      
      const userName = values[userNameIdx] || 'AWS User';
      const accessKey = values[accessKeyIdx];
      const secretKey = values[secretKeyIdx];
      
      if (accessKey && secretKey) {
        const item: VaultItem = {
          id: crypto.randomUUID(),
          service: 'AWS Console',
          username: accessKey,
          encryptedPassword: secretKey,
          url: 'https://console.aws.amazon.com/',
          notes: `User: ${userName}\nAccess Key ID: ${accessKey}`,
          tags: ['aws', 'cloud', 'credentials'],
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        
        result.items.push(item);
      }
    }
    
    result.success = result.items.length > 0;
    return result;
  }

  /**
   * Parse a single CSV line handling quotes and commas
   */
  private static parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];
      
      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          current += '"';
          i++; // Skip next quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    
    result.push(current);
    return result;
  }

  /**
   * Map generic CSV row to VaultItem
   */
  private static mapCSVToVaultItem(headers: string[], values: string[]): VaultItem | null {
    // Common header mappings
    const mappings = {
      service: ['service', 'name', 'title', 'website', 'site', 'application'],
      username: ['username', 'user', 'email', 'login', 'account', 'user name'],
      password: ['password', 'pass', 'secret', 'key', 'secret access key', 'api key'],
      url: ['url', 'website', 'link', 'address', 'uri'],
      notes: ['notes', 'description', 'comments', 'details']
    };
    
    const getValue = (fieldNames: string[]): string => {
      for (const name of fieldNames) {
        const idx = headers.findIndex(h => h.includes(name));
        if (idx >= 0 && values[idx]) {
          return values[idx];
        }
      }
      return '';
    };
    
    const service = getValue(mappings.service);
    const username = getValue(mappings.username);
    const password = getValue(mappings.password);
    
    if (!service || !password) {
      return null;
    }
    
    return {
      id: crypto.randomUUID(),
      service,
      username,
      encryptedPassword: password,
      url: getValue(mappings.url),
      notes: getValue(mappings.notes),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  /**
   * Convert VaultItems to CSV format for export
   */
  static exportToCSV(items: VaultItem[]): string {
    const headers = ['Service', 'Username', 'Password', 'URL', 'Notes', 'Tags', 'Created', 'Updated'];
    const rows = [headers.join(',')];
    
    for (const item of items) {
      const row = [
        this.escapeCSV(item.service),
        this.escapeCSV(item.username),
        this.escapeCSV(item.encryptedPassword),
        this.escapeCSV(item.url || ''),
        this.escapeCSV(item.notes || ''),
        this.escapeCSV(item.tags?.join('; ') || ''),
        new Date(item.createdAt).toISOString(),
        new Date(item.updatedAt).toISOString()
      ];
      rows.push(row.join(','));
    }
    
    return rows.join('\n');
  }

  /**
   * Escape CSV value
   */
  private static escapeCSV(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
