import { Component, createSignal, onMount, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { useTheme } from '../context/ThemeContext';
import OnboardingFlow from '../components/OnboardingFlow';

const Landing: Component = () => {
  const navigate = useNavigate();
  const { theme, isDark } = useTheme();
  const [showOnboarding, setShowOnboarding] = createSignal(false);
  const [isFirstTime, setIsFirstTime] = createSignal(false);

  onMount(() => {
    // Check if user has completed onboarding
    const hasCompletedOnboarding = localStorage.getItem('vuvault_onboarding_completed');
    const hasExistingVault = localStorage.getItem('vuvault_has_vault');
    
    // Show onboarding for first-time users
    if (!hasCompletedOnboarding && !hasExistingVault) {
      setIsFirstTime(true);
    }
  });

  const handleStartOnboarding = () => {
    setShowOnboarding(true);
  };

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
    navigate('/login');
  };

  const handleEnterVault = () => {
    if (isFirstTime()) {
      handleStartOnboarding();
    } else {
      navigate('/login');
    }
  };

  return (
    <>
      <Show when={showOnboarding()}>
        <OnboardingFlow onComplete={handleOnboardingComplete} />
      </Show>
      
      <Show when={!showOnboarding()}>
    <div class="min-h-screen flex flex-col overflow-hidden" style="background-color: var(--bg-primary); color: var(--text-primary); max-height: 100vh; position: fixed; inset: 0;">
      {/* Minimal Navigation */}
      <header class="absolute top-0 left-0 right-0 z-50 p-8">
        <nav class="max-w-7xl mx-auto flex justify-between items-center">
          <div class="flex items-center space-x-3">
            <div class="w-8 h-8 rounded flex items-center justify-center" style="border: 1px solid var(--border-secondary);">
              <span style="color: var(--text-secondary); font-weight: var(--font-light);" class="text-sm">V</span>
            </div>
            <span style="color: var(--text-secondary); font-weight: var(--font-light); letter-spacing: var(--tracking-wider);" class="text-sm">VUVAULT</span>
          </div>
          
          {/* Theme Switcher */}
          <button
            onClick={() => useTheme().toggleTheme()}
            style={{
              color: 'var(--text-muted)',
              transition: 'color 0.3s ease'
            }}
            onMouseOver={(e) => e.currentTarget.style.color = 'var(--text-tertiary)'}
            onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
            title={isDark() ? "Switch to Light Theme" : "Switch to Dark Theme"}
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {isDark() ? (
                // Sun icon for dark mode (switch to light)
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              ) : (
                // Moon icon for light mode (switch to dark)
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              )}
            </svg>
          </button>
        </nav>
      </header>

      {/* Minimal Hero */}
      <main class="flex-1 flex items-center justify-center px-6 overflow-hidden">
        <div class="text-center max-w-4xl mx-auto">
          {/* Subtle lock icon */}
          <div class="mb-12 inline-block">
            <div class="w-20 h-20 rounded-full flex items-center justify-center mx-auto" style="border: 1px solid var(--border-tertiary);">
              <svg style="width: 2rem; height: 2rem; color: var(--text-muted);" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
          </div>

          <h1 style={{
            fontSize: 'clamp(2.5rem, 6vw, 5rem)',
            fontWeight: 'var(--font-thin)',
            marginBottom: 'clamp(1rem, 3vh, 1.5rem)',
            letterSpacing: 'var(--tracking-tight)',
            color: 'var(--text-primary)'
          }}>
            Secure.<span style="color: var(--text-muted);"> Simple.</span>
          </h1>
          
          <p style={{
            color: 'var(--text-tertiary)',
            fontSize: 'clamp(0.9rem, 2.5vw, 1.125rem)',
            fontWeight: 'var(--font-light)',
            marginBottom: 'clamp(1.5rem, 4vh, 3rem)',
            maxWidth: '28rem',
            marginLeft: 'auto',
            marginRight: 'auto',
            lineHeight: '1.6'
          }}>
            Zero-Knowledge Architecture With Advanced Cryptographic Protection.
          </p>

          <button
            onClick={handleEnterVault}
            style={{
              position: 'relative',
              padding: '1rem 3rem',
              fontSize: '0.875rem',
              letterSpacing: 'var(--tracking-wider)',
              fontWeight: 'var(--font-light)',
              border: '1px solid var(--border-secondary)',
              overflow: 'hidden',
              transition: 'border-color 0.5s ease'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-primary)';
              const hoverEl = e.currentTarget.querySelector('.hover-effect');
              if (hoverEl) hoverEl.style.transform = 'scaleX(1)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-secondary)';
              const hoverEl = e.currentTarget.querySelector('.hover-effect');
              if (hoverEl) hoverEl.style.transform = 'scaleX(0)';
            }}
          >
            <span style="position: relative; z-index: 10;">{isFirstTime() ? 'GET STARTED' : 'ENTER VAULT'}</span>
            <div class="hover-effect" style="position: absolute; inset: 0; background-color: var(--hover-overlay); transform: scaleX(0); transition: transform 0.5s ease; transform-origin: left;"></div>
          </button>

          {/* Minimal feature indicators */}
          <div style={{
            marginTop: 'clamp(2rem, 4vh, 6rem)',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: 'clamp(1rem, 3vw, 3rem)',
            fontSize: '0.6rem', /* Reduced by 20% from 0.75rem */
            color: 'var(--text-muted)',
            fontWeight: 'var(--font-light)',
            letterSpacing: 'var(--tracking-widest)'
          }}>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <div style="width: 0.25rem; height: 0.25rem; background-color: var(--text-muted); border-radius: 9999px;"></div>
              <span>CHACHA20</span>
            </div>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <div style="width: 0.25rem; height: 0.25rem; background-color: var(--text-muted); border-radius: 9999px;"></div>
              <span>WEBAUTHN</span>
            </div>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <div style="width: 0.25rem; height: 0.25rem; background-color: var(--text-muted); border-radius: 9999px;"></div>
              <span>OFFLINE-FIRST</span>
            </div>
          </div>
        </div>
      </main>

      {/* Minimal Footer */}
      <footer class="p-4 md:p-8 absolute bottom-0 left-0 right-0">
        <div class="max-w-7xl mx-auto text-center">
          <p style="color: var(--text-muted); opacity: 0.5; font-size: 0.75rem; font-weight: var(--font-light); letter-spacing: var(--tracking-wider);">© 2025 VUVAULT ZERO</p>
        </div>
      </footer>
    </div>
      </Show>
    </>
  );
};

export default Landing;