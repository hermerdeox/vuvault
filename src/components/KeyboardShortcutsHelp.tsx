import { Component, Show, createSignal } from 'solid-js';
import { KeyboardShortcutsManager } from '../lib/keyboard/shortcuts-manager';

interface KeyboardShortcutsHelpProps {
  isOpen: boolean;
  onClose: () => void;
}

const KeyboardShortcutsHelp: Component<KeyboardShortcutsHelpProps> = (props) => {
  const manager = KeyboardShortcutsManager.getInstance();
  const shortcuts = manager.getShortcutsList();

  if (!props.isOpen) return null;

  return (
    <div class="fixed inset-0 bg-black/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
      <div class="bg-black border border-white/20 rounded-lg max-w-2xl w-full max-h-[80vh] overflow-hidden">
        {/* Header */}
        <div class="border-b border-white/10 p-6 flex items-center justify-between">
          <h2 class="text-xl font-light text-white/80 tracking-wider">
            Keyboard Shortcuts
          </h2>
          <button
            onClick={props.onClose}
            class="text-white/40 hover:text-white/60 transition-colors"
            aria-label="Close"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Shortcuts List */}
        <div class="p-6 space-y-6 overflow-y-auto max-h-[60vh]">
          {/* General Shortcuts */}
          <div>
            <h3 class="text-sm font-medium text-white/60 mb-3 uppercase tracking-wider">
              General
            </h3>
            <div class="space-y-2">
              <ShortcutRow keys="Ctrl+N" description="Create new password entry" />
              <ShortcutRow keys="Ctrl+S" description="Save current form" />
              <ShortcutRow keys="Ctrl+K" description="Focus search" />
              <ShortcutRow keys="/" description="Quick search (when not in input)" />
              <ShortcutRow keys="Esc" description="Close modal/dialog" />
              <ShortcutRow keys="?" description="Show this help" />
            </div>
          </div>

          {/* Item Actions */}
          <div>
            <h3 class="text-sm font-medium text-white/60 mb-3 uppercase tracking-wider">
              Item Actions
            </h3>
            <div class="space-y-2">
              <ShortcutRow keys="Ctrl+C" description="Copy password (when item selected)" />
              <ShortcutRow keys="Delete" description="Delete selected item" />
            </div>
          </div>

          {/* Navigation */}
          <div>
            <h3 class="text-sm font-medium text-white/60 mb-3 uppercase tracking-wider">
              Navigation
            </h3>
            <div class="space-y-2">
              <ShortcutRow keys="Tab" description="Move to next field" />
              <ShortcutRow keys="Shift+Tab" description="Move to previous field" />
              <ShortcutRow keys="Enter" description="Submit form" />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div class="border-t border-white/10 p-4 bg-white/[0.02]">
          <p class="text-xs text-white/40 text-center">
            Tip: Use Cmd instead of Ctrl on Mac
          </p>
        </div>
      </div>
    </div>
  );
};

// Helper component for shortcut rows
const ShortcutRow: Component<{ keys: string; description: string }> = (props) => {
  return (
    <div class="flex items-center justify-between py-2">
      <span class="text-sm text-white/70">{props.description}</span>
      <div class="flex gap-1">
        {props.keys.split('+').map(key => (
          <kbd class="px-2 py-1 text-xs bg-white/10 border border-white/20 rounded text-white/80 font-mono">
            {key}
          </kbd>
        ))}
      </div>
    </div>
  );
};

export default KeyboardShortcutsHelp;
