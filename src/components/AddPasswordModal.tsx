import { Component, createSignal } from 'solid-js';
import { VaultItem } from '../lib/db/database';
import { CryptoService } from '../lib/crypto/crypto-service';
import { useVault } from '../context/VaultContext';

interface AddPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  item?: VaultItem;
}

const AddPasswordModal: Component<AddPasswordModalProps> = (props) => {
  const { addVaultItem, updateVaultItem } = useVault();
  const crypto = CryptoService.getInstance();
  
  const [service, setService] = createSignal(props.item?.service || '');
  const [username, setUsername] = createSignal(props.item?.username || '');
  const [password, setPassword] = createSignal(props.item?.password || '');
  const [url, setUrl] = createSignal(props.item?.url || '');
  const [notes, setNotes] = createSignal(props.item?.notes || '');
  const [tags, setTags] = createSignal<string[]>(props.item?.tags || []);
  const [showPassword, setShowPassword] = createSignal(false);
  const [isGenerating, setIsGenerating] = createSignal(false);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    
    if (!service() || !username() || !password()) {
      alert('Please fill in all required fields');
      return;
    }

    const vaultItem: VaultItem = {
      service: service(),
      username: username(),
      password: password(),
      url: url(),
      notes: notes(),
      tags: tags(),
      createdAt: props.item?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };

    if (props.item?.id) {
      vaultItem.id = props.item.id;
      await updateVaultItem(vaultItem);
    } else {
      await addVaultItem(vaultItem);
    }

    props.onClose();
  };

  const generatePassword = async () => {
    setIsGenerating(true);
    const newPassword = await crypto.generatePassword({
      length: 20,
      includeUppercase: true,
      includeLowercase: true,
      includeNumbers: true,
      includeSymbols: true,
    });
    setPassword(newPassword);
    setIsGenerating(false);
  };

  const handleTagInput = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const input = e.currentTarget as HTMLInputElement;
      const tag = input.value.trim();
      if (tag && !tags().includes(tag)) {
        setTags([...tags(), tag]);
        input.value = '';
      }
    }
  };

  const removeTag = (tagToRemove: string) => {
    setTags(tags().filter(tag => tag !== tagToRemove));
  };

  if (!props.isOpen) return null;

  return (
    <div class="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div class="bg-black border border-white/10 w-full max-w-md">
        <form onSubmit={handleSubmit}>
          {/* Header */}
          <div class="border-b border-white/10 p-6">
            <h2 class="text-xl font-thin text-white/90">
              {props.item ? 'Edit Entry' : 'New Entry'}
            </h2>
          </div>

          {/* Form Fields */}
          <div class="p-6 space-y-4">
            <div>
              <input
                type="text"
                placeholder="Service name *"
                value={service()}
                onInput={(e) => setService(e.currentTarget.value)}
                class="w-full px-4 py-3 bg-transparent border border-white/10 rounded-none text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-colors duration-300 font-light"
                required
              />
            </div>

            <div>
              <input
                type="text"
                placeholder="Username *"
                value={username()}
                onInput={(e) => setUsername(e.currentTarget.value)}
                class="w-full px-4 py-3 bg-transparent border border-white/10 rounded-none text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-colors duration-300 font-light"
                required
              />
            </div>

            <div class="relative">
              <input
                type={showPassword() ? 'text' : 'password'}
                placeholder="Password *"
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                class="w-full px-4 py-3 pr-24 bg-transparent border border-white/10 rounded-none text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-colors duration-300 font-light"
                required
              />
              <div class="absolute right-1 top-1 flex">
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword())}
                  class="p-2 text-white/30 hover:text-white/60 transition-colors duration-300"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d={showPassword() ? "M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" : "M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"} />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={generatePassword}
                  disabled={isGenerating()}
                  class="p-2 text-white/30 hover:text-white/60 transition-colors duration-300 disabled:opacity-50"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>
            </div>

            <div>
              <input
                type="url"
                placeholder="URL (optional)"
                value={url()}
                onInput={(e) => setUrl(e.currentTarget.value)}
                class="w-full px-4 py-3 bg-transparent border border-white/10 rounded-none text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-colors duration-300 font-light"
              />
            </div>

            <div>
              <textarea
                placeholder="Notes (optional)"
                value={notes()}
                onInput={(e) => setNotes(e.currentTarget.value)}
                rows={3}
                class="w-full px-4 py-3 bg-transparent border border-white/10 rounded-none text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-colors duration-300 font-light resize-none"
              />
            </div>

            <div>
              <input
                type="text"
                placeholder="Tags (press Enter to add)"
                onKeyDown={handleTagInput}
                class="w-full px-4 py-3 bg-transparent border border-white/10 rounded-none text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-colors duration-300 font-light"
              />
              {tags().length > 0 && (
                <div class="flex flex-wrap gap-2 mt-2">
                  {tags().map(tag => (
                    <span class="px-3 py-1 bg-white/5 border border-white/10 text-white/60 text-xs font-light flex items-center">
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        class="ml-2 text-white/30 hover:text-white/60"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div class="border-t border-white/10 p-6 flex justify-end space-x-4">
            <button
              type="button"
              onClick={props.onClose}
              class="px-6 py-2 text-white/40 hover:text-white/60 text-sm font-light tracking-wider transition-colors duration-300"
            >
              CANCEL
            </button>
            <button
              type="submit"
              class="px-6 py-2 border border-white/20 hover:border-white/40 text-white/80 hover:text-white text-sm font-light tracking-wider transition-all duration-300"
            >
              {props.item ? 'UPDATE' : 'CREATE'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddPasswordModal;