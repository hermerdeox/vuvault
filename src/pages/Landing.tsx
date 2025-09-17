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
        <div class="fixed inset-0 flex flex-col" style="background: var(--bg); color: var(--fg); overflow: hidden;">
          {/* HEADER - BRUTALIST MINIMAL */}
          <header class="flex-shrink-0" style="padding: var(--space-2xl) var(--space-lg); border-bottom: var(--border-width) solid var(--border);">
            <nav class="max-w-7xl mx-auto flex justify-between items-center">
              {/* LOGO - STARK & GEOMETRIC */}
              <div class="flex items-center" style="gap: var(--space-md);">
                <div style="width: 48px; height: 48px; border: var(--border-width-thick) solid var(--border); display: flex; align-items: center; justify-content: center;">
                  <span style="font-size: var(--text-xl); font-weight: var(--font-black);">V</span>
                </div>
                <span class="hidden sm:inline" style="font-size: var(--text-sm); font-weight: var(--font-bold); letter-spacing: 0.2em; text-transform: uppercase;">VUVAULT</span>
              </div>
              
              {/* THEME TOGGLE - MINIMAL */}
              <button
                onClick={() => useTheme().toggleTheme()}
                style={{
                  width: '48px',
                  height: '48px',
                  border: `${isDark() ? 'var(--border-width)' : 'var(--border-width-thick)'} solid var(--border)`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0',
                  background: 'transparent',
                  transition: 'all var(--transition-fast)'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.background = 'var(--fg)';
                  e.currentTarget.querySelector('svg').style.color = 'var(--bg)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.querySelector('svg').style.color = 'var(--fg)';
                }}
                title={isDark() ? "LIGHT MODE" : "DARK MODE"}
              >
                <svg style="width: 24px; height: 24px; color: var(--fg);" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {isDark() ? (
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  ) : (
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  )}
                </svg>
              </button>
            </nav>
          </header>

          {/* MAIN - CENTERED WITH GENEROUS SPACE */}
          <main class="flex-1 flex items-center justify-center" style="padding: var(--space-3xl) var(--space-lg);">
            <div class="text-center max-w-6xl mx-auto w-full">
              {/* ICON - PURE GEOMETRY */}
              <div style="margin-bottom: var(--space-3xl);">
                <div style="width: 120px; height: 120px; margin: 0 auto; border: var(--border-width-heavy) solid var(--border); display: flex; align-items: center; justify-content: center; position: relative;">
                  <svg style="width: 48px; height: 48px;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  {/* DECORATIVE CORNERS */}
                  <div style="position: absolute; top: -2px; left: -2px; width: 12px; height: 12px; border-top: var(--border-width-heavy) solid var(--border); border-left: var(--border-width-heavy) solid var(--border);"></div>
                  <div style="position: absolute; top: -2px; right: -2px; width: 12px; height: 12px; border-top: var(--border-width-heavy) solid var(--border); border-right: var(--border-width-heavy) solid var(--border);"></div>
                  <div style="position: absolute; bottom: -2px; left: -2px; width: 12px; height: 12px; border-bottom: var(--border-width-heavy) solid var(--border); border-left: var(--border-width-heavy) solid var(--border);"></div>
                  <div style="position: absolute; bottom: -2px; right: -2px; width: 12px; height: 12px; border-bottom: var(--border-width-heavy) solid var(--border); border-right: var(--border-width-heavy) solid var(--border);"></div>
                </div>
              </div>

              {/* TYPOGRAPHY - BOLD & STARK */}
              <h1 style={{
                fontSize: 'clamp(3rem, 8vw, 7rem)',
                fontWeight: 'var(--font-black)',
                letterSpacing: '-0.02em',
                lineHeight: '0.9',
                marginBottom: 'var(--space-lg)',
                textTransform: 'uppercase'
              }}>
                ZERO<br/>
                <span style="opacity: 0.3;">KNOWLEDGE</span>
              </h1>
              
              {/* TAGLINE - MINIMAL */}
              <p style={{
                fontSize: 'var(--text-lg)',
                fontWeight: 'var(--font-normal)',
                marginBottom: 'var(--space-3xl)',
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                opacity: '0.7'
              }}>
                MILITARY GRADE ENCRYPTION
              </p>

              {/* CTA - BRUTALIST BUTTON */}
              <button
                onClick={handleEnterVault}
                style={{
                  padding: 'var(--space-md) var(--space-2xl)',
                  fontSize: 'var(--text-base)',
                  letterSpacing: '0.2em',
                  fontWeight: 'var(--font-bold)',
                  border: 'var(--border-width-thick) solid var(--border)',
                  background: 'transparent',
                  textTransform: 'uppercase',
                  position: 'relative',
                  transition: 'all var(--transition-fast)',
                  marginBottom: 'var(--space-3xl)'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.background = 'var(--fg)';
                  e.currentTarget.style.color = 'var(--bg)';
                  e.currentTarget.style.transform = 'translate(-4px, -4px)';
                  e.currentTarget.querySelector('.shadow').style.display = 'block';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--fg)';
                  e.currentTarget.style.transform = 'translate(0, 0)';
                  e.currentTarget.querySelector('.shadow').style.display = 'none';
                }}
              >
                {isFirstTime() ? 'INITIALIZE' : 'ENTER'}
                <div class="shadow" style="position: absolute; top: 4px; left: 4px; right: -4px; bottom: -4px; border: var(--border-width-thick) solid var(--border); z-index: -1; display: none;"></div>
              </button>

              {/* FEATURES - MINIMAL LIST */}
              <div style="display: flex; justify-content: center; gap: var(--space-2xl); flex-wrap: wrap;">
                <div style="display: flex; align-items: center; gap: var(--space-sm);">
                  <div style="width: 8px; height: 8px; background: var(--fg);"></div>
                  <span style="font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.1em; font-weight: var(--font-medium);">CHACHA20-POLY1305</span>
                </div>
                <div style="display: flex; align-items: center; gap: var(--space-sm);">
                  <div style="width: 8px; height: 8px; background: var(--fg);"></div>
                  <span style="font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.1em; font-weight: var(--font-medium);">OFFLINE FIRST</span>
                </div>
                <div style="display: flex; align-items: center; gap: var(--space-sm);">
                  <div style="width: 8px; height: 8px; background: var(--fg);"></div>
                  <span style="font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.1em; font-weight: var(--font-medium);">WEBAUTHN</span>
                </div>
              </div>
            </div>
          </main>

          {/* FOOTER - MINIMAL */}
          <footer style="padding: var(--space-xl) var(--space-lg); border-top: var(--border-width) solid var(--border);">
            <div class="max-w-7xl mx-auto text-center">
              <p style="font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.2em; opacity: 0.5;">
                © 2025 VUVAULT — SECURE PASSWORD MANAGEMENT
              </p>
            </div>
          </footer>
        </div>
      </Show>
    </>
  );
};

export default Landing;