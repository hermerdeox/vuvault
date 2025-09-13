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
        {/* Back to home */}
        <button
          onClick={() => navigate('/')}
          class="fixed top-8 left-8 text-white/40 hover:text-white/60 transition-colors duration-300"
        >
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div class="text-center">
          {/* Lock icon */}
          <div class="mb-12">
            <div class="w-16 h-16 border border-white/10 rounded-full flex items-center justify-center mx-auto">
              <svg class="w-6 h-6 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
          </div>

          <h1 class="text-3xl font-thin mb-2">
            {isRegistering() ? 'Create Vault' : 'Access Vault'}
          </h1>
          <p class="text-white/40 text-sm font-light mb-12">
            {isRegistering() ? 'Set up your secure password manager' : 'Authenticate with biometrics'}
          </p>

          <Show when={isRegistering()}>
            <input
              type="text"
              placeholder="Enter username"
              value={username()}
              onInput={(e) => setUsername(e.currentTarget.value)}
              class="w-full px-4 py-3 bg-transparent border border-white/10 rounded-none text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-colors duration-300 mb-8 font-light"
            />
          </Show>

          <Show when={error()}>
            <div class="mb-6 p-3 border border-red-500/20 bg-red-500/10 text-red-400 text-sm font-light">
              {error()}
            </div>
          </Show>

          <button
            onClick={handleAuth}
            disabled={isLoading()}
            class="group relative w-full px-8 py-4 text-sm tracking-wider font-light border border-white/20 rounded-none hover:border-white/40 transition-all duration-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span class="relative z-10">
              {isLoading() ? (
                <span class="flex items-center justify-center">
                  <div class="w-4 h-4 border border-white/40 border-t-transparent rounded-full animate-spin mr-3"></div>
                  AUTHENTICATING
                </span>
              ) : (
                isRegistering() ? 'CREATE VAULT' : 'AUTHENTICATE'
              )}
            </span>
            <div class="absolute inset-0 bg-white/5 scale-x-0 group-hover:scale-x-100 transition-transform duration-500 origin-left"></div>
          </button>

          <button
            onClick={() => setIsRegistering(!isRegistering())}
            class="mt-8 text-white/40 hover:text-white/60 text-xs font-light tracking-wider transition-colors duration-300"
          >
            {isRegistering() ? 'ALREADY HAVE A VAULT?' : 'NEW TO EOXVAULT?'}
          </button>

          <Show when={!isRegistering()}>
            <div class="mt-12 pt-8 border-t border-white/5">
              <p class="text-white/20 text-xs font-light">
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