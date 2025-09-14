/* @refresh reload */
import { render } from 'solid-js/web';
import { Router, Route } from '@solidjs/router';
import { MetaProvider } from '@solidjs/meta';
import { lazy } from 'solid-js';
import { ThemeProvider } from './context/ThemeContext';
import '@unocss/reset/tailwind.css';
import 'virtual:uno.css';
import './styles/global.css';

// Lazy load pages
const Landing = lazy(() => import('./pages/Landing'));
const Login = lazy(() => import('./pages/Login'));
const Vault = lazy(() => import('./pages/Vault'));
const Settings = lazy(() => import('./pages/Settings'));

// Import the wrapper component
import AppWrapper from './AppWrapper';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element not found');
}

// Initialize service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      console.log('SW registered:', registration);
    } catch (error) {
      console.error('SW registration failed:', error);
    }
  });
}

render(() => (
  <ThemeProvider>
    <MetaProvider>
      <Router root={AppWrapper}>
        <Route path="/" component={Landing} />
        <Route path="/login" component={Login} />
        <Route path="/vault" component={Vault} />
        <Route path="/settings" component={Settings} />
      </Router>
    </MetaProvider>
  </ThemeProvider>
), root);
