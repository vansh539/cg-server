import axios from 'axios';
import { useClientStore } from './store';

export const BASE = 'https://api.vanshiron.com';

export const api = axios.create({ baseURL: BASE, timeout: 10000 });

api.interceptors.request.use((config) => {
  const token = useClientStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const clientLogin = (mobile: string, password: string) =>
  api.post('/portal/login', { mobile, password, company_code: 'VI' }).then(r => r.data);

export const getAccount = () =>
  api.get('/portal/account').then(r => r.data);

export const getLedger = (params: { page?: number; from?: string; to?: string }) =>
  api.get('/portal/ledger', { params }).then(r => r.data);

export const getProducts = () =>
  api.get('/portal/products').then(r => r.data);

export const getOrders = () =>
  api.get('/portal/orders').then(r => r.data);

export const placeOrder = (body: object) =>
  api.post('/portal/orders', body).then(r => r.data);

export const sendPaymentNotification = (body: object) =>
  api.post('/portal/payment-notification', body).then(r => r.data);
