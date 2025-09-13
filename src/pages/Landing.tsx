import { Component } from 'solid-js';
import { useNavigate } from '@solidjs/router';

const Landing: Component = () => {
  const navigate = useNavigate();

  return (
    <div class="min-h-screen bg-black text-white flex flex-col">
      {/* Minimal Navigation */}
      <header class="absolute top-0 left-0 right-0 z-50 p-8">
        <nav class="max-w-7xl mx-auto flex justify-between items-center">
          <div class="flex items-center space-x-3">
            <div class="w-8 h-8 border border-white/20 rounded flex items-center justify-center">
              <span class="text-white/80 font-light text-sm">V</span>
            </div>
            <span class="text-white/80 font-light tracking-wider text-sm">EOXVAULT</span>
          </div>
        </nav>
      </header>

      {/* Minimal Hero */}
      <main class="flex-1 flex items-center justify-center px-6">
        <div class="text-center max-w-4xl mx-auto">
          {/* Subtle lock icon */}
          <div class="mb-12 inline-block">
            <div class="w-20 h-20 border border-white/10 rounded-full flex items-center justify-center mx-auto">
              <svg class="w-8 h-8 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
          </div>

          <h1 class="text-6xl md:text-7xl font-thin mb-6 tracking-tight">
            Secure.<span class="text-white/40"> Simple.</span>
          </h1>
          
          <p class="text-white/60 text-lg font-light mb-12 max-w-md mx-auto leading-relaxed">
            Zero-knowledge password management with military-grade encryption.
          </p>

          <button
            onClick={() => navigate('/login')}
            class="group relative px-12 py-4 text-sm tracking-wider font-light border border-white/20 rounded-none hover:border-white/40 transition-all duration-500"
          >
            <span class="relative z-10">ENTER VAULT</span>
            <div class="absolute inset-0 bg-white/5 scale-x-0 group-hover:scale-x-100 transition-transform duration-500 origin-left"></div>
          </button>

          {/* Minimal feature indicators */}
          <div class="mt-24 flex justify-center space-x-12 text-xs text-white/30 font-light tracking-widest">
            <div class="flex items-center space-x-2">
              <div class="w-1 h-1 bg-white/30 rounded-full"></div>
              <span>CHACHA20</span>
            </div>
            <div class="flex items-center space-x-2">
              <div class="w-1 h-1 bg-white/30 rounded-full"></div>
              <span>WEBAUTHN</span>
            </div>
            <div class="flex items-center space-x-2">
              <div class="w-1 h-1 bg-white/30 rounded-full"></div>
              <span>OFFLINE-FIRST</span>
            </div>
          </div>
        </div>
      </main>

      {/* Minimal Footer */}
      <footer class="p-8">
        <div class="max-w-7xl mx-auto text-center">
          <p class="text-white/20 text-xs font-light tracking-wider">© 2024 EOXVAULT ZERO</p>
        </div>
      </footer>
    </div>
  );
};

export default Landing;