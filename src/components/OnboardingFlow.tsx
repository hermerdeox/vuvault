import { Component, createSignal, Show, onMount } from 'solid-js';
import { useNavigate } from '@solidjs/router';

interface OnboardingFlowProps {
  onComplete: () => void;
}

const OnboardingFlow: Component<OnboardingFlowProps> = (props) => {
  const [currentStep, setCurrentStep] = createSignal(1);
  const [isAnimating, setIsAnimating] = createSignal(false);
  const navigate = useNavigate();

  // Detect viewport size for responsive step count
  const [isMobile, setIsMobile] = createSignal(window.innerWidth < 768);
  const [isTablet, setIsTablet] = createSignal(window.innerWidth >= 768 && window.innerWidth < 1024);

  onMount(() => {
    // Prevent background scrolling
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';

    // Handle resize
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
      setIsTablet(window.innerWidth >= 768 && window.innerWidth < 1024);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      document.body.style.position = '';
      document.body.style.width = '';
      document.body.style.overflow = '';
      window.removeEventListener('resize', handleResize);
    };
  });

  const totalSteps = () => {
    if (isMobile()) return 5;
    if (isTablet()) return 4;
    return 3;
  };

  const nextStep = () => {
    setIsAnimating(true);
    setTimeout(() => {
      if (currentStep() < totalSteps()) {
        setCurrentStep(currentStep() + 1);
      } else {
        handleComplete();
      }
      setIsAnimating(false);
    }, 200);
  };

  const prevStep = () => {
    if (currentStep() > 1) {
      setIsAnimating(true);
      setTimeout(() => {
        setCurrentStep(currentStep() - 1);
        setIsAnimating(false);
      }, 200);
    }
  };

  const handleComplete = () => {
    // Save onboarding completion to localStorage
    localStorage.setItem('vuvault_onboarding_completed', 'true');
    props.onComplete();
  };

  const skipOnboarding = () => {
    handleComplete();
  };

  // Mobile Steps (5 steps)
  const MobileStep1 = () => (
    <div class="flex flex-col items-center justify-center h-full px-8 text-center">
      <div class="w-20 h-20 border border-white/20 flex items-center justify-center mb-12">
        <span class="text-3xl font-thin text-white/80">V</span>
      </div>
      <h1 class="text-4xl font-thin mb-4 text-white/90">Welcome to VuVault</h1>
      <p class="text-white/40 font-light text-base leading-relaxed max-w-xs">
        Your ultra-secure, zero-knowledge password manager
      </p>
    </div>
  );

  const MobileStep2 = () => (
    <div class="flex flex-col items-center justify-center h-full px-8 text-center">
      <div class="w-16 h-16 border border-white/10 flex items-center justify-center mb-12">
        <svg class="w-8 h-8 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      </div>
      <h2 class="text-2xl font-thin mb-4 text-white/90">Zero-Knowledge Security</h2>
      <p class="text-white/40 font-light text-sm leading-relaxed max-w-xs">
        Your passwords are encrypted locally on your device. We never see or store your data.
      </p>
    </div>
  );

  const MobileStep3 = () => (
    <div class="flex flex-col items-center justify-center h-full px-8 text-center">
      <div class="w-16 h-16 border border-white/10 flex items-center justify-center mb-12">
        <svg class="w-8 h-8 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" />
        </svg>
      </div>
      <h2 class="text-2xl font-thin mb-4 text-white/90">Biometric Authentication</h2>
      <p class="text-white/40 font-light text-sm leading-relaxed max-w-xs">
        Use Face ID or Touch ID to quickly and securely access your vault.
      </p>
    </div>
  );

  const MobileStep4 = () => (
    <div class="flex flex-col items-center justify-center h-full px-8 text-center">
      <div class="w-16 h-16 border border-white/10 flex items-center justify-center mb-12">
        <svg class="w-8 h-8 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      </div>
      <h2 class="text-2xl font-thin mb-4 text-white/90">Key Features</h2>
      <div class="text-left max-w-xs mx-auto space-y-3">
        <div class="flex items-start gap-3">
          <span class="text-white/20 text-xs mt-0.5">●</span>
          <p class="text-white/40 font-light text-sm">Generate strong passwords instantly</p>
        </div>
        <div class="flex items-start gap-3">
          <span class="text-white/20 text-xs mt-0.5">●</span>
          <p class="text-white/40 font-light text-sm">Search and organize your credentials</p>
        </div>
        <div class="flex items-start gap-3">
          <span class="text-white/20 text-xs mt-0.5">●</span>
          <p class="text-white/40 font-light text-sm">Works offline, syncs when ready</p>
        </div>
      </div>
    </div>
  );

  const MobileStep5 = () => (
    <div class="flex flex-col items-center justify-center h-full px-8 text-center">
      <div class="w-16 h-16 border border-white/10 flex items-center justify-center mb-12">
        <svg class="w-8 h-8 text-green-500/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 class="text-2xl font-thin mb-4 text-white/90">You're All Set!</h2>
      <p class="text-white/40 font-light text-sm leading-relaxed max-w-xs mb-8">
        Let's set up your first password and secure your digital life.
      </p>
    </div>
  );

  // Tablet Steps (4 steps - combines some mobile steps)
  const TabletStep1 = () => MobileStep1();
  
  const TabletStep2 = () => (
    <div class="flex flex-col items-center justify-center h-full px-12 text-center">
      <div class="grid grid-cols-2 gap-8 max-w-2xl">
        <div class="flex flex-col items-center">
          <div class="w-16 h-16 border border-white/10 flex items-center justify-center mb-6">
            <svg class="w-8 h-8 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h3 class="text-lg font-thin mb-2 text-white/90">Zero-Knowledge</h3>
          <p class="text-white/40 font-light text-xs leading-relaxed">
            Encrypted locally, never leaves your device
          </p>
        </div>
        <div class="flex flex-col items-center">
          <div class="w-16 h-16 border border-white/10 flex items-center justify-center mb-6">
            <svg class="w-8 h-8 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" />
            </svg>
          </div>
          <h3 class="text-lg font-thin mb-2 text-white/90">Biometric Auth</h3>
          <p class="text-white/40 font-light text-xs leading-relaxed">
            Face ID or Touch ID for instant access
          </p>
        </div>
      </div>
    </div>
  );

  const TabletStep3 = () => MobileStep4();
  const TabletStep4 = () => MobileStep5();

  // Desktop Steps (3 steps - more consolidated)
  const DesktopStep1 = () => (
    <div class="flex flex-col items-center justify-center h-full px-16 text-center">
      <div class="w-20 h-20 border border-white/20 flex items-center justify-center mb-12">
        <span class="text-4xl font-thin text-white/80">V</span>
      </div>
      <h1 class="text-5xl font-thin mb-6 text-white/90">Welcome to VuVault</h1>
      <p class="text-white/40 font-light text-lg leading-relaxed max-w-md mb-12">
        Your Ultra-Secure, Zero-Knowledge Password Manager With Advanced Cryptographic Protection
      </p>
      <div class="grid grid-cols-3 gap-8 max-w-3xl">
        <div class="text-center">
          <div class="w-12 h-12 border border-white/10 flex items-center justify-center mx-auto mb-4">
            <svg class="w-6 h-6 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h3 class="text-sm font-light text-white/60 mb-1">ENCRYPTED</h3>
          <p class="text-xs text-white/30">ChaCha20-Poly1305</p>
        </div>
        <div class="text-center">
          <div class="w-12 h-12 border border-white/10 flex items-center justify-center mx-auto mb-4">
            <svg class="w-6 h-6 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" />
            </svg>
          </div>
          <h3 class="text-sm font-light text-white/60 mb-1">BIOMETRIC</h3>
          <p class="text-xs text-white/30">WebAuthn Support</p>
        </div>
        <div class="text-center">
          <div class="w-12 h-12 border border-white/10 flex items-center justify-center mx-auto mb-4">
            <svg class="w-6 h-6 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h3 class="text-sm font-light text-white/60 mb-1">OFFLINE</h3>
          <p class="text-xs text-white/30">Works Everywhere</p>
        </div>
      </div>
    </div>
  );

  const DesktopStep2 = () => (
    <div class="flex flex-col items-center justify-center h-full px-16 text-center">
      <h2 class="text-3xl font-thin mb-12 text-white/90">How VuVault Works</h2>
      <div class="grid grid-cols-4 gap-6 max-w-4xl">
        <div class="text-left">
          <div class="text-2xl font-thin text-white/20 mb-3">01</div>
          <h3 class="text-sm font-light text-white/80 mb-2">CREATE VAULT</h3>
          <p class="text-xs text-white/40 leading-relaxed">
            Set up your secure vault with biometric authentication
          </p>
        </div>
        <div class="text-left">
          <div class="text-2xl font-thin text-white/20 mb-3">02</div>
          <h3 class="text-sm font-light text-white/80 mb-2">ADD PASSWORDS</h3>
          <p class="text-xs text-white/40 leading-relaxed">
            Store credentials with automatic encryption
          </p>
        </div>
        <div class="text-left">
          <div class="text-2xl font-thin text-white/20 mb-3">03</div>
          <h3 class="text-sm font-light text-white/80 mb-2">QUICK ACCESS</h3>
          <p class="text-xs text-white/40 leading-relaxed">
            Search and copy passwords instantly
          </p>
        </div>
        <div class="text-left">
          <div class="text-2xl font-thin text-white/20 mb-3">04</div>
          <h3 class="text-sm font-light text-white/80 mb-2">STAY SECURE</h3>
          <p class="text-xs text-white/40 leading-relaxed">
            Auto-lock and zero-knowledge protection
          </p>
        </div>
      </div>
    </div>
  );

  const DesktopStep3 = () => (
    <div class="flex flex-col items-center justify-center h-full px-16 text-center">
      <div class="w-20 h-20 border border-white/10 flex items-center justify-center mb-12">
        <svg class="w-10 h-10 text-green-500/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 class="text-4xl font-thin mb-6 text-white/90">Ready to Begin</h2>
      <p class="text-white/40 font-light text-lg leading-relaxed max-w-md">
        Your vault is ready. Let's create your account and start securing your passwords.
      </p>
    </div>
  );

  // Step content renderer
  const renderStepContent = () => {
    if (isMobile()) {
      switch (currentStep()) {
        case 1: return <MobileStep1 />;
        case 2: return <MobileStep2 />;
        case 3: return <MobileStep3 />;
        case 4: return <MobileStep4 />;
        case 5: return <MobileStep5 />;
      }
    } else if (isTablet()) {
      switch (currentStep()) {
        case 1: return <TabletStep1 />;
        case 2: return <TabletStep2 />;
        case 3: return <TabletStep3 />;
        case 4: return <TabletStep4 />;
      }
    } else {
      switch (currentStep()) {
        case 1: return <DesktopStep1 />;
        case 2: return <DesktopStep2 />;
        case 3: return <DesktopStep3 />;
      }
    }
  };

  return (
    <div class="fixed inset-0 bg-black z-[100] flex flex-col">
      {/* Skip button */}
      <button
        onClick={skipOnboarding}
        class="absolute top-8 right-8 text-white/30 hover:text-white/50 text-xs font-light tracking-wider transition-all duration-300 z-10"
      >
        SKIP
      </button>

      {/* Progress indicators */}
      <div class="absolute top-8 left-1/2 transform -translate-x-1/2 flex gap-2 z-10">
        {Array.from({ length: totalSteps() }, (_, i) => (
          <div
            class={`h-0.5 transition-all duration-300 ${
              i < currentStep() ? 'w-8 bg-white/40' : 'w-8 bg-white/10'
            }`}
          />
        ))}
      </div>

      {/* Content */}
      <div class={`flex-1 transition-opacity duration-200 ${isAnimating() ? 'opacity-0' : 'opacity-100'}`}>
        {renderStepContent()}
      </div>

      {/* Navigation */}
      <div class="h-20 px-8 pb-8 flex items-center justify-between">
        <button
          onClick={prevStep}
          class={`text-white/30 hover:text-white/50 transition-all duration-300 ${
            currentStep() === 1 ? 'invisible' : ''
          }`}
        >
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <button
          onClick={nextStep}
          class="px-8 py-3 border border-white/20 text-white/80 hover:border-white/40 hover:bg-white/5 font-light text-xs tracking-wider transition-all duration-300"
        >
          {currentStep() === totalSteps() ? 'GET STARTED' : 'CONTINUE'}
        </button>

        <div class="w-6" /> {/* Spacer for centering */}
      </div>
    </div>
  );
};

export default OnboardingFlow;
