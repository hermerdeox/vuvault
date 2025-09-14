import { Component, createSignal, For, Show, onMount } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { useVault } from '../context/VaultContext';
import VaultItemCard from '../components/VaultItemCard';
import AddPasswordModal from '../components/AddPasswordModal';
import SearchBar from '../components/SearchBar';
import OnboardingFlow from '../components/OnboardingFlow';
import { AuthService } from '../lib/auth/auth-service';

const Vault: Component = () => {
  const navigate = useNavigate();
  const { vaultItems, searchQuery, setSearchQuery, filteredItems, refreshVault } = useVault();
  const [showAddModal, setShowAddModal] = createSignal(false);
  const [selectedCategory, setSelectedCategory] = createSignal('all');
  const [showOnboarding, setShowOnboarding] = createSignal(false);

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
    <>
      {/* Onboarding Modal */}
      <Show when={showOnboarding()}>
        <OnboardingFlow onComplete={() => setShowOnboarding(false)} />
      </Show>

      <div class="min-h-screen bg-black text-white">
      {/* Header - Following Design System with safe area insets for notch */}
      <header class="fixed top-0 left-0 right-0 z-50 bg-black pt-safe">
        <div class="h-16 max-w-7xl mx-auto px-8 flex items-center justify-between">
          <div class="flex items-center">
            <div class="w-8 h-8 border border-white/20 flex items-center justify-center">
              <span class="text-white/80 font-light text-sm">V</span>
            </div>
            <span class="ml-3 text-white/80 font-light text-sm tracking-wider">VUVAULT</span>
          </div>
            
          <div class="flex items-center gap-6">
            <button
              onClick={() => setShowOnboarding(true)}
              class="text-white/40 hover:text-white/60 transition-colors duration-300"
              title="View Tutorial"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
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
      </header>

      <main class="pt-28 pb-8 px-6 md:px-8 max-w-7xl mx-auto">
        {/* Search and Add - Design System Spacing */}
        <div class="flex items-center gap-4 mb-12">
          <div class="flex-1 max-w-md">
            <SearchBar 
              value={searchQuery()} 
              onInput={(value) => setSearchQuery(value)}
              placeholder="Search vault..."
            />
          </div>
          
          <button
            onClick={() => setShowAddModal(true)}
            class="w-12 h-12 border border-white/20 hover:border-white/40 flex items-center justify-center transition-all duration-300"
          >
            <svg class="w-5 h-5 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>

        {/* Category Filters - Design System Typography */}
        <div class="flex gap-8 mb-12 border-b border-white/5">
          <For each={categories}>
            {(category) => (
              <button
                onClick={() => setSelectedCategory(category.id)}
                class={`pb-4 text-xs font-light tracking-widest transition-all duration-300 ${
                  selectedCategory() === category.id
                    ? 'text-white/80 border-b-2 border-white/40'
                    : 'text-white/30 hover:text-white/60'
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
              <div class="w-20 h-20 border border-white/10 flex items-center justify-center mx-auto mb-12">
                <svg class="w-8 h-8 text-white/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <p class="text-white/60 font-light text-lg mb-2">
                {searchQuery() ? 'No matching items found' : 'Your vault is empty'}
              </p>
              <p class="text-white/30 text-sm font-light">
                {searchQuery() ? 'Try a different search term' : 'Add your first password to get started'}
              </p>
            </div>
          }
        >
          <div class="space-y-px bg-white/5">
            <For each={getCategoryFilteredItems()}>
              {(item) => (
                <div class="bg-black p-6 hover:bg-white/[0.02] transition-all duration-300">
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
    </>
  );
};

export default Vault;