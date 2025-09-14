import { Component } from 'solid-js';

interface Props {
  value: string;
  onInput: (value: string) => void;
  placeholder?: string;
}

const SearchBar: Component<Props> = (props) => {
  return (
    <div class="relative flex-1">
      <input
        type="search"
        class="w-full h-12 pl-12 pr-4 bg-transparent border border-white/10 text-white/90 placeholder-white/30 font-light text-base focus:outline-none focus:border-white/30 transition-all duration-300"
        placeholder={props.placeholder || 'Search...'}
        value={props.value}
        onInput={(e) => props.onInput(e.currentTarget.value)}
      />
      <svg 
        class="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" 
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
