import { Component, onMount, createSignal, Show } from 'solid-js';
import { Route, useNavigate } from '@solidjs/router';
import { DatabaseService } from './lib/db/database';
import { AuthService } from './lib/auth/auth-service';
import { CryptoService } from './lib/crypto/crypto-service';
import Login from './pages/Login';
import Vault from './pages/Vault';
import Settings from './pages/Settings';
import { VaultProvider } from './context/VaultContext';

const App: Component = () => {
  const [isInitialized, setIsInitialized] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const navigate = useNavigate();

  onMount(async () => {
    try {
      // Initialize services
      await DatabaseService.getInstance().initialize();
      await CryptoService.getInstance().initialize();
      
      // Check authentication
      const isAuthenticated = await AuthService.getInstance().checkAuth();
      
      if (!isAuthenticated) {
        navigate('/login', { replace: true });
      }
      
      setIsInitialized(true);
    } catch (err) {
      console.error('Initialization failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to initialize app');
    }
  });

  return (
    <VaultProvider>
      <div class="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 text-white safe-top safe-bottom">
        <Show when={error()}>
          <div class="fixed top-4 right-4 bg-danger text-white p-4 rounded-lg shadow-lg">
            {error()}
          </div>
        </Show>
        
        <Show when={isInitialized()} fallback={
          <div class="flex items-center justify-center min-h-screen">
            <div class="text-center">
              <div class="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <p class="text-xl">Initializing secure vault...</p>
            </div>
          </div>
        }>
          <Route path="/login" component={Login} />
          <Route path="/" component={Vault} />
          <Route path="/settings" component={Settings} />
        </Show>
      </div>
    </VaultProvider>
  );
};

export default App;
