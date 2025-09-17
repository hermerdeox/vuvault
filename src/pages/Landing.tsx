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
    <div class="h-screen w-screen flex flex-col" style="background-color: var(--bg-primary); color: var(--text-primary); overflow: hidden;">
      {/* Minimal Navigation - Fixed height header */}
      <header class="flex-shrink-0 p-6 md:p-8">
        <nav class="max-w-7xl mx-auto flex justify-between items-center">
          <div class="flex items-center space-x-3">
            <div class="w-10 h-10 rounded-lg flex items-center justify-center" style="background: linear-gradient(135deg, var(--glass-bg), var(--glass-bg-secondary)); backdrop-filter: blur(10px); border: 1px solid var(--border-secondary);">
              <span style="color: var(--text-primary); font-weight: 600; font-size: 1.125rem;">V</span>
            </div>
            <span style="color: var(--text-secondary); font-weight: var(--font-light); letter-spacing: var(--tracking-wider);" class="text-sm hidden sm:inline">VUVAULT</span>
          </div>
          
          {/* Theme Switcher */}
          <button
            onClick={() => useTheme().toggleTheme()}
            class="p-3 rounded-lg transition-all duration-300"
            style={{
              background: 'var(--glass-bg)',
              backdropFilter: 'blur(10px)',
              border: '1px solid var(--border-tertiary)',
              color: 'var(--text-muted)'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-secondary)';
              e.currentTarget.style.transform = 'scale(1.05)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-tertiary)';
              e.currentTarget.style.transform = 'scale(1)';
            }}
            title={isDark() ? "Switch to Light Theme" : "Switch to Dark Theme"}
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {isDark() ? (
                // Sun icon for dark mode (switch to light)
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              ) : (
                // Moon icon for light mode (switch to dark)
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              )}
            </svg>
          </button>
        </nav>
      </header>

      {/* Main content - Centered and flexible */}
      <main class="flex-1 flex items-center justify-center px-4 sm:px-6 lg:px-8">
        <div class="text-center max-w-4xl mx-auto w-full">
          {/* Enhanced lock icon with glassmorphism */}
          <div class="mb-8 sm:mb-12 inline-block">
            <div class="w-24 h-24 rounded-2xl flex items-center justify-center mx-auto transition-transform duration-300 hover:scale-110" 
                 style="background: linear-gradient(135deg, var(--glass-bg), var(--glass-bg-secondary)); backdrop-filter: blur(20px); border: 1px solid var(--border-tertiary); box-shadow: 0 10px 40px -10px rgba(0,0,0,0.5);">
              <svg style="width: 2.5rem; height: 2.5rem; color: var(--text-secondary);" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
          </div>

          <h1 style={{
            fontSize: 'clamp(2rem, 5vw, 4rem)',
            fontWeight: '200',
            marginBottom: '1rem',
            letterSpacing: '-0.02em',
            color: 'var(--text-primary)',
            lineHeight: '1.1'
          }}>
            Secure.<span style="color: var(--accent-primary);"> Simple.</span>
          </h1>
          
          <p style={{
            color: 'var(--text-secondary)',
            fontSize: 'clamp(0.875rem, 2vw, 1.125rem)',
            fontWeight: '400',
            marginBottom: '2rem',
            maxWidth: '32rem',
            marginLeft: 'auto',
            marginRight: 'auto',
            lineHeight: '1.7',
            opacity: '0.9'
          }}>
            Zero-Knowledge Architecture With Advanced Cryptographic Protection.
          </p>

          <button
            onClick={handleEnterVault}
            class="relative px-8 py-4 rounded-xl transition-all duration-300 transform hover:scale-105"
            style={{
              background: 'linear-gradient(135deg, var(--glass-bg), var(--glass-bg-secondary))',
              backdropFilter: 'blur(20px)',
              border: '1px solid var(--border-secondary)',
              fontSize: '0.9rem',
              letterSpacing: '0.05em',
              fontWeight: '500',
              color: 'var(--text-primary)',
              boxShadow: '0 4px 20px -4px rgba(0,0,0,0.3)',
              overflow: 'hidden'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent-primary)';
              e.currentTarget.style.boxShadow = '0 8px 30px -4px rgba(0,0,0,0.5)';
              const hoverEl = e.currentTarget.querySelector('.hover-effect');
              if (hoverEl) hoverEl.style.opacity = '1';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-secondary)';
              e.currentTarget.style.boxShadow = '0 4px 20px -4px rgba(0,0,0,0.3)';
              const hoverEl = e.currentTarget.querySelector('.hover-effect');
              if (hoverEl) hoverEl.style.opacity = '0';
            }}
          >
            <span style="position: relative; z-index: 10;">{isFirstTime() ? 'GET STARTED' : 'ENTER VAULT'}</span>
            <div class="hover-effect" style="position: absolute; inset: 0; background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary)); opacity: 0; transition: opacity 0.3s ease; mix-blend-mode: overlay;"></div>
          </button>

          {/* Enhanced feature indicators */}
          <div class="mt-8 sm:mt-12 flex flex-wrap justify-center gap-4 sm:gap-6">
            <div class="flex items-center gap-2 px-3 py-1.5 rounded-full transition-all duration-300"
                 style="background: var(--glass-bg); backdrop-filter: blur(10px); border: 1px solid var(--border-tertiary);">
              <div style="width: 6px; height: 6px; background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary)); border-radius: 50%;"></div>
              <span style="color: var(--text-muted); font-size: 0.75rem; font-weight: 500; letter-spacing: 0.05em;">CHACHA20</span>
            </div>
            <div class="flex items-center gap-2 px-3 py-1.5 rounded-full transition-all duration-300"
                 style="background: var(--glass-bg); backdrop-filter: blur(10px); border: 1px solid var(--border-tertiary);">
              <div style="width: 6px; height: 6px; background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary)); border-radius: 50%;"></div>
              <span style="color: var(--text-muted); font-size: 0.75rem; font-weight: 500; letter-spacing: 0.05em;">WEBAUTHN</span>
            </div>
            <div class="flex items-center gap-2 px-3 py-1.5 rounded-full transition-all duration-300"
                 style="background: var(--glass-bg); backdrop-filter: blur(10px); border: 1px solid var(--border-tertiary);">
              <div style="width: 6px; height: 6px; background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary)); border-radius: 50%;"></div>
              <span style="color: var(--text-muted); font-size: 0.75rem; font-weight: 500; letter-spacing: 0.05em;">OFFLINE-FIRST</span>
            </div>
          </div>
        </div>
      </main>

      {/* Fixed footer - Better positioning */}
      <footer class="flex-shrink-0 p-4 sm:p-6">
        <div class="max-w-7xl mx-auto text-center">
          <p style="color: var(--text-muted); opacity: 0.7; font-size: 0.75rem; font-weight: 400; letter-spacing: 0.025em;">
            © 2025 VUVAULT • Secure Password Management
          </p>
        </div>
      </footer>
    </div>
      </Show>
    </>
  );
};

export default Landing;