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
        class="input-field pl-10"
        placeholder={props.placeholder || 'Search...'}
        value={props.value}
        onInput={(e) => props.onInput(e.currentTarget.value)}
      />
      <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
        🔍
      </span>
    </div>
  );
};

export default SearchBar;
