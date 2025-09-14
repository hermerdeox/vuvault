import { VaultItem, PasswordHistoryEntry, DatabaseService } from '../db/database';

export class PasswordHistoryManager {
  private static instance: PasswordHistoryManager;
  private readonly MAX_HISTORY_ENTRIES = 5;
  private db: DatabaseService;

  private constructor() {
    this.db = DatabaseService.getInstance();
  }

  static getInstance(): PasswordHistoryManager {
    if (!PasswordHistoryManager.instance) {
      PasswordHistoryManager.instance = new PasswordHistoryManager();
    }
    return PasswordHistoryManager.instance;
  }

  /**
   * Add a password change to the history
   */
  addToHistory(
    currentItem: VaultItem,
    oldPassword: string
  ): VaultItem {
    try {
      // Initialize history if it doesn't exist
      if (!currentItem.passwordHistory) {
        currentItem.passwordHistory = [];
      }

      // Don't add if the password hasn't actually changed
      if (oldPassword === currentItem.password) {
        return currentItem;
      }

      // Create new history entry
      const historyEntry: PasswordHistoryEntry = {
        password: oldPassword,
        changedAt: Date.now()
      };

      // Add to beginning of history
      currentItem.passwordHistory.unshift(historyEntry);

      // Keep only the last MAX_HISTORY_ENTRIES
      currentItem.passwordHistory = currentItem.passwordHistory.slice(0, this.MAX_HISTORY_ENTRIES);

      return currentItem;
    } catch (error) {
      console.error('Failed to add to password history:', error);
      return currentItem;
    }
  }

  /**
   * Get formatted history for display
   */
  getFormattedHistory(item: VaultItem): Array<{
    index: number;
    changedAt: string;
    timeAgo: string;
    masked: string;
  }> {
    if (!item.passwordHistory || item.passwordHistory.length === 0) {
      return [];
    }

    return item.passwordHistory.map((entry, index) => ({
      index: index + 1,
      changedAt: new Date(entry.changedAt).toLocaleDateString(),
      timeAgo: this.getTimeAgo(entry.changedAt),
      masked: this.maskPassword(entry.password)
    }));
  }

  /**
   * Check if a password was previously used
   */
  wasPasswordUsedBefore(item: VaultItem, password: string): boolean {
    if (!item.passwordHistory) return false;
    
    return item.passwordHistory.some(entry => entry.password === password);
  }

  /**
   * Get the most recent password from history
   */
  getMostRecentPassword(item: VaultItem): string | null {
    if (!item.passwordHistory || item.passwordHistory.length === 0) {
      return null;
    }
    return item.passwordHistory[0].password;
  }

  /**
   * Clear password history for an item
   */
  clearHistory(item: VaultItem): VaultItem {
    item.passwordHistory = [];
    return item;
  }

  /**
   * Get statistics about password changes
   */
  getPasswordChangeStats(item: VaultItem): {
    totalChanges: number;
    lastChanged: number | null;
    averageTimeBetweenChanges: number | null;
    isStale: boolean;
  } {
    const history = item.passwordHistory || [];
    const totalChanges = history.length;
    const lastChanged = history.length > 0 ? history[0].changedAt : item.updatedAt;
    
    let averageTimeBetweenChanges = null;
    if (history.length > 1) {
      const timeDiffs: number[] = [];
      for (let i = 0; i < history.length - 1; i++) {
        timeDiffs.push(history[i].changedAt - history[i + 1].changedAt);
      }
      averageTimeBetweenChanges = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length;
    }

    // Consider password stale if not changed in 90 days
    const ninetyDaysInMs = 90 * 24 * 60 * 60 * 1000;
    const isStale = lastChanged ? (Date.now() - lastChanged) > ninetyDaysInMs : false;

    return {
      totalChanges,
      lastChanged,
      averageTimeBetweenChanges,
      isStale
    };
  }

  /**
   * Generate a security report for password age
   */
  async generateAgeReport(): Promise<{
    stalePasswords: Array<{ service: string; lastChanged: string; daysOld: number }>;
    recommendations: string[];
  }> {
    try {
      const allItems = await this.db.getAllVaultItems();
      const stalePasswords: Array<{ service: string; lastChanged: string; daysOld: number }> = [];
      const ninetyDaysInMs = 90 * 24 * 60 * 60 * 1000;

      allItems.forEach(item => {
        const stats = this.getPasswordChangeStats(item);
        if (stats.isStale && stats.lastChanged) {
          const daysOld = Math.floor((Date.now() - stats.lastChanged) / (24 * 60 * 60 * 1000));
          stalePasswords.push({
            service: item.service,
            lastChanged: new Date(stats.lastChanged).toLocaleDateString(),
            daysOld
          });
        }
      });

      const recommendations: string[] = [];
      if (stalePasswords.length > 0) {
        recommendations.push(`${stalePasswords.length} passwords haven't been changed in over 90 days`);
      }
      if (stalePasswords.length > 5) {
        recommendations.push('Consider setting up a password rotation schedule');
      }

      return { stalePasswords, recommendations };
    } catch (error) {
      console.error('Failed to generate age report:', error);
      return { stalePasswords: [], recommendations: [] };
    }
  }

  /**
   * Utility: Get human-readable time ago
   */
  private getTimeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    if (seconds < 2592000) return `${Math.floor(seconds / 86400)} days ago`;
    if (seconds < 31536000) return `${Math.floor(seconds / 2592000)} months ago`;
    return `${Math.floor(seconds / 31536000)} years ago`;
  }

  /**
   * Utility: Mask password for display
   */
  private maskPassword(password: string): string {
    if (password.length <= 4) return '••••';
    return password.substring(0, 2) + '••••' + password.substring(password.length - 2);
  }
}
