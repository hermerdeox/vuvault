import { VaultItem, DatabaseService } from '../db/database';

export interface DuplicateCheckResult {
  hasDuplicates: boolean;
  duplicateServices: string[];
  count: number;
  severity: 'high' | 'medium' | 'low' | 'none';
}

export class DuplicatePasswordDetector {
  private static instance: DuplicatePasswordDetector;
  private db: DatabaseService;

  private constructor() {
    this.db = DatabaseService.getInstance();
  }

  static getInstance(): DuplicatePasswordDetector {
    if (!DuplicatePasswordDetector.instance) {
      DuplicatePasswordDetector.instance = new DuplicatePasswordDetector();
    }
    return DuplicatePasswordDetector.instance;
  }

  /**
   * Check if a password is already used in other vault items
   */
  async checkForDuplicates(
    password: string,
    excludeItemId?: string
  ): Promise<DuplicateCheckResult> {
    try {
      // Get all vault items
      const allItems = await this.db.getAllVaultItems();
      
      // Filter for items with matching passwords (excluding current item)
      const duplicates = allItems.filter(item => {
        // Skip if it's the same item we're checking
        if (excludeItemId && item.id === excludeItemId) {
          return false;
        }
        
        // Check if passwords match (after decryption)
        return item.password === password;
      });

      // Extract service names
      const duplicateServices = duplicates.map(item => item.service);
      
      // Determine severity
      const severity = this.calculateSeverity(duplicates);

      return {
        hasDuplicates: duplicates.length > 0,
        duplicateServices,
        count: duplicates.length,
        severity
      };
    } catch (error) {
      console.error('Duplicate check failed:', error);
      // Return safe default on error
      return {
        hasDuplicates: false,
        duplicateServices: [],
        count: 0,
        severity: 'none'
      };
    }
  }

  /**
   * Calculate severity based on the type of services sharing passwords
   */
  private calculateSeverity(duplicates: VaultItem[]): 'high' | 'medium' | 'low' | 'none' {
    if (duplicates.length === 0) return 'none';

    // Check for high-value targets
    const highValueKeywords = ['bank', 'financial', 'payment', 'paypal', 'crypto', 'wallet', 'admin'];
    const hasHighValue = duplicates.some(item => 
      highValueKeywords.some(keyword => 
        item.service.toLowerCase().includes(keyword)
      )
    );

    if (hasHighValue) return 'high';
    if (duplicates.length >= 3) return 'high';
    if (duplicates.length === 2) return 'medium';
    return 'low';
  }

  /**
   * Get all passwords that are reused across multiple services
   */
  async getAllDuplicatePasswords(): Promise<Map<string, string[]>> {
    try {
      const allItems = await this.db.getAllVaultItems();
      const passwordMap = new Map<string, string[]>();

      // Group services by password
      allItems.forEach(item => {
        if (item.password) {
          const services = passwordMap.get(item.password) || [];
          services.push(item.service);
          passwordMap.set(item.password, services);
        }
      });

      // Filter to only include duplicates
      const duplicatesOnly = new Map<string, string[]>();
      passwordMap.forEach((services, password) => {
        if (services.length > 1) {
          duplicatesOnly.set(password, services);
        }
      });

      return duplicatesOnly;
    } catch (error) {
      console.error('Failed to get all duplicates:', error);
      return new Map();
    }
  }

  /**
   * Generate a security report about password reuse
   */
  async generateSecurityReport(): Promise<{
    totalPasswords: number;
    uniquePasswords: number;
    reusedPasswords: number;
    reusePercentage: number;
    mostReusedCount: number;
    recommendations: string[];
  }> {
    try {
      const allItems = await this.db.getAllVaultItems();
      const passwordSet = new Set<string>();
      const passwordCounts = new Map<string, number>();

      allItems.forEach(item => {
        if (item.password) {
          passwordSet.add(item.password);
          passwordCounts.set(item.password, (passwordCounts.get(item.password) || 0) + 1);
        }
      });

      const reusedPasswords = Array.from(passwordCounts.values()).filter(count => count > 1).length;
      const mostReusedCount = Math.max(...Array.from(passwordCounts.values()), 0);

      const recommendations: string[] = [];
      
      if (reusedPasswords > 0) {
        recommendations.push('Use unique passwords for each service');
      }
      if (mostReusedCount > 3) {
        recommendations.push('Critical: Some passwords are used across many services');
      }
      if (passwordSet.size < allItems.length * 0.5) {
        recommendations.push('Consider using a password generator for better security');
      }

      return {
        totalPasswords: allItems.length,
        uniquePasswords: passwordSet.size,
        reusedPasswords,
        reusePercentage: allItems.length > 0 ? (reusedPasswords / allItems.length) * 100 : 0,
        mostReusedCount,
        recommendations
      };
    } catch (error) {
      console.error('Failed to generate security report:', error);
      return {
        totalPasswords: 0,
        uniquePasswords: 0,
        reusedPasswords: 0,
        reusePercentage: 0,
        mostReusedCount: 0,
        recommendations: []
      };
    }
  }
}
