export interface KeyboardShortcut {
  key: string;
  ctrl?: boolean;
  cmd?: boolean;
  alt?: boolean;
  shift?: boolean;
  description: string;
  handler: (event: KeyboardEvent) => void;
}

export class KeyboardShortcutsManager {
  private static instance: KeyboardShortcutsManager;
  private shortcuts: Map<string, KeyboardShortcut> = new Map();
  private enabled: boolean = true;
  private helpModalCallback: (() => void) | null = null;

  private constructor() {
    this.initializeDefaultShortcuts();
    this.attachEventListener();
  }

  static getInstance(): KeyboardShortcutsManager {
    if (!KeyboardShortcutsManager.instance) {
      KeyboardShortcutsManager.instance = new KeyboardShortcutsManager();
    }
    return KeyboardShortcutsManager.instance;
  }

  /**
   * Initialize default shortcuts
   */
  private initializeDefaultShortcuts() {
    // Save shortcut (Ctrl/Cmd + S)
    this.registerShortcut({
      key: 's',
      ctrl: true,
      cmd: true,
      description: 'Save current form',
      handler: (e) => {
        e.preventDefault();
        this.triggerSave();
      }
    });

    // New entry shortcut (Ctrl/Cmd + N)
    this.registerShortcut({
      key: 'n',
      ctrl: true,
      cmd: true,
      description: 'Create new password entry',
      handler: (e) => {
        e.preventDefault();
        this.triggerNewEntry();
      }
    });

    // Close modal (Escape)
    this.registerShortcut({
      key: 'Escape',
      description: 'Close modal/dialog',
      handler: (e) => {
        this.triggerCloseModal();
      }
    });

    // Search focus (Ctrl/Cmd + K or /)
    this.registerShortcut({
      key: 'k',
      ctrl: true,
      cmd: true,
      description: 'Focus search',
      handler: (e) => {
        e.preventDefault();
        this.focusSearch();
      }
    });

    // Alternative search shortcut
    this.registerShortcut({
      key: '/',
      description: 'Focus search',
      handler: (e) => {
        // Only trigger if not in an input field
        if (!this.isInputFocused()) {
          e.preventDefault();
          this.focusSearch();
        }
      }
    });

    // Show help (?)
    this.registerShortcut({
      key: '?',
      shift: true,
      description: 'Show keyboard shortcuts help',
      handler: (e) => {
        if (!this.isInputFocused()) {
          e.preventDefault();
          this.showHelp();
        }
      }
    });

    // Copy password (Ctrl/Cmd + C when item selected)
    this.registerShortcut({
      key: 'c',
      ctrl: true,
      cmd: true,
      description: 'Copy password of selected item',
      handler: (e) => {
        const selectedItem = document.querySelector('[data-selected="true"]');
        if (selectedItem) {
          e.preventDefault();
          this.copySelectedPassword();
        }
      }
    });

    // Delete item (Delete key when item selected)
    this.registerShortcut({
      key: 'Delete',
      description: 'Delete selected item',
      handler: (e) => {
        const selectedItem = document.querySelector('[data-selected="true"]');
        if (selectedItem && !this.isInputFocused()) {
          e.preventDefault();
          this.deleteSelectedItem();
        }
      }
    });
  }

  /**
   * Attach global keyboard event listener
   */
  private attachEventListener() {
    document.addEventListener('keydown', (e) => {
      if (!this.enabled) return;

      const shortcutKey = this.getShortcutKey(e);
      const shortcut = this.shortcuts.get(shortcutKey);

      if (shortcut) {
        try {
          shortcut.handler(e);
        } catch (error) {
          console.error('Shortcut handler error:', error);
        }
      }
    });
  }

  /**
   * Generate a unique key for the shortcut
   */
  private getShortcutKey(event: KeyboardEvent): string {
    const parts: string[] = [];
    
    // Check modifiers
    const ctrl = event.ctrlKey || event.metaKey; // Treat Cmd as Ctrl for cross-platform
    if (ctrl) parts.push('ctrl');
    if (event.altKey) parts.push('alt');
    if (event.shiftKey) parts.push('shift');
    
    // Add the key
    parts.push(event.key.toLowerCase());
    
    return parts.join('+');
  }

  /**
   * Register a new shortcut
   */
  registerShortcut(shortcut: KeyboardShortcut) {
    const keys: string[] = [];
    
    // Handle both ctrl and cmd as the same
    if (shortcut.ctrl || shortcut.cmd) {
      keys.push('ctrl');
    }
    if (shortcut.alt) keys.push('alt');
    if (shortcut.shift) keys.push('shift');
    keys.push(shortcut.key.toLowerCase());
    
    const shortcutKey = keys.join('+');
    this.shortcuts.set(shortcutKey, shortcut);
  }

