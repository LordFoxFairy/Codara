import {createContext, useContext, useSyncExternalStore} from 'react';
import type {Store} from './create-store';
import type {AppState} from './app-state';

export const AppStoreContext = createContext<Store<AppState> | null>(null);

export function useAppState<T>(selector: (state: AppState) => T): T {
  const store = useContext(AppStoreContext);
  if (!store) throw new Error('useAppState must be used within AppStoreContext.Provider');
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
  );
}

export function useAppStore(): Store<AppState> {
  const store = useContext(AppStoreContext);
  if (!store) throw new Error('useAppStore must be used within AppStoreContext.Provider');
  return store;
}
