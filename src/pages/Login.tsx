import { Component, createSignal, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { AuthService } from '../lib/auth/auth-service';

const Login: Component = () => {
  const [isRegistering, setIsRegistering] = createSignal(false);
  const [username, setUsername] = createSignal('');
  const [error, setError] = createSignal('');
  const [isLoading, setIsLoading] = createSignal(false);
  const navigate = useNavigate();
  const auth = AuthService.getInstance();

  const handleAuth = async () => {
    setError('');
    setIsLoading(true);

    try {
      let success = false;
      
      if (isRegistering()) {
        if (!username()) {
          setError('Username is required for registration');
          setIsLoading(false);
          return;
        }
        success = await auth.register(username());
      } else {
        success = await auth.login();
      }

      if (success) {
        // Mark that user has a vault
        if (isRegistering()) {
          localStorage.setItem('vuvault_has_vault', 'true');
        }
        navigate('/vault', { replace: true });
      } else {
        setError(isRegistering() ? 'Registration failed' : 'Authentication failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div class="min-h-screen bg-black text-white flex items-center justify-center p-4">
      <div class="w-full max-w-sm">
        {/* Back Button - Design System Compliant */}
        <button
          onClick={() => navigate('/')}
          class="fixed top-8 left-8 w-11 h-11 flex items-center justify-center text-white/40 hover:text-white/60 transition-all duration-300"
        >
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div class="text-center">
          {/* Lock Icon - Design System (64x64 mobile, no border radius) */}
          <div class="mb-12">
            <div class="w-16 h-16 border border-white/10 flex items-center justify-center mx-auto">
              <svg class="w-6 h-6 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
          </div>

          <h1 class="text-2xl font-thin mb-2">
            {isRegistering() ? 'Create Vault' : 'Access Vault'}
          </h1>
          <p class="text-white/40 text-sm font-light mb-12 leading-relaxed">
            {isRegistering() ? 'Set up your secure password manager' : 'Authenticate with biometrics'}
          </p>

          <Show when={isRegistering()}>
            <input
              type="text"
              placeholder="Enter username"
              value={username()}
              onInput={(e) => setUsername(e.currentTarget.value)}
              class="w-full h-12 px-4 bg-transparent border border-white/10 text-white/90 placeholder-white/30 font-light text-base focus:outline-none focus:border-white/30 transition-all duration-300 mb-8"
            />
          </Show>

          <Show when={error()}>
            <div class="mb-6 p-3 border border-red-500/20 bg-red-500/10">
              <p class="text-red-400 text-sm font-light">{error()}</p>
            </div>
          </Show>

          <button
            onClick={handleAuth}
            disabled={isLoading()}
            class="group relative w-full h-14 px-8 text-xs tracking-wider font-light border border-white/20 hover:border-white/40 transition-all duration-500 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden"
          >
            <span class="relative z-10 flex items-center justify-center h-full">
              {isLoading() ? (
                <>
                  <div class="w-4 h-4 border border-white/40 border-t-transparent rounded-full animate-spin mr-3"></div>
                  <span>AUTHENTICATING</span>
                </>
              ) : (
                isRegistering() ? 'CREATE VAULT' : 'AUTHENTICATE'
              )}
            </span>
            <div class="absolute inset-0 bg-white/5 scale-x-0 group-hover:scale-x-100 transition-transform duration-500 origin-left"></div>
          </button>

          <button
            onClick={() => setIsRegistering(!isRegistering())}
            class="mt-8 text-white/40 hover:text-white/60 text-[10px] font-light tracking-wider transition-all duration-300"
          >
            {isRegistering() ? 'ALREADY HAVE A VAULT?' : 'NEW TO VUVAULT?'}
          </button>

          <Show when={!isRegistering()}>
            <div class="mt-12 pt-8 border-t border-white/5">
              <p class="text-white/20 text-[10px] font-light tracking-wide">
                Your biometric data never leaves your device
              </p>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
};

export default Login;