// Master File Import/Export Modal
// Handles .vu master backup files with password protection

import { Component, createSignal, Show, onCleanup } from 'solid-js';
import { MasterFileHandler } from '../lib/import/master-file-handler';
import { useVault } from '../context/VaultContext';

interface MasterFileModalProps {
  mode: 'import' | 'export';
  onClose: () => void;
}

export const MasterFileModal: Component<MasterFileModalProps> = (props) => {
  const { refreshVault } = useVault();
  
  const [password, setPassword] = createSignal('');
  const [confirmPassword, setConfirmPassword] = createSignal('');
  const [showPassword, setShowPassword] = createSignal(false);
  const [isProcessing, setIsProcessing] = createSignal(false);
  const [error, setError] = createSignal('');
  const [success, setSuccess] = createSignal('');
  const [file, setFile] = createSignal<File | null>(null);
  const [isDragging, setIsDragging] = createSignal(false);
  const [importResult, setImportResult] = createSignal<any>(null);
  
  // Prevent background scrolling
  document.body.style.position = 'fixed';
  document.body.style.width = '100%';
  
  onCleanup(() => {
    document.body.style.position = '';
    document.body.style.width = '';
  });
  
  const handleExport = async () => {
    setError('');
    setSuccess('');
    
    // Validate passwords
    if (!password()) {
      setError('Password is required');
      return;
    }
    
    if (password() !== confirmPassword()) {
      setError('Passwords do not match');
      return;
    }
    
    if (password().length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    
    setIsProcessing(true);
    
    try {
      const { data, filename } = await MasterFileHandler.exportMasterFile(password());
      
      // Create download
      const blob = new Blob([data], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      
      setSuccess(`Master backup exported as ${filename}`);
      
      // Clear form after short delay
      setTimeout(() => {
        props.onClose();
      }, 2000);
      
    } catch (error) {
      setError(error.message || 'Failed to export master file');
    } finally {
      setIsProcessing(false);
    }
  };
  
  const handleImport = async () => {
    if (!file()) {
      setError('Please select a file');
      return;
    }
    
    if (!password()) {
      setError('Password is required');
      return;
    }
    
    setError('');
    setSuccess('');
    setIsProcessing(true);
    
    try {
      const fileContent = await file()!.text();
      
      // First validate the file
      const validation = await MasterFileHandler.validateMasterFile(fileContent);
      if (!validation.valid) {
        throw new Error(validation.errors.join(', '));
      }
      
      // Import the file
      const result = await MasterFileHandler.importMasterFile(fileContent, password());
      
      if (!result.success) {
        throw new Error(result.errors.join(', '));
      }
      
      setImportResult(result);
      setSuccess(`Successfully imported ${result.itemsImported} items and ${result.settingsImported} settings`);
      
      // Refresh vault
      await refreshVault();
      
      // Close after delay
      setTimeout(() => {
        props.onClose();
      }, 3000);
      
    } catch (error) {
      setError(error.message || 'Failed to import master file');
    } finally {
      setIsProcessing(false);
    }
  };
  
  const handleFileDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const droppedFile = e.dataTransfer?.files[0];
    if (droppedFile && droppedFile.name.endsWith('.vu')) {
      setFile(droppedFile);
      setError('');
    } else {
      setError('Please select a valid .vu file');
    }
  };
  
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  
  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };
  
  return (
    <div class="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-6">
      <div class="bg-black border border-white/20 w-full max-w-lg">
        {/* Header */}
        <div class="border-b border-white/10 p-8">
          <h2 class="text-lg font-thin text-white/80 tracking-wide">
            {props.mode === 'export' ? 'EXPORT MASTER FILE' : 'IMPORT MASTER FILE'}
          </h2>
          <p class="text-[10px] text-white/40 tracking-widest mt-2">
            {props.mode === 'export' 
              ? 'CREATE ENCRYPTED BACKUP OF ALL DATA' 
              : 'RESTORE FROM ENCRYPTED BACKUP'}
          </p>
        </div>
        
        {/* Content */}
        <div class="p-8">
          <Show when={props.mode === 'import'}>
            {/* File Selection */}
            <div class="mb-6">
              <div
                class={`border-2 border-dashed transition-all duration-300 p-8 text-center ${
                  isDragging() 
                    ? 'border-white/60 bg-white/5' 
                    : 'border-white/20 hover:border-white/30'
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleFileDrop}
              >
                <input
                  type="file"
                  accept=".vu"
                  class="hidden"
                  id="master-file-input"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setFile(f);
                      setError('');
                    }
                  }}
                  disabled={isProcessing()}
                />
                
                <label for="master-file-input" class="cursor-pointer block">
                  <Show when={!file()}>
                    <div class="w-12 h-12 border border-white/10 flex items-center justify-center mx-auto mb-4">
                      <svg class="w-6 h-6 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" 
                              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                    </div>
                    <p class="text-white/60 text-sm font-light">
                      {isDragging() ? 'DROP .VU FILE HERE' : 'DRAG & DROP OR CLICK'}
                    </p>
                    <p class="text-[10px] text-white/30 tracking-widest mt-2">
                      ACCEPTS: .VU MASTER FILES
                    </p>
                  </Show>
                  
                  <Show when={file()}>
                    <div class="w-12 h-12 border border-green-500/30 flex items-center justify-center mx-auto mb-4">
                      <svg class="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <p class="text-white/80 text-sm font-light">{file()!.name}</p>
                    <p class="text-[10px] text-white/40 tracking-widest mt-2">
                      SIZE: {(file()!.size / 1024).toFixed(2)} KB
                    </p>
                  </Show>
                </label>
              </div>
            </div>
          </Show>
          
          {/* Password Fields */}
          <div class="space-y-4">
            <div>
              <label class="text-[10px] text-white/40 tracking-widest block mb-2">
                {props.mode === 'export' ? 'CREATE PASSWORD' : 'ENTER PASSWORD'}
              </label>
              <div class="relative">
                <input
                  type={showPassword() ? 'text' : 'password'}
                  value={password()}
                  onInput={(e) => setPassword(e.currentTarget.value)}
                  placeholder="Enter password..."
                  disabled={isProcessing()}
                  class="w-full h-12 px-4 bg-transparent border border-white/20 text-white/80 placeholder-white/30 focus:border-white/40 focus:outline-none transition-all duration-300 disabled:opacity-50"
                />
                <button
                  onClick={() => setShowPassword(!showPassword())}
                  class="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/60 transition-colors"
                >
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {showPassword() ? (
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    ) : (
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    )}
                  </svg>
                </button>
              </div>
            </div>
            
            <Show when={props.mode === 'export'}>
              <div>
                <label class="text-[10px] text-white/40 tracking-widest block mb-2">
                  CONFIRM PASSWORD
                </label>
                <input
                  type={showPassword() ? 'text' : 'password'}
                  value={confirmPassword()}
                  onInput={(e) => setConfirmPassword(e.currentTarget.value)}
                  placeholder="Confirm password..."
                  disabled={isProcessing()}
                  class="w-full h-12 px-4 bg-transparent border border-white/20 text-white/80 placeholder-white/30 focus:border-white/40 focus:outline-none transition-all duration-300 disabled:opacity-50"
                />
              </div>
            </Show>
          </div>
          
          {/* Info Box */}
          <div class="mt-6 p-4 border border-white/10 bg-white/5">
            <p class="text-[10px] text-white/60 tracking-widest mb-2">
              {props.mode === 'export' ? 'EXPORT INFO' : 'IMPORT INFO'}
            </p>
            <ul class="text-xs text-white/40 space-y-1">
              {props.mode === 'export' ? (
                <>
                  <li>• All passwords and settings will be exported</li>
                  <li>• File will be encrypted with ChaCha20-Poly1305</li>
                  <li>• Password protected with PBKDF2-SHA512</li>
                  <li>• Filename: {`{XXXXX}_${new Date().toLocaleDateString('en-GB').replace(/\//g, '')}.vu`}</li>
                </>
              ) : (
                <>
                  <li>• All existing data will be preserved</li>
                  <li>• Duplicate items will be skipped</li>
                  <li>• Settings will be merged</li>
                  <li>• Requires the original export password</li>
                </>
              )}
            </ul>
          </div>
          
          {/* Import Result */}
          <Show when={importResult()}>
            <div class="mt-4 p-4 border border-green-500/30 bg-green-500/5">
              <p class="text-green-400 text-sm mb-2">Import Complete!</p>
              <ul class="text-xs text-green-400/60 space-y-1">
                <li>• Items imported: {importResult().itemsImported}</li>
                <li>• Settings imported: {importResult().settingsImported}</li>
                {importResult().errors.length > 0 && (
                  <li>• Warnings: {importResult().errors.length}</li>
                )}
              </ul>
            </div>
          </Show>
          
          {/* Error/Success Messages */}
          <Show when={error()}>
            <div class="mt-4 p-3 border border-red-500/30 bg-red-500/5">
              <p class="text-red-400 text-sm">{error()}</p>
            </div>
          </Show>
          
          <Show when={success()}>
            <div class="mt-4 p-3 border border-green-500/30 bg-green-500/5">
              <p class="text-green-400 text-sm">{success()}</p>
            </div>
          </Show>
        </div>
        
        {/* Footer */}
        <div class="border-t border-white/10 p-8 flex gap-3">
          <button
            onClick={props.onClose}
            disabled={isProcessing()}
            class="flex-1 h-14 px-6 bg-transparent border border-white/20 text-white/60 hover:text-white/80 hover:border-white/40 transition-all duration-300 text-xs tracking-wider disabled:opacity-50"
          >
            CANCEL
          </button>
          
          <button
            onClick={props.mode === 'export' ? handleExport : handleImport}
            disabled={isProcessing() || (props.mode === 'import' && !file())}
            class="flex-1 h-14 px-6 bg-white text-black hover:bg-white/90 transition-all duration-300 text-xs tracking-wider disabled:opacity-50 disabled:bg-white/50"
          >
            {isProcessing() 
              ? 'PROCESSING...' 
              : props.mode === 'export' 
                ? 'EXPORT MASTER FILE' 
                : 'IMPORT MASTER FILE'}
          </button>
        </div>
      </div>
    </div>
  );
};
