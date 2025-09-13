import { Component, createSignal, For, Show, onMount } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { useVault } from '../context/VaultContext';
import VaultItemCard from '../components/VaultItemCard';
import AddPasswordModal from '../components/AddPasswordModal';
import SearchBar from '../components/SearchBar';
import { AuthService } from '../lib/auth/auth-service';

const Vault: Component = () => {
  const navigate = useNavigate();
  const { vaultItems, searchQuery, setSearchQuery, filteredItems, refreshVault } = useVault();
  const [showAddModal, setShowAddModal] = createSignal(false);
  const [selectedCategory, setSelectedCategory] = createSignal('all');

  onMount(() => {
    refreshVault();
  });

  const handleLogout = async () => {
    await AuthService.getInstance().logout();
    navigate('/', { replace: true });
  };

  const categories = [
    { id: 'all', name: 'All', icon: '📋' },
    { id: 'social', name: 'Social', icon: '👥' },
    { id: 'finance', name: 'Finance', icon: '💳' },
    { id: 'work', name: 'Work', icon: '💼' },
    { id: 'personal', name: 'Personal', icon: '🔒' },
  ];

  const getCategoryFilteredItems = () => {
    const items = filteredItems();
    if (selectedCategory() === 'all') return items;
    return items.filter(item => item.tags?.includes(selectedCategory()));
  };

  return (
    <div class="min-h-screen bg-black text-white">
      {/* Minimal Header */}
      <header class="border-b border-white/5 sticky top-0 bg-black/90 backdrop-blur-xl z-40">
        <div class="max-w-7xl mx-auto px-6 py-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center space-x-3">
              <div class="w-8 h-8 border border-white/20 rounded flex items-center justify-center">
                <span class="text-white/80 font-light text-sm">V</span>
              </div>
              <span class="text-white/80 font-light tracking-wider text-sm">VAULT</span>
            </div>
            
            <div class="flex items-center space-x-6">
              <button
                onClick={() => navigate('/settings')}
                class="text-white/40 hover:text-white/60 transition-colors duration-300"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
              <button
                onClick={handleLogout}
                class="text-white/40 hover:text-white/60 transition-colors duration-300"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main class="max-w-7xl mx-auto px-6 py-8">
        {/* Search and Add */}
        <div class="flex items-center justify-between mb-8">
          <div class="flex-1 max-w-md">
            <SearchBar 
              value={searchQuery()} 
              onInput={(value) => setSearchQuery(value)}
              placeholder="Search vault..."
              class="w-full px-4 py-2 bg-transparent border border-white/10 rounded-none text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-colors duration-300 font-light"
            />
          </div>
          
          <button
            onClick={() => setShowAddModal(true)}
            class="ml-4 p-2 border border-white/10 hover:border-white/30 transition-colors duration-300"
          >
            <svg class="w-5 h-5 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>

        {/* Category Filters */}
        <div class="flex space-x-6 mb-8 text-xs">
          <For each={categories}>
            {(category) => (
              <button
                onClick={() => setSelectedCategory(category.id)}
                class={`tracking-wider font-light transition-colors duration-300 ${
                  selectedCategory() === category.id
                    ? 'text-white border-b border-white/40 pb-1'
                    : 'text-white/40 hover:text-white/60'
                }`}
              >
                {category.name.toUpperCase()}
              </button>
            )}
          </For>
        </div>

        {/* Vault Items Grid */}
        <Show
          when={getCategoryFilteredItems().length > 0}
          fallback={
            <div class="text-center py-24">
              <div class="w-20 h-20 border border-white/10 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg class="w-8 h-8 text-white/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <p class="text-white/40 font-light">
                {searchQuery() ? 'No matching items found' : 'Your vault is empty'}
              </p>
              <p class="text-white/20 text-sm mt-2 font-light">
                {searchQuery() ? 'Try a different search term' : 'Add your first password to get started'}
              </p>
            </div>
          }
        >
          <div class="grid gap-px bg-white/5">
            <For each={getCategoryFilteredItems()}>
              {(item) => (
                <div class="bg-black p-6 hover:bg-white/[0.02] transition-colors duration-300">
                  <VaultItemCard item={item} />
                </div>
              )}
            </For>
          </div>
        </Show>
      </main>

      {/* Add Password Modal */}
      <Show when={showAddModal()}>
        <AddPasswordModal
          isOpen={showAddModal()}
          onClose={() => setShowAddModal(false)}
        />
      </Show>
    </div>
  );
};

export default Vault;