  /**
   * Remove a shortcut
   */
  unregisterShortcut(key: string) {
    this.shortcuts.delete(key);
  }

  /**
   * Enable/disable shortcuts
   */
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  /**
   * Check if an input field is focused
   */
  private isInputFocused(): boolean {
    const activeElement = document.activeElement;
    return activeElement instanceof HTMLInputElement ||
           activeElement instanceof HTMLTextAreaElement ||
           activeElement instanceof HTMLSelectElement ||
           activeElement?.getAttribute('contenteditable') === 'true';
  }

  /**
   * Trigger save action
   */
  private triggerSave() {
    const saveButton = document.querySelector<HTMLButtonElement>(
      '[data-save-button], button[type="submit"]:not([disabled])'
    );
    if (saveButton) {
      saveButton.click();
      this.showNotification('Saving...', 'info');
    }
  }

  /**
   * Trigger new entry
   */
  private triggerNewEntry() {
    const newButton = document.querySelector<HTMLButtonElement>(
      '[data-new-entry], #newEntryBtn, button[aria-label="Add new password"]'
    );
    if (newButton) {
      newButton.click();
    }
  }

  /**
   * Close active modal
   */
  private triggerCloseModal() {
    const closeButton = document.querySelector<HTMLButtonElement>(
      '[data-close-button], .modal.active button[aria-label="Close"], .modal:not(.hidden) button[aria-label="Close"]'
    );
    if (closeButton) {
      closeButton.click();
    }
  }

  /**
   * Focus search input
   */
  private focusSearch() {
    const searchInput = document.querySelector<HTMLInputElement>(
      '[data-search-input], input[type="search"], input[placeholder*="Search"]'
    );
    if (searchInput) {
      searchInput.focus();
      searchInput.select();
    }
  }

  /**
   * Copy selected password
   */
  private copySelectedPassword() {
    const copyButton = document.querySelector<HTMLButtonElement>(
      '[data-selected="true"] [data-copy-password]'
    );
    if (copyButton) {
      copyButton.click();
      this.showNotification('Password copied', 'success');
    }
  }

  /**
   * Delete selected item
   */
  private deleteSelectedItem() {
    const deleteButton = document.querySelector<HTMLButtonElement>(
      '[data-selected="true"] [data-delete-button]'
    );
    if (deleteButton) {
      deleteButton.click();
    }
  }

  /**
   * Show help modal
   */
  private showHelp() {
    if (this.helpModalCallback) {
      this.helpModalCallback();
    } else {
      this.showBuiltInHelp();
    }
  }

  /**
   * Set custom help modal callback
   */
  setHelpModalCallback(callback: () => void) {
    this.helpModalCallback = callback;
  }

  /**
   * Show built-in help
   */
  private showBuiltInHelp() {
    const shortcuts = this.getShortcutsList();
    console.log('Keyboard Shortcuts:');
    shortcuts.forEach(s => {
      console.log(`${s.display}: ${s.description}`);
    });
    this.showNotification('Press ? to see keyboard shortcuts in console', 'info');
  }

  /**
   * Get list of all shortcuts for display
   */
  getShortcutsList(): Array<{ display: string; description: string }> {
    const list: Array<{ display: string; description: string }> = [];
    
    this.shortcuts.forEach((shortcut, key) => {
      const parts: string[] = [];
      
      if (key.includes('ctrl')) parts.push('Ctrl');
      if (key.includes('alt')) parts.push('Alt');
      if (key.includes('shift')) parts.push('Shift');
      
      const keyPart = key.split('+').pop() || '';
      const displayKey = keyPart === 'escape' ? 'Esc' : 
                        keyPart === 'delete' ? 'Del' :
                        keyPart.toUpperCase();
      parts.push(displayKey);
      
      list.push({
        display: parts.join('+'),
        description: shortcut.description
      });
    });
    
    return list;
  }

  /**
   * Show notification (basic implementation)
   */
  private showNotification(message: string, type: 'info' | 'success' | 'error' = 'info') {
    // Check if there's a notification system available
    const existingNotification = document.querySelector('.notification-toast');
    if (existingNotification) {
      existingNotification.remove();
    }

    const notification = document.createElement('div');
    notification.className = 'notification-toast';
    notification.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 12px 20px;
      background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
      color: white;
      border-radius: 8px;
      z-index: 10000;
      animation: slide-in 0.3s ease;
      font-size: 14px;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.style.animation = 'slide-out 0.3s ease';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }
}

// Add CSS for animations
const style = document.createElement('style');
style.textContent = `
  @keyframes slide-in {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  
  @keyframes slide-out {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(100%);
      opacity: 0;
    }
  }
`;
document.head.appendChild(style);
