import axios from 'axios';
import { useAuthStore } from './store';

export const BASE = 'https://api.vanshiron.com';

export const api = axios.create({ baseURL: BASE, timeout: 10000 });

api.interceptors.request.use((config) => {
  const { token, companyId } = useAuthStore.getState();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (companyId) config.headers['x-company-id'] = companyId;
  return config;
});

export const adminLogin = (mobile: string, password: string) =>
  api.post('/api/auth/login', { mobile, password }).then(r => r.data);

export const getDashboard = () =>
  api.get('/api/dashboard').then(r => r.data);

export const getParties = () =>
  api.get('/api/parties').then(r => r.data);

export const getPartyLedger = (partyId: string, period = '90D') =>
  api.get(`/api/ledger/${partyId}`, { params: { period } }).then(r => r.data);

export const getOrders = () =>
  api.get('/api/orders').then(r => r.data);

export const updateOrderStatus = (id: string, status: string, meta?: object) =>
  api.put(`/api/orders/${id}/status`, { status, ...meta }).then(r => r.data);

export const getRates = () =>
  api.get('/api/rates').then(r => r.data);

export const updateRate = (id: string, price: number) =>
  api.put(`/api/rates/${id}`, { price }).then(r => r.data);

export const getBotStatus = () =>
  api.get('/api/bot/status').then(r => r.data);

export const restartBot = () =>
  api.post('/api/bot/restart').then(r => r.data);

export const getBotLogs = () =>
  api.get('/api/bot/logs').then(r => r.data);

export const getMessages = () =>
  api.get('/api/whatsapp/messages').then(r => r.data);

export const sendReminders = () =>
  api.post('/api/whatsapp/send-reminders').then(r => r.data);

export const updatePartyContact = (id: string, contact: { mobile?: string; whatsapp_number?: string; email?: string }) =>
  api.put(`/api/parties/${id}/contact`, contact).then(r => r.data);
