import { Component, onMount, createSignal, Show } from 'solid-js';
import { DatabaseService } from './lib/db/database';
import { AuthService } from './lib/auth/auth-service';
import { CryptoService } from './lib/crypto/crypto-service';
import { VaultProvider } from './context/VaultContext';
import { ThemeProvider } from './context/ThemeContext';

interface AppWrapperProps {
  children?: any;
}

const AppWrapper: Component<AppWrapperProps> = (props) => {
  const [isInitialized, setIsInitialized] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  onMount(async () => {
    try {
      // Initialize services
      await DatabaseService.getInstance().initialize();
      await CryptoService.getInstance().initialize();
      
      // Check authentication
      const isAuthenticated = await AuthService.getInstance().checkAuth();
      
      // Don't auto-redirect on app load, let users see landing page first
      setIsInitialized(true);
    } catch (err) {
      console.error('Initialization failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to initialize app');
    }
  });

  return (
    <ThemeProvider>
      <VaultProvider>
        <div class="min-h-screen safe-top safe-bottom">
          <Show when={error()}>
            <div class="fixed top-4 right-4 bg-danger text-white p-4 rounded-lg shadow-lg z-50">
              {error()}
            </div>
          </Show>
          
          <Show when={isInitialized()} fallback={
            <div class="flex items-center justify-center min-h-screen">
              <div class="text-center">
                <div class="w-16 h-16 border-4 border-t-transparent rounded-full animate-spin mx-auto mb-4"
                     style="border-color: var(--border-primary); border-top-color: transparent;"></div>
                <p class="text-xl">Initializing secure vault...</p>
              </div>
            </div>
          }>
            {props.children}
          </Show>
        </div>
      </VaultProvider>
    </ThemeProvider>
  );
};

export default AppWrapper;
