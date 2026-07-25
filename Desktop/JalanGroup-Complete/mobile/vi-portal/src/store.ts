import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

interface ClientAuthState {
  token: string | null;
  partyName: string | null;
  companyName: string | null;
  ready: boolean;
  setAuth: (token: string, partyName: string, companyName: string) => Promise<void>;
  clearAuth: () => Promise<void>;
  loadFromStorage: () => Promise<void>;
}

export const useClientStore = create<ClientAuthState>((set) => ({
  token: null,
  partyName: null,
  companyName: null,
  ready: false,
  setAuth: async (token, partyName, companyName) => {
    set({ token, partyName, companyName });
    await Promise.all([
      SecureStore.setItemAsync('portal_token', token),
      SecureStore.setItemAsync('portal_party', partyName),
      SecureStore.setItemAsync('portal_company', companyName),
    ]);
  },
  clearAuth: async () => {
    set({ token: null, partyName: null, companyName: null });
    await Promise.all([
      SecureStore.deleteItemAsync('portal_token'),
      SecureStore.deleteItemAsync('portal_party'),
      SecureStore.deleteItemAsync('portal_company'),
    ]);
  },
  loadFromStorage: async () => {
    const token = await SecureStore.getItemAsync('portal_token');
    const partyName = await SecureStore.getItemAsync('portal_party');
    const companyName = await SecureStore.getItemAsync('portal_company');
    set({ token: token || null, partyName: partyName || null, companyName: companyName || null, ready: true });
  },
}));
