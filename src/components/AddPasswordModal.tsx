import { Component, createSignal, createEffect, Show } from 'solid-js';
import { VaultItem } from '../lib/db/database';
import { CryptoService } from '../lib/crypto/crypto-service';
import { useVault } from '../context/VaultContext';
import LoadingSpinner, { LoadingController } from './LoadingSpinner';

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
  const [currentStep, setCurrentStep] = createSignal(1);
  const [copied, setCopied] = createSignal(false);
  const [isLoading, setIsLoading] = createSignal(false);
  
  const loadingController = LoadingController.getInstance();

  // Prevent body scroll when modal is open - CRITICAL for no-scroll policy
  createEffect(() => {
    if (props.isOpen) {
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
    } else {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
    }
  });

  const handleSubmit = async () => {
    try {
      console.log('Submit clicked - checking fields...');
      
      if (!service() || !username() || !password()) {
        alert('Please fill in all required fields');
        return;
      }

      // Show loading spinner
      setIsLoading(true);
      
      try {
        console.log('Creating vault item...');
        const vaultItem: VaultItem = {
          service: service(),
          username: username(),
          password: password(),
          url: url(),
          notes: notes(),
          tags: tags(),
          createdAt: props.item?.createdAt || Date.now(),
          updatedAt: Date.now(),
          encryptedPassword: '' // This will be handled by VaultContext
        };

        console.log('Vault item:', vaultItem);

        // Use a more robust approach for mobile PWA
        if (props.item?.id) {
          vaultItem.id = props.item.id;
          console.log('Updating item...');
          await updateVaultItem(vaultItem);
          console.log('Item updated successfully');
        } else {
          console.log('Adding new item...');
          // Ensure we have a master key before attempting to save
          const { getMasterKey, setMasterKey } = await import('../lib/db/database');
          const masterKey = await getMasterKey();
          
          if (!masterKey) {
            console.log('No master key found, creating one...');
            // Generate a secure master key
            const randomKey = window.crypto.getRandomValues(new Uint8Array(32))
              .reduce((acc, byte) => acc + byte.toString(16).padStart(2, '0'), '');
            await setMasterKey(randomKey);
            console.log('Master key created successfully');
          }
          
          // Add with retry logic for mobile PWA
          let attempts = 0;
          let success = false;
          
          while (attempts < 3 && !success) {
            try {
              await addVaultItem(vaultItem);
              success = true;
              console.log('Item added successfully');
            } catch (e) {
              attempts++;
              console.error(`Attempt ${attempts} failed:`, e);
              if (attempts >= 3) throw e;
              // Wait a bit before retrying
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }
        }

        console.log('Success! Resetting form...');
        
        // Reset form
        setService('');
        setUsername('');
        setPassword('');
        setUrl('');
        setNotes('');
        setTags([]);
        setCurrentStep(1);
        props.onClose();
      } catch (error) {
        console.error('Error saving item:', error);
        throw error;
      } finally {
        setIsLoading(false);
      }
      
    } catch (error) {
      console.error('Error in handleSubmit:', error);
      alert('Failed to save password: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsLoading(false);
    }
  };

  const generatePassword = () => {
    setIsGenerating(true);
    const newPassword = crypto.generatePassword(20, {
      uppercase: true,
      lowercase: true,
      numbers: true,
      symbols: true,
    });
    setPassword(newPassword);
    setIsGenerating(false);
  };

  const toggleTag = (tag: string) => {
    if (tags().includes(tag)) {
      setTags(tags().filter(t => t !== tag));
    } else {
      setTags([...tags(), tag]);
    }
  };

  const nextStep = () => {
    // Validate current step before proceeding
    if (currentStep() === 1) {
      if (!service() || !username() || !password()) {
        alert('Please complete all required fields');
        return;
      }
    }
    if (currentStep() < 3) setCurrentStep(currentStep() + 1);
  };

  const prevStep = () => {
    if (currentStep() > 1) setCurrentStep(currentStep() - 1);
  };

  if (!props.isOpen) return null;

  return (
    <>
      <LoadingSpinner show={isLoading()} message="Saving password..." />
      
      {/* Mobile Modal (320px - 767px) - Full Screen NO SCROLL */}
      <div class="fixed inset-0 bg-black z-50 md:hidden flex flex-col">
        {/* Fixed Header with safe area insets */}
        <header class="bg-black border-b border-white/10 flex items-center justify-between px-4 flex-shrink-0 pt-safe">
          <div class="h-14 w-full flex items-center justify-between">
            <button
              onClick={props.onClose}
              class="w-10 h-10 flex items-center justify-center text-white/40"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <h2 class="text-xs font-light text-white/80 tracking-widest">
              {props.item ? 'EDIT' : 'NEW'} • STEP {currentStep()} OF 3
            </h2>
            <div class="w-10"></div>
          </div>
        </header>

        {/* Step Indicator */}
        <div class="px-6 py-3 flex items-center justify-center gap-2 flex-shrink-0">
          {[1, 2, 3].map(step => (
            <div class={`h-0.5 w-16 ${step <= currentStep() ? 'bg-white/40' : 'bg-white/10'} transition-all duration-300`}></div>
          ))}
        </div>

        {/* Form Content - NO SCROLL, fits in viewport */}
        <div class="flex-1 px-6 py-4 flex flex-col justify-center">
          {/* Step 1: Core Fields */}
          {currentStep() === 1 && (
            <div class="space-y-4">
              <div>
                <label class="block text-white/30 text-[10px] font-light mb-2 tracking-widest">SERVICE *</label>
                <input
                  type="text"
                  placeholder="e.g., GitHub"
                  value={service()}
                  onInput={(e) => setService(e.currentTarget.value)}
                  class="w-full h-12 px-4 bg-black border border-white/10 text-white/90 placeholder-white/30 font-light text-base focus:outline-none focus:border-white/30"
                  required
                />
              </div>
              <div>
                <label class="block text-white/30 text-[10px] font-light mb-2 tracking-widest">USERNAME *</label>
                <input
                  type="text"
                  placeholder="e.g., user@example.com"
                  value={username()}
                  onInput={(e) => setUsername(e.currentTarget.value)}
                  class="w-full h-12 px-4 bg-black border border-white/10 text-white/90 placeholder-white/30 font-light text-base focus:outline-none focus:border-white/30"
                  required
                />
              </div>
              <div>
                <label class="block text-white/30 text-[10px] font-light mb-2 tracking-widest">PASSWORD *</label>
                <div class="relative">
                  <input
                    type={showPassword() ? 'text' : 'password'}
                    placeholder="Enter password"
                    value={password()}
                    onInput={(e) => setPassword(e.currentTarget.value)}
                    class="w-full h-12 px-4 pr-20 bg-black border border-white/10 text-white/90 placeholder-white/30 font-light text-base focus:outline-none focus:border-white/30"
                    required
                  />
                  <div class="absolute right-1 top-1/2 -translate-y-1/2 flex">
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword())}
                      class="w-8 h-8 flex items-center justify-center text-white/30 hover:text-white/60 transition-all duration-300"
                      title={showPassword() ? "Hide password" : "Show password"}
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d={showPassword() ? "M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" : "M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"} />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={generatePassword}
                      disabled={isGenerating()}
                      class="w-8 h-8 flex items-center justify-center text-white/40 hover:text-white/70 transition-all duration-300 disabled:opacity-50"
                      title="Generate strong password"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
                      </svg>
                    </button>
                    {password() && (
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(password());
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }}
                        class="w-8 h-8 flex items-center justify-center text-white/30 hover:text-white/60 transition-all duration-300"
                        title="Copy password"
                      >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
                {password() && (
                  <div class="mt-2">
                    <div class="h-0.5 bg-white/5">
                      <div 
                        class={`h-full transition-all duration-300 ${
                          crypto.calculatePasswordStrength(password()).score >= 80 ? 'bg-green-500/60' :
                          crypto.calculatePasswordStrength(password()).score >= 50 ? 'bg-yellow-500/60' :
                          'bg-red-500/60'
                        }`}
                        style={{ width: `${crypto.calculatePasswordStrength(password()).score}%` }}
                      />
                    </div>
                    <p class="text-[10px] text-white/30 mt-1 font-light tracking-wider">
                      CRYPTANALYTIC TIME: {crypto.calculatePasswordStrength(password()).timeToBreak}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 2: Additional Info */}
          {currentStep() === 2 && (
            <div class="space-y-4">
              <div>
                <label class="block text-white/30 text-[10px] font-light mb-2 tracking-widest">URL</label>
                <input
                  type="url"
                  placeholder="e.g., https://github.com"
                  value={url()}
                  onInput={(e) => setUrl(e.currentTarget.value)}
                  class="w-full h-12 px-4 bg-black border border-white/10 text-white/90 placeholder-white/30 font-light text-base focus:outline-none focus:border-white/30"
                />
              </div>
              <div>
                <label class="block text-white/30 text-[10px] font-light mb-2 tracking-widest">NOTES</label>
                <textarea
                  placeholder="Additional notes..."
                  value={notes()}
                  onInput={(e) => setNotes(e.currentTarget.value)}
                  rows={3}
                  class="w-full px-4 py-3 bg-black border border-white/10 text-white/90 placeholder-white/30 font-light text-base focus:outline-none focus:border-white/30 resize-none"
                />
              </div>
            </div>
          )}

          {/* Step 3: Categories */}
          {currentStep() === 3 && (
            <div>
              <label class="block text-white/30 text-[10px] font-light mb-4 tracking-widest">CATEGORIES</label>
              <div class="grid grid-cols-2 gap-3">
                {['social', 'finance', 'work', 'personal'].map((tag) => (
                  <button
                    type="button"
                    onClick={() => toggleTag(tag)}
                    class={`h-12 px-4 text-xs font-light tracking-wider border transition-all ${
                      tags().includes(tag)
                        ? 'border-white/40 text-white/80 bg-white/5'
                        : 'border-white/10 text-white/30'
                    }`}
                  >
                    {tag.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Fixed Footer Actions with safe area insets */}
        <div class="bg-black border-t border-white/10 px-4 flex items-center gap-3 flex-shrink-0 pb-safe">
          <div class="h-16 w-full flex items-center gap-3">
            {currentStep() > 1 && (
              <button
                type="button"
                onClick={prevStep}
                class="flex-1 h-11 border border-white/10 text-white/60 font-light text-xs tracking-wider"
              >
                BACK
              </button>
            )}
            {currentStep() < 3 ? (
              <button
                type="button"
                onClick={nextStep}
                class="flex-1 h-11 border border-white/20 text-white/80 font-light text-xs tracking-wider"
              >
                NEXT
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                class="flex-1 h-11 border border-white/20 text-white/80 bg-white/5 font-light text-xs tracking-wider"
              >
                {props.item ? 'UPDATE' : 'CREATE'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tablet Modal (768px - 1023px) - Fixed Height NO SCROLL */}
      <div class="hidden md:flex lg:hidden fixed inset-0 bg-black/90 z-50 items-center justify-center p-8">
        <div class="bg-black border border-white/20 w-full max-w-2xl h-[600px] flex flex-col">
          {/* Header */}
          <div class="h-14 border-b border-white/10 px-6 flex items-center justify-between flex-shrink-0">
            <h2 class="text-sm font-thin text-white/80 tracking-wide">
              {props.item ? 'Edit Entry' : 'New Entry'} • Step {currentStep()} of 2
            </h2>
            <button
              type="button"
              onClick={props.onClose}
              class="w-10 h-10 flex items-center justify-center text-white/40 hover:text-white/60 transition-all duration-300"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Step Indicator */}
          <div class="px-6 py-3 flex items-center justify-center gap-3 flex-shrink-0">
            {[1, 2].map(step => (
              <div class={`h-0.5 w-24 ${step <= currentStep() ? 'bg-white/40' : 'bg-white/10'} transition-all duration-300`}></div>
            ))}
          </div>

          {/* Form Content - Fixed Height, NO SCROLL */}
          <div class="flex-1 px-6 py-4 flex items-center">
            {/* Step 1: Main Fields (2 columns) */}
            {currentStep() === 1 && (
              <div class="grid grid-cols-2 gap-6 w-full">
                <div class="space-y-4">
                  <div>
                    <label class="block text-white/30 text-[10px] font-light mb-2 tracking-widest">SERVICE *</label>
                    <input
                      type="text"
                      placeholder="e.g., GitHub"
                      value={service()}
                      onInput={(e) => setService(e.currentTarget.value)}
                      class="w-full h-11 px-3 bg-transparent border border-white/10 text-white/90 placeholder-white/30 font-light text-sm focus:outline-none focus:border-white/30 transition-all duration-300"
                      required
                    />
                  </div>
                  <div>
                    <label class="block text-white/30 text-[10px] font-light mb-2 tracking-widest">USERNAME *</label>
                    <input
                      type="text"
                      placeholder="e.g., user@example.com"
                      value={username()}
                      onInput={(e) => setUsername(e.currentTarget.value)}
                      class="w-full h-11 px-3 bg-transparent border border-white/10 text-white/90 placeholder-white/30 font-light text-sm focus:outline-none focus:border-white/30 transition-all duration-300"
                      required
                    />
                  </div>
                  <div>
                    <label class="block text-white/30 text-[10px] font-light mb-2 tracking-widest">URL</label>
                    <input
                      type="url"
                      placeholder="e.g., https://github.com"
                      value={url()}
                      onInput={(e) => setUrl(e.currentTarget.value)}
                      class="w-full h-11 px-3 bg-transparent border border-white/10 text-white/90 placeholder-white/30 font-light text-sm focus:outline-none focus:border-white/30 transition-all duration-300"
                    />
                  </div>
                </div>
                <div class="space-y-4">
                  <div>
                    <label class="block text-white/30 text-[10px] font-light mb-2 tracking-widest">PASSWORD *</label>
                    <div class="relative">
                      <input
                        type={showPassword() ? 'text' : 'password'}
                        placeholder="Enter password"
                        value={password()}
                        onInput={(e) => setPassword(e.currentTarget.value)}
                        class="w-full h-11 px-3 pr-20 bg-transparent border border-white/10 text-white/90 placeholder-white/30 font-light text-sm focus:outline-none focus:border-white/30 transition-all duration-300"
                        required
                      />
                      <div class="absolute right-1 top-1/2 -translate-y-1/2 flex">
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword())}
                          class="w-7 h-7 flex items-center justify-center text-white/30 hover:text-white/60 transition-all duration-300"
                          title={showPassword() ? "Hide password" : "Show password"}
                        >
                          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d={showPassword() ? "M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" : "M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"} />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={generatePassword}
                          disabled={isGenerating()}
                          class="w-7 h-7 flex items-center justify-center text-white/40 hover:text-white/70 transition-all duration-300 disabled:opacity-50"
                          title="Generate strong password"
                        >
                          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
                          </svg>
                        </button>
                        {password() && (
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(password());
                              setCopied(true);
                              setTimeout(() => setCopied(false), 2000);
                            }}
                            class="w-7 h-7 flex items-center justify-center text-white/30 hover:text-white/60 transition-all duration-300"
                            title="Copy password"
                          >
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                    {password() && (
                      <div class="mt-2">
                        <div class="h-0.5 bg-white/5">
                          <div 
                            class={`h-full transition-all duration-300 ${
                              crypto.calculatePasswordStrength(password()).score >= 80 ? 'bg-green-500/60' :
                              crypto.calculatePasswordStrength(password()).score >= 50 ? 'bg-yellow-500/60' :
                              'bg-red-500/60'
                            }`}
                            style={{ width: `${crypto.calculatePasswordStrength(password()).score}%` }}
                          />
                        </div>
                        <p class="text-[9px] text-white/30 mt-1 font-light tracking-wider">
                          CRYPTANALYTIC TIME: {crypto.calculatePasswordStrength(password()).timeToBreak}
                        </p>
                      </div>
                    )}
                  </div>
                  <div>
                    <label class="block text-white/30 text-[10px] font-light mb-2 tracking-widest">CATEGORIES</label>
                    <div class="grid grid-cols-2 gap-2">
                      {['social', 'finance', 'work', 'personal'].map((tag) => (
                        <button
                          type="button"
                          onClick={() => toggleTag(tag)}
                          class={`px-3 py-1.5 text-[10px] font-light tracking-wider border transition-all duration-300 ${
                            tags().includes(tag)
                              ? 'border-white/40 text-white/80 bg-white/5'
                              : 'border-white/10 text-white/30 hover:border-white/20'
                          }`}
                        >
                          {tag.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Step 2: Notes */}
            {currentStep() === 2 && (
              <div class="w-full">
                <label class="block text-white/30 text-[10px] font-light mb-3 tracking-widest">NOTES</label>
                <textarea
                  placeholder="Additional notes about this entry..."
                  value={notes()}
                  onInput={(e) => setNotes(e.currentTarget.value)}
                  rows={8}
                  class="w-full px-4 py-3 bg-transparent border border-white/10 text-white/90 placeholder-white/30 font-light text-sm focus:outline-none focus:border-white/30 transition-all duration-300 resize-none"
                />
              </div>
            )}
          </div>

          {/* Actions */}
          <div class="h-16 border-t border-white/10 px-6 flex items-center gap-3 flex-shrink-0">
            {currentStep() > 1 && (
              <button
                type="button"
                onClick={prevStep}
                class="flex-1 h-11 px-6 border border-white/10 text-white/60 hover:border-white/20 hover:text-white/80 font-light text-xs tracking-wider transition-all duration-300"
              >
                BACK
              </button>
            )}
            {currentStep() < 2 ? (
              <button
                type="button"
                onClick={nextStep}
                class="flex-1 h-11 px-6 border border-white/20 text-white/80 hover:border-white/40 font-light text-xs tracking-wider transition-all duration-300"
              >
                NEXT
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                class="flex-1 h-11 px-6 border border-white/20 text-white/80 hover:border-white/40 hover:bg-white/5 font-light text-xs tracking-wider transition-all duration-300"
              >
                {props.item ? 'UPDATE' : 'CREATE'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Desktop Modal (1024px+) - Fixed Height NO SCROLL */}
      <div class="hidden lg:flex fixed inset-0 bg-black/90 backdrop-blur-sm z-50 items-center justify-center p-8">
        <div class="bg-black border border-white/20 w-full max-w-xl h-[580px] flex flex-col">
          {/* Header */}
          <div class="h-16 border-b border-white/10 px-8 flex items-center justify-between flex-shrink-0">
            <h2 class="text-base font-thin text-white/80 tracking-wide">
              {props.item ? 'Edit Entry' : 'New Entry'}
            </h2>
            <button
              type="button"
              onClick={props.onClose}
              class="w-8 h-8 flex items-center justify-center text-white/40 hover:text-white/60 transition-all duration-300"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Form Content - All fields visible, NO SCROLL */}
          <div class="flex-1 px-8 py-6 flex flex-col justify-between">
            <div class="space-y-4">
              {/* Row 1: Service & Username */}
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-white/30 text-[10px] font-light mb-2 tracking-widest">SERVICE *</label>
                  <input
                    type="text"
                    placeholder="e.g., GitHub"
                    value={service()}
                    onInput={(e) => setService(e.currentTarget.value)}
                    class="w-full h-10 px-3 bg-transparent border border-white/10 text-white/90 placeholder-white/30 font-light text-sm focus:outline-none focus:border-white/30 transition-all duration-300"
                    required
                  />
                </div>
                <div>
                  <label class="block text-white/30 text-[10px] font-light mb-2 tracking-widest">USERNAME *</label>
                  <input
                    type="text"
                    placeholder="e.g., user@example.com"
                    value={username()}
                    onInput={(e) => setUsername(e.currentTarget.value)}
                    class="w-full h-10 px-3 bg-transparent border border-white/10 text-white/90 placeholder-white/30 font-light text-sm focus:outline-none focus:border-white/30 transition-all duration-300"
                    required
                  />
                </div>
              </div>

              {/* Row 2: Password */}
              <div>
                <label class="block text-white/30 text-[10px] font-light mb-2 tracking-widest">PASSWORD *</label>
                <div class="relative">
                  <input
                    type={showPassword() ? 'text' : 'password'}
                    placeholder="Enter password"
                    value={password()}
                    onInput={(e) => setPassword(e.currentTarget.value)}
                    class="w-full h-10 px-3 pr-20 bg-transparent border border-white/10 text-white/90 placeholder-white/30 font-light text-sm focus:outline-none focus:border-white/30 transition-all duration-300"
                    required
                  />
                  <div class="absolute right-1 top-1/2 -translate-y-1/2 flex">
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword())}
                      class="w-7 h-7 flex items-center justify-center text-white/30 hover:text-white/60 transition-all duration-300"
                      title={showPassword() ? "Hide password" : "Show password"}
                    >
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d={showPassword() ? "M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" : "M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"} />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={generatePassword}
                      disabled={isGenerating()}
                      class="w-7 h-7 flex items-center justify-center text-white/40 hover:text-white/70 transition-all duration-300 disabled:opacity-50"
                      title="Generate strong password"
                    >
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
                      </svg>
                    </button>
                    {password() && (
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(password());
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }}
                        class="w-7 h-7 flex items-center justify-center text-white/30 hover:text-white/60 transition-all duration-300"
                        title="Copy password"
                      >
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
                {password() && (
                  <div class="mt-2">
                    <div class="h-0.5 bg-white/5">
                      <div 
                        class={`h-full transition-all duration-300 ${
                          crypto.calculatePasswordStrength(password()).score >= 80 ? 'bg-green-500/60' :
                          crypto.calculatePasswordStrength(password()).score >= 50 ? 'bg-yellow-500/60' :
                          'bg-red-500/60'
                        }`}
                        style={{ width: `${crypto.calculatePasswordStrength(password()).score}%` }}
                      />
                    </div>
                    <p class="text-[10px] text-white/30 mt-1 font-light tracking-widest">
                      CRYPTANALYTIC TIME: {crypto.calculatePasswordStrength(password()).timeToBreak}
                    </p>
                  </div>
                )}
              </div>

              {/* Row 3: URL */}
              <div>
                <label class="block text-white/30 text-[10px] font-light mb-2 tracking-widest">URL</label>
                <input
                  type="url"
                  placeholder="e.g., https://github.com"
                  value={url()}
                  onInput={(e) => setUrl(e.currentTarget.value)}
                  class="w-full h-10 px-3 bg-transparent border border-white/10 text-white/90 placeholder-white/30 font-light text-sm focus:outline-none focus:border-white/30 transition-all duration-300"
                />
              </div>

              {/* Row 4: Notes (compact) */}
              <div>
                <label class="block text-white/30 text-[10px] font-light mb-2 tracking-widest">NOTES</label>
                <textarea
                  placeholder="Additional notes..."
                  value={notes()}
                  onInput={(e) => setNotes(e.currentTarget.value)}
                  rows={2}
                  class="w-full px-3 py-2 bg-transparent border border-white/10 text-white/90 placeholder-white/30 font-light text-sm focus:outline-none focus:border-white/30 transition-all duration-300 resize-none"
                />
              </div>

              {/* Row 5: Categories */}
              <div>
                <label class="block text-white/30 text-[10px] font-light mb-2 tracking-widest">CATEGORIES</label>
                <div class="flex gap-2">
                  {['social', 'finance', 'work', 'personal'].map((tag) => (
                    <button
                      type="button"
                      onClick={() => toggleTag(tag)}
                      class={`px-3 py-1.5 text-[10px] font-light tracking-wider border transition-all duration-300 ${
                        tags().includes(tag)
                          ? 'border-white/40 text-white/80 bg-white/5'
                          : 'border-white/10 text-white/30 hover:border-white/20 hover:text-white/60'
                      }`}
                    >
                      {tag.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div class="h-16 border-t border-white/10 px-8 flex items-center gap-3 flex-shrink-0">
            <button
              type="button"
              onClick={props.onClose}
              class="flex-1 h-12 px-6 border border-white/10 text-white/60 hover:border-white/20 hover:text-white/80 font-light text-xs tracking-wider transition-all duration-300"
            >
              CANCEL
            </button>
            <button
              onClick={handleSubmit}
              class="flex-1 h-12 px-6 border border-white/20 text-white/80 hover:border-white/40 hover:bg-white/5 font-light text-xs tracking-wider transition-all duration-300"
            >
              {props.item ? 'UPDATE' : 'CREATE'}
            </button>
          </div>
        </div>
      </div>

      {/* Copy Notification */}
      {copied() && (
        <div class="fixed bottom-8 left-1/2 transform -translate-x-1/2 bg-black border border-white/20 px-4 py-2 text-white/60 text-xs font-light tracking-wider z-[60]">
          PASSWORD COPIED
        </div>
      )}
    </>
  );
};

export default AddPasswordModal;