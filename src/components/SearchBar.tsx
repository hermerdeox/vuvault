import { Component } from 'solid-js';
import { useTheme } from '../context/ThemeContext';

interface Props {
  value: string;
  onInput: (value: string) => void;
  placeholder?: string;
}

const SearchBar: Component<Props> = (props) => {
  const { isDark } = useTheme();
  
  return (
    <div class="relative flex-1">
      <input
        type="search"
        style={{
          width: '100%',
          height: '3rem',
          paddingLeft: '3rem',
          paddingRight: '1rem',
          background: 'transparent',
          border: '1px solid var(--border-secondary)',
          color: 'var(--text-primary)',
          fontWeight: 'var(--font-light)',
          fontSize: '1rem',
          transition: 'all 0.3s ease'
        }}
        placeholder={props.placeholder || 'Search...'}
        value={props.value}
        onInput={(e) => props.onInput(e.currentTarget.value)}
        onFocus={(e) => e.currentTarget.style.borderColor = 'var(--border-primary)'}
        onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-secondary)'}
      />
      <svg 
        style={{
          position: 'absolute',
          left: '1rem',
          top: '50%',
          transform: 'translateY(-50%)',
          width: '1rem',
          height: '1rem',
          color: 'var(--text-muted)'
        }}
        fill="none" 
        stroke="currentColor" 
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    </div>
  );
};

export default SearchBar;
