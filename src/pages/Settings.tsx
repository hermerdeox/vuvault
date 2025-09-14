import { Component, createSignal, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { DatabaseService } from '../lib/db/database';
import { AuthService } from '../lib/auth/auth-service';
import { ImportModal } from '../components/ImportModal';

const Settings: Component = () => {
  const navigate = useNavigate();
  const [isExporting, setIsExporting] = createSignal(false);
  const [isClearing, setIsClearing] = createSignal(false);
  const [showImport, setShowImport] = createSignal(false);
  const db = DatabaseService.getInstance();
  const auth = AuthService.getInstance();

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const data = await db.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vuvault-backup-${new Date().toISOString()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
      alert('Failed to export data');
    } finally {
      setIsExporting(false);
    }
  };

  const handleClearData = async () => {
    if (confirm('This will delete all your passwords. This action cannot be undone. Continue?')) {
      setIsClearing(true);
      try {
        await db.clearAllData();
        await auth.logout();
        navigate('/', { replace: true });
      } catch (error) {
        console.error('Clear data failed:', error);
        alert('Failed to clear data');
      } finally {
        setIsClearing(false);
      }
    }
  };

  return (
    <div class="min-h-screen bg-black text-white">
      {/* Header - Design System Compliant */}
      <header class="fixed top-0 left-0 right-0 h-16 z-50 bg-black border-b border-white/5">
        <div class="max-w-3xl mx-auto px-8 h-full flex items-center justify-between">
          <button
            onClick={() => navigate('/vault')}
            class="flex items-center gap-3 text-white/40 hover:text-white/60 transition-all duration-300"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M15 19l-7-7 7-7" />
            </svg>
            <span class="text-xs font-light tracking-wider">BACK</span>
          </button>
          
          <h1 class="text-xs font-light tracking-widest text-white/80">SETTINGS</h1>
          
          <div class="w-20"></div> {/* Spacer for centering */}
        </div>
      </header>

      <main class="pt-24 pb-12 px-6 md:px-8 max-w-3xl mx-auto">
        {/* Security Section */}
        <section class="mb-16">
          <h2 class="text-[10px] font-light tracking-widest text-white/30 mb-8">SECURITY</h2>
          
          <div class="space-y-px bg-white/5">
            <div class="bg-black p-6 flex items-center justify-between">
              <div>
                <p class="text-white/80 font-light text-base">Encryption</p>
                <p class="text-white/40 text-xs font-light mt-2">ChaCha20-Poly1305</p>
              </div>
              <span class="text-green-500/60 text-[10px] font-light tracking-widest">ACTIVE</span>
            </div>
            
            <div class="bg-black p-6 flex items-center justify-between">
              <div>
                <p class="text-white/80 font-light text-base">Biometric Authentication</p>
                <p class="text-white/40 text-xs font-light mt-2">WebAuthn with device credentials</p>
              </div>
              <span class="text-green-500/60 text-[10px] font-light tracking-widest">ENABLED</span>
            </div>
            
            <div class="bg-black p-6 flex items-center justify-between">
              <div>
                <p class="text-white/80 font-light text-base">Zero-Knowledge Architecture</p>
                <p class="text-white/40 text-xs font-light mt-2">All encryption happens locally</p>
              </div>
              <span class="text-green-500/60 text-[10px] font-light tracking-widest">VERIFIED</span>
            </div>
          </div>
        </section>

        {/* Data Management Section */}
        <section class="mb-16">
          <h2 class="text-[10px] font-light tracking-widest text-white/30 mb-8">DATA MANAGEMENT</h2>
          
          <div class="space-y-px bg-white/5">
            <div class="bg-black p-6 flex items-center justify-between">
              <div>
                <p class="text-white/80 font-light text-base">Import Passwords</p>
                <p class="text-white/40 text-xs font-light mt-2">Import from other password managers</p>
              </div>
              <button
                onClick={() => setShowImport(true)}
                class="px-6 py-3 border border-white/20 hover:border-white/40 text-white/60 hover:text-white/80 text-[10px] font-light tracking-widest transition-all duration-300"
              >
                IMPORT
              </button>
            </div>
            
            <div class="bg-black p-6 flex items-center justify-between">
              <div>
                <p class="text-white/80 font-light text-base">Export Vault</p>
                <p class="text-white/40 text-xs font-light mt-2">Download encrypted backup</p>
              </div>
              <button
                onClick={handleExport}
                disabled={isExporting()}
                class="px-6 py-3 border border-white/20 hover:border-white/40 text-white/60 hover:text-white/80 text-[10px] font-light tracking-widest transition-all duration-300 disabled:opacity-50"
              >
                {isExporting() ? 'EXPORTING...' : 'EXPORT'}
              </button>
            </div>
            
            <div class="bg-black p-6 flex items-center justify-between">
              <div>
                <p class="text-white/80 font-light text-base">Clear All Data</p>
                <p class="text-white/40 text-xs font-light mt-2">Permanently delete all passwords</p>
              </div>
              <button
                onClick={handleClearData}
                disabled={isClearing()}
                class="px-6 py-3 border border-red-500/20 hover:border-red-500/40 text-red-500/60 hover:text-red-500/80 text-[10px] font-light tracking-widest transition-all duration-300 disabled:opacity-50"
              >
                {isClearing() ? 'CLEARING...' : 'CLEAR'}
              </button>
            </div>
          </div>
        </section>

        {/* About Section */}
        <section>
          <h2 class="text-[10px] font-light tracking-widest text-white/30 mb-8">ABOUT</h2>
          
          <div class="space-y-px bg-white/5">
            <div class="bg-black p-6">
              <p class="text-white/80 font-light text-base">VuVault Zero</p>
              <p class="text-white/40 text-xs font-light mt-2">Version 1.0.0</p>
            </div>
            
            <div class="bg-black p-6">
              <p class="text-white/80 font-light text-base">Storage</p>
              <p class="text-white/40 text-xs font-light mt-2">IndexedDB (Local Only)</p>
            </div>
            
            <div class="bg-black p-6">
              <p class="text-white/80 font-light text-base">Open Source</p>
              <p class="text-white/40 text-xs font-light mt-2">MIT License</p>
            </div>
          </div>
        </section>

        {/* Footer */}
        <div class="mt-24 text-center">
          <p class="text-white/20 text-[10px] font-light tracking-wider">
            YOUR DATA NEVER LEAVES YOUR DEVICE
          </p>
          <p class="text-white/10 text-[10px] font-light tracking-wider mt-4">
            © 2024 VUVAULT ZERO
          </p>
        </div>
      </main>
      
      {/* Import Modal */}
      <Show when={showImport()}>
        <ImportModal onClose={() => setShowImport(false)} />
      </Show>
    </div>
  );
};

export default Settings;