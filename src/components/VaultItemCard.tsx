import { Component, createSignal, Show } from 'solid-js';
import { VaultItem } from '../lib/db/database';
import { CryptoService } from '../lib/crypto/crypto-service';
import { useVault } from '../context/VaultContext';
import { useTheme } from '../context/ThemeContext';

interface VaultItemCardProps {
  item: VaultItem;
}

const VaultItemCard: Component<VaultItemCardProps> = (props) => {
  const [showPassword, setShowPassword] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  const { deleteVaultItem } = useVault();
  const { isDark } = useTheme();
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
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }}>
      <div style={{ flex: 1 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          marginBottom: '0.5rem'
        }}>
          <h3 style={{
            color: 'var(--text-secondary)',
            fontWeight: 'var(--font-light)',
            fontSize: '1rem',
            letterSpacing: 'var(--tracking-wide)'
          }}>{props.item.service}</h3>
          <span style={{
            fontSize: '0.625rem',
            fontWeight: 'var(--font-light)',
            letterSpacing: 'var(--tracking-widest)',
            color: strength.text === 'STRONG' ? 'var(--success)' : 
                  strength.text === 'MEDIUM' ? 'var(--warning)' : 
                  'var(--danger)'
          }}>{strength.text}</span>
        </div>
        <p style={{
          color: 'var(--text-tertiary)',
          fontSize: '0.875rem',
          fontWeight: 'var(--font-light)'
        }}>{props.item.username}</p>
        
        <Show when={props.item.url}>
          <p style={{
            color: 'var(--text-muted)',
            fontSize: '0.75rem',
            fontWeight: 'var(--font-light)',
            marginTop: '0.5rem'
          }}>{props.item.url}</p>
        </Show>
      </div>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem'
      }}>
        {/* Copy Username */}
        <button
          onClick={() => copyToClipboard(props.item.username)}
          style={{
            width: '2.5rem',
            height: '2.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
            transition: 'color 0.3s ease'
          }}
          onMouseOver={(e) => e.currentTarget.style.color = 'var(--text-tertiary)'}
          onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
          title="Copy username"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </button>

        {/* Copy Password */}
        <button
          onClick={() => copyToClipboard(props.item.password || '')}
          style={{
            width: '2.5rem',
            height: '2.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
            transition: 'color 0.3s ease',
            opacity: props.item.password ? '1' : '0.5'
          }}
          onMouseOver={(e) => {
            if (props.item.password) {
              e.currentTarget.style.color = 'var(--text-tertiary)';
            }
          }}
          onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
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
          style={{
            width: '2.5rem',
            height: '2.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
            transition: 'color 0.3s ease'
          }}
          onMouseOver={(e) => e.currentTarget.style.color = 'var(--text-tertiary)'}
          onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
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
          style={{
            width: '2.5rem',
            height: '2.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
            transition: 'color 0.3s ease'
          }}
          onMouseOver={(e) => e.currentTarget.style.color = 'var(--danger)'}
          onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
          title="Delete"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>

      {/* Password Display Overlay - Design System Modal */}
      <Show when={showPassword()}>
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: isDark() ? 'rgba(0, 0, 0, 0.9)' : 'rgba(255, 255, 255, 0.9)',
          zIndex: 50,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.5rem'
        }} onClick={() => setShowPassword(false)}>
          <div style={{
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-primary)',
            padding: '2rem',
            maxWidth: '28rem',
            width: '100%'
          }} onClick={(e) => e.stopPropagation()}>
            <p style={{
              color: 'var(--text-muted)',
              fontSize: '0.625rem',
              fontWeight: 'var(--font-light)',
              letterSpacing: 'var(--tracking-widest)',
              marginBottom: '1.5rem'
            }}>PASSWORD</p>
            <p style={{
              fontFamily: 'monospace',
              color: 'var(--text-secondary)',
              fontSize: '1rem',
              lineHeight: '1.5',
              wordBreak: 'break-all',
              marginBottom: '2rem'
            }}>{props.item.password || 'Password not available'}</p>
            <button
              onClick={() => setShowPassword(false)}
              style={{
                width: '100%',
                padding: '1rem 0',
                border: '1px solid var(--border-secondary)',
                color: 'var(--text-tertiary)',
                fontSize: '0.75rem',
                fontWeight: 'var(--font-light)',
                letterSpacing: 'var(--tracking-wider)',
                transition: 'all 0.3s ease'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-primary)';
                e.currentTarget.style.color = 'var(--text-secondary)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-secondary)';
                e.currentTarget.style.color = 'var(--text-tertiary)';
              }}
            >
              CLOSE
            </button>
          </div>
        </div>
      </Show>

      {/* Copy Notification - Design System Toast */}
      <Show when={copied()}>
        <div style={{
          position: 'fixed',
          bottom: '2rem',
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: 'var(--bg-primary)',
          border: '1px solid var(--border-primary)',
          padding: '0.75rem 1.5rem',
          color: 'var(--text-tertiary)',
          fontSize: '0.75rem',
          fontWeight: 'var(--font-light)',
          letterSpacing: 'var(--tracking-wider)',
          zIndex: 50
        }}>
          COPIED
        </div>
      </Show>
    </div>
  );
};

export default VaultItemCard;