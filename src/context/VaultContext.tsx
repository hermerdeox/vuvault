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
      // Ensure master key exists
      const { getMasterKey, setMasterKey } = await import('../lib/db/database');
      let masterKey = await getMasterKey();
      
      if (!masterKey) {
        console.log('No master key found, creating one...');
        // Generate a secure master key
        const randomKey = window.crypto.getRandomValues(new Uint8Array(32))
          .reduce((acc, byte) => acc + byte.toString(16).padStart(2, '0'), '');
        await setMasterKey(randomKey);
        masterKey = randomKey;
        console.log('Master key created successfully');
      }
      
      // Remove fields that database will auto-generate
      const { id, createdAt, updatedAt, password, ...itemData } = item;
      
      // If password is provided, put it in encryptedPassword for the database hook to encrypt
      if (password) {
        itemData.encryptedPassword = password;
      }
      
      const newId = await db.addVaultItem(itemData);
      
      // Refresh vault to get the properly encrypted item from database
      await refreshVault();
      
      return newId;
    } catch (error) {
      console.error('Failed to add vault item:', error);
      throw error;
    }
  };

  // Update existing vault item
  const updateVaultItem = async (item: VaultItem) => {
    try {
      if (!item.id) throw new Error('Item ID is required for update');
      
      // Ensure master key exists
      const { getMasterKey, setMasterKey } = await import('../lib/db/database');
      let masterKey = await getMasterKey();
      
      if (!masterKey) {
        console.log('No master key found, creating one...');
        // Generate a secure master key
        const randomKey = window.crypto.getRandomValues(new Uint8Array(32))
          .reduce((acc, byte) => acc + byte.toString(16).padStart(2, '0'), '');
        await setMasterKey(randomKey);
        masterKey = randomKey;
        console.log('Master key created successfully');
      }
      
      const { id, password, ...updates } = item;
      
      // If password is provided, put it in encryptedPassword for the database hook to encrypt
      if (password) {
        updates.encryptedPassword = password;
      }
      
      await db.updateVaultItem(id, updates);
      
      // Refresh vault to get the updated item from database
      await refreshVault();
    } catch (error) {
      console.error('Failed to update vault item:', error);
      throw error;
    }
  };

  // Delete vault item
  const deleteVaultItem = async (id: string) => {
    try {
      await db.deleteVaultItem(id);
      
      // Refresh vault to update the list
      await refreshVault();
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