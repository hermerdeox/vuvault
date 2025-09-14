import { Component, Show } from 'solid-js';

interface LoadingSpinnerProps {
  show: boolean;
  message?: string;
}

const LoadingSpinner: Component<LoadingSpinnerProps> = (props) => {
  return (
    <Show when={props.show}>
      <div class="fixed inset-0 bg-black/80 backdrop-blur-sm z-[9999] flex items-center justify-center">
        <div class="flex flex-col items-center gap-4">
          {/* Spinner */}
          <div class="w-12 h-12 border-2 border-white/20 border-t-white/80 rounded-full animate-spin"></div>
          
          {/* Message */}
          <Show when={props.message}>
            <p class="text-white/60 text-sm font-light tracking-wider">
              {props.message}
            </p>
          </Show>
        </div>
      </div>
    </Show>
  );
};

export default LoadingSpinner;

// Loading state controller
export class LoadingController {
  private static instance: LoadingController;
  private loadingCount = 0;
  private minDisplayTime = 200; // Minimum display time in ms
  private showTimer: number | null = null;
  private callbacks: ((show: boolean) => void)[] = [];

  private constructor() {}

  static getInstance(): LoadingController {
    if (!LoadingController.instance) {
      LoadingController.instance = new LoadingController();
    }
    return LoadingController.instance;
  }

  show(callback?: (show: boolean) => void) {
    if (callback) {
      this.callbacks.push(callback);
    }
    
    this.loadingCount++;
    
    if (this.loadingCount === 1) {
      // First show request
      this.showTimer = Date.now();
      this.notifyCallbacks(true);
      
      // Disable all buttons
      document.querySelectorAll('button').forEach(btn => {
        (btn as HTMLButtonElement).disabled = true;
      });
    }
  }

  hide() {
    this.loadingCount = Math.max(0, this.loadingCount - 1);
    
    if (this.loadingCount === 0 && this.showTimer !== null) {
      // Calculate how long spinner has been shown
      const elapsed = Date.now() - this.showTimer;
      const remaining = Math.max(0, this.minDisplayTime - elapsed);
      
      // Hide after minimum display time
      setTimeout(() => {
        this.notifyCallbacks(false);
        this.showTimer = null;
        
        // Re-enable all buttons
        document.querySelectorAll('button').forEach(btn => {
          (btn as HTMLButtonElement).disabled = false;
        });
      }, remaining);
    }
  }

  private notifyCallbacks(show: boolean) {
    this.callbacks.forEach(callback => callback(show));
  }

  subscribe(callback: (show: boolean) => void) {
    this.callbacks.push(callback);
    return () => {
      this.callbacks = this.callbacks.filter(cb => cb !== callback);
    };
  }

  // Utility method to wrap async operations
  async withLoading<T>(
    operation: () => Promise<T>,
    message?: string
  ): Promise<T> {
    this.show();
    try {
      return await operation();
    } finally {
      this.hide();
    }
  }
}
