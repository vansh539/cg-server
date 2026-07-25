import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

interface AuthState {
  token: string | null;
  companyId: string | null;
  companyName: string | null;
  ready: boolean;
  setAuth: (token: string, companyId: string, companyName: string) => Promise<void>;
  clearAuth: () => Promise<void>;
  loadFromStorage: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  companyId: null,
  companyName: null,
  ready: false,
  setAuth: async (token, companyId, companyName) => {
    await SecureStore.setItemAsync('token', token);
    await SecureStore.setItemAsync('companyId', companyId);
    await SecureStore.setItemAsync('companyName', companyName);
    set({ token, companyId, companyName });
  },
  clearAuth: async () => {
    await SecureStore.deleteItemAsync('token');
    await SecureStore.deleteItemAsync('companyId');
    await SecureStore.deleteItemAsync('companyName');
    set({ token: null, companyId: null, companyName: null });
  },
  loadFromStorage: async () => {
    const token = await SecureStore.getItemAsync('token');
    const companyId = await SecureStore.getItemAsync('companyId');
    const companyName = await SecureStore.getItemAsync('companyName');
    set({ token: token || null, companyId: companyId || null, companyName: companyName || null, ready: true });
  },
}));
