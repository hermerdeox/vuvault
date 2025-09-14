import { Component, Show, createSignal, onMount } from 'solid-js';
import { DuplicateCheckResult } from '../lib/security/duplicate-detector';

interface DuplicateWarningProps {
  result: DuplicateCheckResult | null;
  onDismiss?: () => void;
}

const DuplicateWarning: Component<DuplicateWarningProps> = (props) => {
  const [visible, setVisible] = createSignal(true);

  onMount(() => {
    // Auto-dismiss after 10 seconds
    if (props.result?.hasDuplicates) {
      setTimeout(() => {
        setVisible(false);
        props.onDismiss?.();
      }, 10000);
    }
  });

  const getSeverityColor = () => {
    switch (props.result?.severity) {
      case 'high': return 'border-red-500/40 bg-red-500/10 text-red-400';
      case 'medium': return 'border-yellow-500/40 bg-yellow-500/10 text-yellow-400';
      case 'low': return 'border-blue-500/40 bg-blue-500/10 text-blue-400';
      default: return '';
    }
  };

  const getSeverityIcon = () => {
    switch (props.result?.severity) {
      case 'high': return '🚨';
      case 'medium': return '⚠️';
      case 'low': return 'ℹ️';
      default: return '';
    }
  };

  if (!props.result?.hasDuplicates || !visible()) return null;

  return (
    <div class={`mb-4 p-4 border rounded-lg ${getSeverityColor()} animate-fade-in`}>
      <div class="flex items-start justify-between">
        <div class="flex-1">
          <div class="flex items-center gap-2 mb-2">
            <span class="text-xl">{getSeverityIcon()}</span>
            <h4 class="font-semibold text-sm">
              Password Already Used
            </h4>
          </div>
          
          <p class="text-xs opacity-90 mb-2">
            This password is already used for:
          </p>
          
          <div class="flex flex-wrap gap-2">
            {props.result.duplicateServices.slice(0, 3).map(service => (
              <span class="px-2 py-1 bg-black/30 rounded text-xs">
                {service}
              </span>
            ))}
            <Show when={props.result.duplicateServices.length > 3}>
              <span class="px-2 py-1 bg-black/30 rounded text-xs">
                +{props.result.duplicateServices.length - 3} more
              </span>
            </Show>
          </div>
          
          <p class="text-xs opacity-70 mt-3">
            Consider using a unique password for better security
          </p>
        </div>
        
        <button
          onClick={() => {
            setVisible(false);
            props.onDismiss?.();
          }}
          class="ml-4 text-white/40 hover:text-white/60 transition-colors"
          aria-label="Dismiss warning"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default DuplicateWarning;
