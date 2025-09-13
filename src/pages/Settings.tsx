import { Component, createSignal } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { DatabaseService } from '../lib/db/database';
import { AuthService } from '../lib/auth/auth-service';

const Settings: Component = () => {
  const navigate = useNavigate();
  const [isExporting, setIsExporting] = createSignal(false);
  const [isClearing, setIsClearing] = createSignal(false);
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
      a.download = `eoxvault-backup-${new Date().toISOString()}.json`;
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
      {/* Header */}
      <header class="border-b border-white/5 sticky top-0 bg-black/90 backdrop-blur-xl z-40">
        <div class="max-w-3xl mx-auto px-6 py-4">
          <div class="flex items-center justify-between">
            <button
              onClick={() => navigate('/vault')}
              class="flex items-center space-x-3 text-white/40 hover:text-white/60 transition-colors duration-300"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M15 19l-7-7 7-7" />
              </svg>
              <span class="text-sm font-light tracking-wider">BACK</span>
            </button>
            
            <h1 class="text-sm font-light tracking-wider text-white/80">SETTINGS</h1>
            
            <div class="w-16"></div> {/* Spacer for centering */}
          </div>
        </div>
      </header>

      <main class="max-w-3xl mx-auto px-6 py-12">
        {/* Security Section */}
        <section class="mb-12">
          <h2 class="text-xs font-light tracking-widest text-white/40 mb-6">SECURITY</h2>
          
          <div class="space-y-px bg-white/5">
            <div class="bg-black p-6 flex items-center justify-between">
              <div>
                <p class="text-white/90 font-light">Encryption</p>
                <p class="text-white/40 text-sm font-light mt-1">ChaCha20-Poly1305</p>
              </div>
              <span class="text-green-500/60 text-xs font-light">ACTIVE</span>
            </div>
            
            <div class="bg-black p-6 flex items-center justify-between">
              <div>
                <p class="text-white/90 font-light">Biometric Authentication</p>
                <p class="text-white/40 text-sm font-light mt-1">WebAuthn with device credentials</p>
              </div>
              <span class="text-green-500/60 text-xs font-light">ENABLED</span>
            </div>
            
            <div class="bg-black p-6 flex items-center justify-between">
              <div>
                <p class="text-white/90 font-light">Zero-Knowledge Architecture</p>
                <p class="text-white/40 text-sm font-light mt-1">All encryption happens locally</p>
              </div>
              <span class="text-green-500/60 text-xs font-light">VERIFIED</span>
            </div>
          </div>
        </section>

        {/* Data Management Section */}
        <section class="mb-12">
          <h2 class="text-xs font-light tracking-widest text-white/40 mb-6">DATA MANAGEMENT</h2>
          
          <div class="space-y-px bg-white/5">
            <div class="bg-black p-6 flex items-center justify-between">
              <div>
                <p class="text-white/90 font-light">Export Vault</p>
                <p class="text-white/40 text-sm font-light mt-1">Download encrypted backup</p>
              </div>
              <button
                onClick={handleExport}
                disabled={isExporting()}
                class="px-4 py-2 border border-white/20 hover:border-white/40 text-white/60 hover:text-white/80 text-xs font-light tracking-wider transition-all duration-300 disabled:opacity-50"
              >
                {isExporting() ? 'EXPORTING...' : 'EXPORT'}
              </button>
            </div>
            
            <div class="bg-black p-6 flex items-center justify-between">
              <div>
                <p class="text-white/90 font-light">Clear All Data</p>
                <p class="text-white/40 text-sm font-light mt-1">Permanently delete all passwords</p>
              </div>
              <button
                onClick={handleClearData}
                disabled={isClearing()}
                class="px-4 py-2 border border-red-500/20 hover:border-red-500/40 text-red-500/60 hover:text-red-500/80 text-xs font-light tracking-wider transition-all duration-300 disabled:opacity-50"
              >
                {isClearing() ? 'CLEARING...' : 'CLEAR'}
              </button>
            </div>
          </div>
        </section>

        {/* About Section */}
        <section>
          <h2 class="text-xs font-light tracking-widest text-white/40 mb-6">ABOUT</h2>
          
          <div class="space-y-px bg-white/5">
            <div class="bg-black p-6">
              <p class="text-white/90 font-light">EOXVault Zero</p>
              <p class="text-white/40 text-sm font-light mt-1">Version 1.0.0</p>
            </div>
            
            <div class="bg-black p-6">
              <p class="text-white/90 font-light">Storage</p>
              <p class="text-white/40 text-sm font-light mt-1">IndexedDB (Local Only)</p>
            </div>
            
            <div class="bg-black p-6">
              <p class="text-white/90 font-light">Open Source</p>
              <p class="text-white/40 text-sm font-light mt-1">MIT License</p>
            </div>
          </div>
        </section>

        {/* Footer */}
        <div class="mt-24 text-center">
          <p class="text-white/20 text-xs font-light">
            Your data never leaves your device
          </p>
          <p class="text-white/10 text-xs font-light mt-2">
            © 2024 EOXVAULT ZERO
          </p>
        </div>
      </main>
    </div>
  );
};

export default Settings;