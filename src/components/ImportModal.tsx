// Import Modal Component with Drag & Drop Support
// Non-breaking addition to existing UI components
// Follows VuVault design system

import { Component, createSignal, Show, For } from 'solid-js';
import { FlexibleImporter, ImportResult } from '../lib/import/flexible-importer';
import { VaultItem } from '../lib/db/database';
import { useVault } from '../context/VaultContext';

interface ImportModalProps {
  onClose: () => void;
}

export const ImportModal: Component<ImportModalProps> = (props) => {
  const { addVaultItem, crypto } = useVault();
  
  const [isDragging, setIsDragging] = createSignal(false);
  const [isProcessing, setIsProcessing] = createSignal(false);
  const [file, setFile] = createSignal<File | null>(null);
  const [importResult, setImportResult] = createSignal<ImportResult | null>(null);
  const [error, setError] = createSignal('');
  const [currentStep, setCurrentStep] = createSignal<'upload' | 'preview' | 'complete'>('upload');
  
  // Prevent background scrolling
  const preventScroll = () => {
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
  };
  
  const allowScroll = () => {
    document.body.style.position = '';
    document.body.style.width = '';
  };
  
  // Initialize
  preventScroll();
  
  const handleFile = async (f: File) => {
    setError('');
    setIsProcessing(true);
    
    try {
      // Validate file
      if (!f.type.includes('json') && !f.name.endsWith('.json')) {
        throw new Error('Please select a JSON file');
      }
      
      if (f.size > 10 * 1024 * 1024) { // 10MB limit
        throw new Error('File size exceeds 10MB limit');
      }
      
      // Import and preview
      const result = await FlexibleImporter.importJSON(f);
      
      if (!result.success) {
        throw new Error(result.errors[0] || 'Import failed');
      }
      
      setFile(f);
      setImportResult(result);
      setCurrentStep('preview');
      
    } catch (err) {
      setError(err.message || 'Failed to process file');
      console.error('Import error:', err);
    } finally {
      setIsProcessing(false);
    }
  };
  
  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const f = e.dataTransfer?.files[0];
    if (f) {
      handleFile(f);
    }
  };
  
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  
  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    // Only set to false if leaving the drop zone entirely
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (
      e.clientX <= rect.left ||
      e.clientX >= rect.right ||
      e.clientY <= rect.top ||
      e.clientY >= rect.bottom
    ) {
      setIsDragging(false);
    }
  };
  
  const performImport = async () => {
    const result = importResult();
    if (!result) return;
    
    setIsProcessing(true);
    setError('');
    
    try {
      // Encrypt passwords and add items
      let successCount = 0;
      const errors: string[] = [];
      
      for (const item of result.items) {
        try {
          // Encrypt the password
          const encrypted = await crypto.encryptData(item.encryptedPassword);
          
          // Add to vault
          await addVaultItem({
            ...item,
            encryptedPassword: Array.from(encrypted.encrypted),
            nonce: Array.from(encrypted.nonce)
          });
          
          successCount++;
        } catch (err) {
          errors.push(`Failed to import ${item.service}: ${err.message}`);
          console.error('Item import error:', err);
        }
      }
      
      // Update result with actual import stats
      setImportResult({
        ...result,
        statistics: {
          ...result.statistics,
          imported: successCount
        },
        errors: [...result.errors, ...errors]
      });
      
      setCurrentStep('complete');
      
    } catch (err) {
      setError('Failed to save imported items');
      console.error('Save error:', err);
    } finally {
      setIsProcessing(false);
    }
  };
  
  const handleClose = () => {
    allowScroll();
    props.onClose();
  };
  
  return (
    <div class="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-6">
      <div class="bg-black border border-white/20 w-full max-w-2xl">
        {/* Header */}
        <div class="border-b border-white/10 p-8">
          <h2 class="text-lg font-thin text-white/80 tracking-wide">
            IMPORT PASSWORDS
          </h2>
        </div>
        
        {/* Content */}
        <div class="p-8">
          <Show when={currentStep() === 'upload'}>
            {/* Upload Step */}
            <div
              class={`border-2 border-dashed transition-all duration-300 p-12 text-center ${
                isDragging() 
                  ? 'border-white/60 bg-white/5' 
                  : 'border-white/20 hover:border-white/30'
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <input
                type="file"
                accept=".json,application/json"
                class="hidden"
                id="file-input"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
                disabled={isProcessing()}
              />
              
              <label for="file-input" class="cursor-pointer block">
                <div class="w-16 h-16 border border-white/10 flex items-center justify-center mx-auto mb-6">
                  <svg class="w-8 h-8 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" 
                          d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                
                <p class="text-white/60 font-light mb-2">
                  {isDragging() ? 'DROP FILE HERE' : 'DRAG & DROP OR CLICK TO BROWSE'}
                </p>
                
                <p class="text-[10px] text-white/30 tracking-widest">
                  SUPPORTS: LASTPASS • 1PASSWORD • BITWARDEN • DASHLANE • KEEPASS • GENERIC JSON
                </p>
              </label>
            </div>
            
            <Show when={error()}>
              <div class="mt-6 p-4 border border-red-500/30 bg-red-500/5">
                <p class="text-red-400 text-sm font-light">{error()}</p>
              </div>
            </Show>
          </Show>
          
          <Show when={currentStep() === 'preview' && importResult()}>
            {/* Preview Step */}
            <div class="space-y-6">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-white/40 text-[10px] tracking-widest mb-2">FORMAT DETECTED</p>
                  <p class="text-white/80 font-light uppercase">{importResult()!.format}</p>
                </div>
                
                <div class="text-right">
                  <p class="text-white/40 text-[10px] tracking-widest mb-2">ITEMS FOUND</p>
                  <p class="text-white/80 font-light">{importResult()!.statistics.total}</p>
                </div>
              </div>
              
              {/* Preview Items */}
              <div class="border border-white/10 max-h-64 overflow-hidden">
                <div class="p-4 space-y-2">
                  <For each={importResult()!.items.slice(0, 5)}>
                    {(item) => (
                      <div class="flex justify-between items-center py-2 border-b border-white/5 last:border-0">
                        <div>
                          <p class="text-white/80 text-sm">{item.service}</p>
                          <p class="text-white/40 text-xs">{item.username || 'No username'}</p>
                        </div>
                        <Show when={item.url}>
                          <p class="text-white/30 text-xs truncate max-w-[200px]">{item.url}</p>
                        </Show>
                      </div>
                    )}
                  </For>
                  
                  <Show when={importResult()!.items.length > 5}>
                    <p class="text-white/30 text-xs text-center pt-2">
                      ...AND {importResult()!.items.length - 5} MORE
                    </p>
                  </Show>
                </div>
              </div>
              
              {/* Statistics */}
              <div class="grid grid-cols-3 gap-4">
                <div>
                  <p class="text-white/40 text-[10px] tracking-widest mb-1">READY TO IMPORT</p>
                  <p class="text-green-400 font-light">{importResult()!.statistics.imported}</p>
                </div>
                
                <Show when={importResult()!.statistics.duplicates > 0}>
                  <div>
                    <p class="text-white/40 text-[10px] tracking-widest mb-1">DUPLICATES</p>
                    <p class="text-yellow-400 font-light">{importResult()!.statistics.duplicates}</p>
                  </div>
                </Show>
                
                <Show when={importResult()!.statistics.skipped > 0}>
                  <div>
                    <p class="text-white/40 text-[10px] tracking-widest mb-1">SKIPPED</p>
                    <p class="text-red-400 font-light">{importResult()!.statistics.skipped}</p>
                  </div>
                </Show>
              </div>
              
              {/* Warnings */}
              <Show when={importResult()!.warnings.length > 0}>
                <div class="p-4 border border-yellow-500/30 bg-yellow-500/5">
                  <p class="text-yellow-400 text-xs font-light mb-2">WARNINGS:</p>
                  <ul class="space-y-1">
                    <For each={importResult()!.warnings.slice(0, 3)}>
                      {(warning) => (
                        <li class="text-yellow-400/60 text-xs">• {warning}</li>
                      )}
                    </For>
                  </ul>
                </div>
              </Show>
            </div>
          </Show>
          
          <Show when={currentStep() === 'complete'}>
            {/* Complete Step */}
            <div class="text-center py-8">
              <div class="w-16 h-16 border border-green-500/30 flex items-center justify-center mx-auto mb-6">
                <svg class="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              
              <h3 class="text-white/80 font-light text-lg mb-2">IMPORT COMPLETE</h3>
              
              <p class="text-white/40 text-sm mb-6">
                Successfully imported {importResult()?.statistics.imported || 0} passwords
              </p>
              
              <Show when={importResult()?.errors.length > 0}>
                <div class="p-4 border border-red-500/30 bg-red-500/5 text-left mb-6">
                  <p class="text-red-400 text-xs font-light mb-2">ERRORS:</p>
                  <ul class="space-y-1">
                    <For each={importResult()!.errors.slice(0, 3)}>
                      {(error) => (
                        <li class="text-red-400/60 text-xs">• {error}</li>
                      )}
                    </For>
                  </ul>
                </div>
              </Show>
            </div>
          </Show>
        </div>
        
        {/* Footer */}
        <div class="border-t border-white/10 p-8 flex gap-3">
          <Show when={currentStep() === 'upload'}>
            <button
              onClick={handleClose}
              class="flex-1 h-14 px-6 bg-transparent border border-white/20 text-white/60 hover:text-white/80 hover:border-white/40 transition-all duration-300 text-xs tracking-wider"
            >
              CANCEL
            </button>
          </Show>
          
          <Show when={currentStep() === 'preview'}>
            <button
              onClick={() => {
                setCurrentStep('upload');
                setImportResult(null);
                setFile(null);
              }}
              disabled={isProcessing()}
              class="flex-1 h-14 px-6 bg-transparent border border-white/20 text-white/60 hover:text-white/80 hover:border-white/40 transition-all duration-300 text-xs tracking-wider disabled:opacity-50"
            >
              BACK
            </button>
            
            <button
              onClick={performImport}
              disabled={isProcessing() || !importResult()?.items.length}
              class="flex-1 h-14 px-6 bg-white text-black hover:bg-white/90 transition-all duration-300 text-xs tracking-wider disabled:opacity-50"
            >
              {isProcessing() ? 'IMPORTING...' : `IMPORT ${importResult()?.items.length || 0} ITEMS`}
            </button>
          </Show>
          
          <Show when={currentStep() === 'complete'}>
            <button
              onClick={handleClose}
              class="flex-1 h-14 px-6 bg-white text-black hover:bg-white/90 transition-all duration-300 text-xs tracking-wider"
            >
              DONE
            </button>
          </Show>
        </div>
      </div>
    </div>
  );
};
