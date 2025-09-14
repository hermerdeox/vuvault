import { Component, createSignal, Show } from 'solid-js';
import { VaultItem } from '../lib/db/database';
import { CryptoService } from '../lib/crypto/crypto-service';
import { useVault } from '../context/VaultContext';

interface VaultItemCardProps {
  item: VaultItem;
}

const VaultItemCard: Component<VaultItemCardProps> = (props) => {
  const [showPassword, setShowPassword] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  const { deleteVaultItem } = useVault();
  const crypto = CryptoService.getInstance();

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDelete = async () => {
    if (confirm(`Delete ${props.item.service}?`)) {
      await deleteVaultItem(props.item.id!);
    }
  };

  const getPasswordStrength = () => {
    // Handle case where password might not be decrypted yet
    if (!props.item.password) {
      return { text: 'ENCRYPTED', color: 'text-gray-500/60' };
    }
    const strength = crypto.calculatePasswordStrength(props.item.password);
    if (strength >= 80) return { text: 'STRONG', color: 'text-green-500/60' };
    if (strength >= 50) return { text: 'MEDIUM', color: 'text-yellow-500/60' };
    return { text: 'WEAK', color: 'text-red-500/60' };
  };

  const strength = getPasswordStrength();

  return (
    <div class="flex items-center justify-between">
      <div class="flex-1">
        <div class="flex items-center gap-4 mb-2">
          <h3 class="text-white/80 font-light text-base tracking-wide">{props.item.service}</h3>
          <span class={`text-[10px] ${strength.color} font-light tracking-widest`}>{strength.text}</span>
        </div>
        <p class="text-white/60 text-sm font-light">{props.item.username}</p>
        
        <Show when={props.item.url}>
          <p class="text-white/30 text-xs font-light mt-2">{props.item.url}</p>
        </Show>
      </div>

      <div class="flex items-center gap-2">
        {/* Copy Username */}
        <button
          onClick={() => copyToClipboard(props.item.username)}
          class="w-10 h-10 flex items-center justify-center text-white/20 hover:text-white/60 transition-all duration-300"
          title="Copy username"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </button>

        {/* Copy Password */}
        <button
          onClick={() => copyToClipboard(props.item.password || '')}
          class="w-10 h-10 flex items-center justify-center text-white/20 hover:text-white/60 transition-all duration-300"
          title="Copy password"
          disabled={!props.item.password}
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
          </svg>
        </button>

        {/* Show/Hide Password */}
        <button
          onClick={() => setShowPassword(!showPassword())}
          class="w-10 h-10 flex items-center justify-center text-white/20 hover:text-white/60 transition-all duration-300"
          title={showPassword() ? 'Hide password' : 'Show password'}
        >
          <Show
            when={showPassword()}
            fallback={
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            }
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
            </svg>
          </Show>
        </button>

        {/* Delete */}
        <button
          onClick={handleDelete}
          class="w-10 h-10 flex items-center justify-center text-white/20 hover:text-red-500/60 transition-all duration-300"
          title="Delete"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>

      {/* Password Display Overlay - Design System Modal */}
      <Show when={showPassword()}>
        <div class="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-6" onClick={() => setShowPassword(false)}>
          <div class="bg-black border border-white/20 p-8 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <p class="text-white/30 text-[10px] font-light tracking-widest mb-6">PASSWORD</p>
            <p class="font-mono text-white/80 text-base leading-relaxed break-all mb-8">{props.item.password || 'Password not available'}</p>
            <button
              onClick={() => setShowPassword(false)}
              class="w-full py-4 border border-white/20 hover:border-white/40 text-white/60 hover:text-white/80 text-xs font-light tracking-wider transition-all duration-300"
            >
              CLOSE
            </button>
          </div>
        </div>
      </Show>

      {/* Copy Notification - Design System Toast */}
      <Show when={copied()}>
        <div class="fixed bottom-8 left-1/2 transform -translate-x-1/2 bg-black border border-white/20 px-6 py-3 text-white/60 text-xs font-light tracking-wider z-50">
          COPIED
        </div>
      </Show>
    </div>
  );
};

export default VaultItemCard;