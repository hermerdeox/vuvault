import { Component, createSignal, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { DatabaseService } from '../lib/db/database';
import { AuthService } from '../lib/auth/auth-service';
import { ImportModal } from '../components/ImportModal';
import { MasterFileModal } from '../components/MasterFileModal';

const Settings: Component = () => {
  const navigate = useNavigate();
  const [isExporting, setIsExporting] = createSignal(false);
  const [isClearing, setIsClearing] = createSignal(false);
  const [showImport, setShowImport] = createSignal(false);
  const [showMasterExport, setShowMasterExport] = createSignal(false);
  const [showMasterImport, setShowMasterImport] = createSignal(false);
  const [activeTab, setActiveTab] = createSignal<'backup' | 'security' | 'data' | 'about'>('backup');
  const db = DatabaseService.getInstance();
  const auth = AuthService.getInstance();

  const handleExport = async (format: 'json' | 'csv' = 'json') => {
    setIsExporting(true);
    try {
      const data = await db.exportData(format);
      const mimeType = format === 'csv' ? 'text/csv' : 'application/json';
      const blob = new Blob([data], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vuvault-backup-${new Date().toISOString()}.${format}`;
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
    <div class="h-screen bg-black text-white flex flex-col overflow-hidden">
      {/* Header - Fixed Height */}
      <header class="h-14 bg-black border-b border-white/5 flex-shrink-0">
        <div class="max-w-5xl mx-auto px-6 h-full flex items-center justify-between">
          <button
            onClick={() => navigate('/vault')}
            class="flex items-center gap-2 text-white/40 hover:text-white/60 transition-all duration-300"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M15 19l-7-7 7-7" />
            </svg>
            <span class="text-xs font-light tracking-wider">BACK</span>
          </button>
          
          <h1 class="text-xs font-light tracking-widest text-white/80">SETTINGS</h1>
          
          <div class="w-16"></div>
        </div>
      </header>

      {/* Tab Navigation - Fixed Height */}
      <div class="h-12 border-b border-white/5 flex-shrink-0">
        <div class="max-w-5xl mx-auto px-6 h-full flex items-center gap-8">
          <button
            onClick={() => setActiveTab('backup')}
            class={`text-xs font-light tracking-wider transition-all ${
              activeTab() === 'backup' 
                ? 'text-red-500/80 border-b-2 border-red-500/80' 
                : 'text-white/40 hover:text-white/60'
            } h-full flex items-center`}
          >
            BACKUP
          </button>
          <button
            onClick={() => setActiveTab('security')}
            class={`text-xs font-light tracking-wider transition-all ${
              activeTab() === 'security' 
                ? 'text-white/80 border-b-2 border-white/80' 
                : 'text-white/40 hover:text-white/60'
            } h-full flex items-center`}
          >
            SECURITY
          </button>
          <button
            onClick={() => setActiveTab('data')}
            class={`text-xs font-light tracking-wider transition-all ${
              activeTab() === 'data' 
                ? 'text-white/80 border-b-2 border-white/80' 
                : 'text-white/40 hover:text-white/60'
            } h-full flex items-center`}
          >
            DATA
          </button>
          <button
            onClick={() => setActiveTab('about')}
            class={`text-xs font-light tracking-wider transition-all ${
              activeTab() === 'about' 
                ? 'text-white/80 border-b-2 border-white/80' 
                : 'text-white/40 hover:text-white/60'
            } h-full flex items-center`}
          >
            ABOUT
          </button>
        </div>
      </div>

      {/* Content Area - Fills remaining space, no scroll */}
      <main class="flex-1 overflow-hidden">
        <div class="max-w-5xl mx-auto px-6 py-6 h-full">
          
          {/* Backup Tab */}
          <Show when={activeTab() === 'backup'}>
            <div class="h-full flex flex-col">
              <h2 class="text-[10px] font-light tracking-widest text-white/30 mb-4">MASTER BACKUP</h2>
              
              <div class="grid md:grid-cols-2 gap-3">
                <div class="bg-black border border-white/10 p-4 flex items-center justify-between">
                  <div class="flex-1">
                    <p class="text-white/80 font-light text-sm">Master Export</p>
                    <p class="text-white/40 text-xs font-light mt-1">Complete .vu backup</p>
                  </div>
                  <button
                    onClick={() => setShowMasterExport(true)}
                    class="px-4 py-2 border border-red-500/40 hover:border-red-500/60 text-red-500/80 hover:text-red-500 text-[10px] font-light tracking-widest transition-all duration-300"
                  >
                    CREATE
                  </button>
                </div>
                
                <div class="bg-black border border-white/10 p-4 flex items-center justify-between">
                  <div class="flex-1">
                    <p class="text-white/80 font-light text-sm">Master Import</p>
                    <p class="text-white/40 text-xs font-light mt-1">Restore from .vu</p>
                  </div>
                  <button
                    onClick={() => setShowMasterImport(true)}
                    class="px-4 py-2 border border-white/20 hover:border-white/40 text-white/60 hover:text-white/80 text-[10px] font-light tracking-widest transition-all duration-300"
                  >
                    RESTORE
                  </button>
                </div>
              </div>
              
              <div class="mt-6 p-4 border border-white/10 bg-white/5">
                <p class="text-[10px] text-white/60 tracking-widest mb-2">INFO</p>
                <ul class="text-xs text-white/40 space-y-1">
                  <li>• Master files contain all passwords & settings</li>
                  <li>• Encrypted with ChaCha20-Poly1305</li>
                  <li>• Password protected with PBKDF2</li>
                  <li>• Format: XXXXX_DDMMYY.vu</li>
                </ul>
              </div>
            </div>
          </Show>

          {/* Security Tab */}
          <Show when={activeTab() === 'security'}>
            <div class="h-full flex flex-col">
              <h2 class="text-[10px] font-light tracking-widest text-white/30 mb-4">SECURITY STATUS</h2>
              
              <div class="grid grid-cols-2 lg:grid-cols-3 gap-2">
                <div class="bg-black border border-white/10 p-3">
                  <div class="flex items-center justify-between mb-1">
                    <p class="text-white/80 font-light text-xs">Encryption</p>
                    <span class="text-green-500/60 text-[9px]">ON</span>
                  </div>
                  <p class="text-white/40 text-[10px]">ChaCha20</p>
                </div>
                
                <div class="bg-black border border-white/10 p-3">
                  <div class="flex items-center justify-between mb-1">
                    <p class="text-white/80 font-light text-xs">Biometric</p>
                    <span class="text-green-500/60 text-[9px]">ON</span>
                  </div>
                  <p class="text-white/40 text-[10px]">WebAuthn</p>
                </div>
                
                <div class="bg-black border border-white/10 p-3">
                  <div class="flex items-center justify-between mb-1">
                    <p class="text-white/80 font-light text-xs">Zero-Know</p>
                    <span class="text-green-500/60 text-[9px]">YES</span>
                  </div>
                  <p class="text-white/40 text-[10px]">Local only</p>
                </div>
                
                <div class="bg-black border border-white/10 p-3">
                  <div class="flex items-center justify-between mb-1">
                    <p class="text-white/80 font-light text-xs">Auto-Lock</p>
                    <span class="text-yellow-500/60 text-[9px]">15M</span>
                  </div>
                  <p class="text-white/40 text-[10px]">Timeout</p>
                </div>
                
                <div class="bg-black border border-white/10 p-3">
                  <div class="flex items-center justify-between mb-1">
                    <p class="text-white/80 font-light text-xs">PBKDF2</p>
                    <span class="text-green-500/60 text-[9px]">210K</span>
                  </div>
                  <p class="text-white/40 text-[10px]">Iterations</p>
                </div>
                
                <div class="bg-black border border-white/10 p-3">
                  <div class="flex items-center justify-between mb-1">
                    <p class="text-white/80 font-light text-xs">Workers</p>
                    <span class="text-green-500/60 text-[9px]">ON</span>
                  </div>
                  <p class="text-white/40 text-[10px]">Parallel</p>
                </div>
              </div>
            </div>
          </Show>

          {/* Data Tab */}
          <Show when={activeTab() === 'data'}>
            <div class="h-full flex flex-col">
              <h2 class="text-[10px] font-light tracking-widest text-white/30 mb-4">DATA MANAGEMENT</h2>
              
              <div class="space-y-3">
                <div class="bg-black border border-white/10 p-4 flex items-center justify-between">
                  <div class="flex-1">
                    <p class="text-white/80 font-light text-sm">Import</p>
                    <p class="text-white/40 text-xs font-light mt-1">From password managers</p>
                  </div>
                  <button
                    onClick={() => setShowImport(true)}
                    class="px-4 py-2 border border-white/20 hover:border-white/40 text-white/60 hover:text-white/80 text-[10px] font-light tracking-widest transition-all duration-300"
                  >
                    IMPORT
                  </button>
                </div>
                
                <div class="bg-black border border-white/10 p-4 flex items-center justify-between">
                  <div class="flex-1">
                    <p class="text-white/80 font-light text-sm">Export</p>
                    <p class="text-white/40 text-xs font-light mt-1">JSON or CSV format</p>
                  </div>
                  <div class="flex gap-2">
                    <button
                      onClick={() => handleExport('json')}
                      disabled={isExporting()}
                      class="px-3 py-2 border border-white/20 hover:border-white/40 text-white/60 hover:text-white/80 text-[10px] font-light tracking-wider transition-all duration-300 disabled:opacity-50"
                    >
                      JSON
                    </button>
                    <button
                      onClick={() => handleExport('csv')}
                      disabled={isExporting()}
                      class="px-3 py-2 border border-white/20 hover:border-white/40 text-white/60 hover:text-white/80 text-[10px] font-light tracking-wider transition-all duration-300 disabled:opacity-50"
                    >
                      CSV
                    </button>
                  </div>
                </div>
                
                <div class="bg-black border border-white/10 p-4 flex items-center justify-between">
                  <div class="flex-1">
                    <p class="text-white/80 font-light text-sm">Clear All Data</p>
                    <p class="text-white/40 text-xs font-light mt-1">Permanently delete all passwords</p>
                  </div>
                  <button
                    onClick={handleClearData}
                    disabled={isClearing()}
                    class="px-4 py-2 border border-red-500/20 hover:border-red-500/40 text-red-500/60 hover:text-red-500/80 text-[10px] font-light tracking-widest transition-all duration-300 disabled:opacity-50"
                  >
                    {isClearing() ? 'CLEARING...' : 'CLEAR'}
                  </button>
                </div>
              </div>
            </div>
          </Show>

          {/* About Tab */}
          <Show when={activeTab() === 'about'}>
            <div class="h-full flex flex-col">
              <h2 class="text-[10px] font-light tracking-widest text-white/30 mb-4">ABOUT VUVAULT</h2>
              
              <div class="grid grid-cols-2 lg:grid-cols-3 gap-2">
                <div class="bg-black border border-white/10 p-3">
                  <p class="text-white/80 font-light text-xs">Version</p>
                  <p class="text-white/40 text-[10px] mt-1">2.0.0</p>
                </div>
                
                <div class="bg-black border border-white/10 p-3">
                  <p class="text-white/80 font-light text-xs">Storage</p>
                  <p class="text-white/40 text-[10px] mt-1">IndexedDB</p>
                </div>
                
                <div class="bg-black border border-white/10 p-3">
                  <p class="text-white/80 font-light text-xs">License</p>
                  <p class="text-white/40 text-[10px] mt-1">MIT</p>
                </div>
                
                <div class="bg-black border border-white/10 p-3">
                  <p class="text-white/80 font-light text-xs">Framework</p>
                  <p class="text-white/40 text-[10px] mt-1">SolidJS</p>
                </div>
                
                <div class="bg-black border border-white/10 p-3">
                  <p class="text-white/80 font-light text-xs">PWA</p>
                  <p class="text-white/40 text-[10px] mt-1">Offline</p>
                </div>
                
                <div class="bg-black border border-white/10 p-3">
                  <p class="text-white/80 font-light text-xs">Platform</p>
                  <p class="text-white/40 text-[10px] mt-1">Browser</p>
                </div>
              </div>
              
              <div class="mt-auto pt-6 text-center">
                <p class="text-white/20 text-[10px] font-light tracking-wider">
                  YOUR DATA NEVER LEAVES YOUR DEVICE
                </p>
                <p class="text-white/10 text-[10px] font-light tracking-wider mt-2">
                  © 2024 VUVAULT ZERO
                </p>
              </div>
            </div>
          </Show>
        </div>
      </main>
      
      {/* Import Modal */}
      <Show when={showImport()}>
        <ImportModal onClose={() => setShowImport(false)} />
      </Show>
      
      {/* Master Export Modal */}
      <Show when={showMasterExport()}>
        <MasterFileModal mode="export" onClose={() => setShowMasterExport(false)} />
      </Show>
      
      {/* Master Import Modal */}
      <Show when={showMasterImport()}>
        <MasterFileModal mode="import" onClose={() => setShowMasterImport(false)} />
      </Show>
    </div>
  );
};

export default Settings;