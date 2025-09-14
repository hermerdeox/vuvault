import { createContext, useContext, ParentComponent, createSignal, createMemo } from 'solid-js';
import { VaultItem, DatabaseService } from '../lib/db/database';

interface VaultContextType {
  // Vault items
  vaultItems: () => VaultItem[];
  addVaultItem: (item: VaultItem) => Promise<void>;
  updateVaultItem: (item: VaultItem) => Promise<void>;
  deleteVaultItem: (id: string) => Promise<void>;
  refreshVault: () => Promise<void>;
  
  // Search
  searchQuery: () => string;
  setSearchQuery: (query: string) => void;
  filteredItems: () => VaultItem[];
  
  // Selected vault (for viewing/editing)
  selectedVault: () => VaultItem | null;
  setSelectedVault: (vault: VaultItem | null) => void;
  
  // Lock state
  isLocked: () => boolean;
  setIsLocked: (locked: boolean) => void;
}

const VaultContext = createContext<VaultContextType>();

export const VaultProvider: ParentComponent = (props) => {
  const [vaultItems, setVaultItems] = createSignal<VaultItem[]>([]);
  const [searchQuery, setSearchQuery] = createSignal('');
  const [selectedVault, setSelectedVault] = createSignal<VaultItem | null>(null);
  const [isLocked, setIsLocked] = createSignal(false);
  
  const db = DatabaseService.getInstance();

  // Filtered items based on search query
  const filteredItems = createMemo(() => {
    const query = searchQuery().toLowerCase();
    if (!query) return vaultItems();
    
    return vaultItems().filter(item => 
      item.service.toLowerCase().includes(query) ||
      item.username.toLowerCase().includes(query) ||
      (item.url && item.url.toLowerCase().includes(query)) ||
      (item.notes && item.notes.toLowerCase().includes(query)) ||
      (item.tags && item.tags.some(tag => tag.toLowerCase().includes(query)))
    );
  });

  // Refresh vault items from database
  const refreshVault = async () => {
    try {
      const items = await db.getAllVaultItems();
      setVaultItems(items);
    } catch (error) {
      console.error('Failed to refresh vault:', error);
    }
  };

  // Add new vault item
  const addVaultItem = async (item: VaultItem) => {
    try {
      const id = await db.addVaultItem(item);
      const newItem = { ...item, id };
      setVaultItems([...vaultItems(), newItem]);
    } catch (error) {
      console.error('Failed to add vault item:', error);
      throw error;
    }
  };

  // Update existing vault item
  const updateVaultItem = async (item: VaultItem) => {
    try {
      await db.updateVaultItem(item);
      setVaultItems(vaultItems().map(v => v.id === item.id ? item : v));
    } catch (error) {
      console.error('Failed to update vault item:', error);
      throw error;
    }
  };

  // Delete vault item
  const deleteVaultItem = async (id: string) => {
    try {
      await db.deleteVaultItem(id);
      setVaultItems(vaultItems().filter(v => v.id !== id));
    } catch (error) {
      console.error('Failed to delete vault item:', error);
      throw error;
    }
  };

  return (
    <VaultContext.Provider value={{
      vaultItems,
      addVaultItem,
      updateVaultItem,
      deleteVaultItem,
      refreshVault,
      searchQuery,
      setSearchQuery,
      filteredItems,
      selectedVault,
      setSelectedVault,
      isLocked,
      setIsLocked
    }}>
      {props.children}
    </VaultContext.Provider>
  );
};

export const useVault = () => {
  const context = useContext(VaultContext);
  if (!context) {
    throw new Error('useVault must be used within VaultProvider');
  }
  return context;
};