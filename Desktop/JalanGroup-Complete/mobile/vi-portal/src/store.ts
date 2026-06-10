import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

interface ClientAuthState {
  token: string | null;
  partyName: string | null;
  companyName: string | null;
  setAuth: (token: string, partyName: string, companyName: string) => Promise<void>;
  clearAuth: () => Promise<void>;
  loadFromStorage: () => Promise<void>;
}

export const useClientStore = create<ClientAuthState>((set) => ({
  token: null,
  partyName: null,
  companyName: null,
  setAuth: async (token, partyName, companyName) => {
    await SecureStore.setItemAsync('portal_token', token);
    await SecureStore.setItemAsync('portal_party', partyName);
    await SecureStore.setItemAsync('portal_company', companyName);
    set({ token, partyName, companyName });
  },
  clearAuth: async () => {
    await SecureStore.deleteItemAsync('portal_token');
    await SecureStore.deleteItemAsync('portal_party');
    await SecureStore.deleteItemAsync('portal_company');
    set({ token: null, partyName: null, companyName: null });
  },
  loadFromStorage: async () => {
    const token = await SecureStore.getItemAsync('portal_token');
    const partyName = await SecureStore.getItemAsync('portal_party');
    const companyName = await SecureStore.getItemAsync('portal_company');
    if (token) set({ token, partyName: partyName || '', companyName: companyName || '' });
  },
}));
