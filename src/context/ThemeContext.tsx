import { createContext, useContext, ParentComponent, createSignal, onMount } from 'solid-js';

type Theme = 'dark' | 'light';

interface ThemeContextType {
  theme: () => Theme;
  toggleTheme: () => void;
  isDark: () => boolean;
}

const ThemeContext = createContext<ThemeContextType>();

export const ThemeProvider: ParentComponent = (props) => {
  // Default theme is dark
  const [theme, setTheme] = createSignal<Theme>('dark');
  
  // Check for saved theme preference on mount
  onMount(() => {
    const savedTheme = localStorage.getItem('vuvault_theme');
    if (savedTheme === 'light') {
      setTheme('light');
      document.documentElement.classList.add('light-theme');
    } else {
      // Ensure dark theme is explicitly set
      setTheme('dark');
      document.documentElement.classList.remove('light-theme');
    }
    
    // Force a repaint to ensure theme is applied
    document.body.style.display = 'none';
    setTimeout(() => {
      document.body.style.display = '';
    }, 0);
  });
  
  const toggleTheme = () => {
    const newTheme = theme() === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    
    // Save theme preference
    localStorage.setItem('vuvault_theme', newTheme);
    
    // Update document class for CSS selectors
    if (newTheme === 'light') {
      document.documentElement.classList.add('light-theme');
    } else {
      document.documentElement.classList.remove('light-theme');
    }
  };
  
  const isDark = () => theme() === 'dark';
  
  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, isDark }}>
      {props.children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
};
