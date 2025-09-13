import { createContext, useContext, ParentComponent, createSignal } from 'solid-js';
import { VaultItem } from '../lib/db/database';

interface VaultContextType {
  selectedVault: () => VaultItem | null;
  setSelectedVault: (vault: VaultItem | null) => void;
  isLocked: () => boolean;
  setIsLocked: (locked: boolean) => void;
}

const VaultContext = createContext<VaultContextType>();

export const VaultProvider: ParentComponent = (props) => {
  const [selectedVault, setSelectedVault] = createSignal<VaultItem | null>(null);
  const [isLocked, setIsLocked] = createSignal(false);

  return (
    <VaultContext.Provider value={{
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
