import axios from 'axios';
import { supabase } from './supabase';
import { config as appConfig } from '../config/env';

export const api = axios.create({
  baseURL: appConfig.apiBaseUrl,
  // Hard cap so a hung backend can't keep the UI spinning forever.
  timeout: 60_000,
});

// Inject the Supabase access token on every request.
api.interceptors.request.use(async (cfg) => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) {
    cfg.headers = cfg.headers ?? {};
    cfg.headers.Authorization = `Bearer ${token}`;
  }
  return cfg;
});

// 401/423 → boot to /login. Supabase usually refreshes the token on its own,
// so a 401 from us means the session is genuinely dead (revoked, expired
// past refresh, or the user was deleted server-side). 423 is account locked.
api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const status = error?.response?.status;
    const path = error?.config?.url ?? '';
    // Ignore the auth endpoints themselves — their UI surfaces the error.
    const isAuthRoute = path.includes('/auth/');
    if (!isAuthRoute && (status === 401 || status === 423)) {
      try { await supabase.auth.signOut(); } catch { /* ignore */ }
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.replace('/login');
      }
    }
    return Promise.reject(error);
  },
);
