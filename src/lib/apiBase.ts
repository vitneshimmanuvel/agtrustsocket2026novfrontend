// Centralized API base URL for all fetch calls.
// On the web (Vercel/Dev), we use relative URLs or VITE_API_URL.
// On Capacitor (APK), we use full production URL.

import { Capacitor } from '@capacitor/core';

const PRODUCTION_API_URL = 'https://agtrustregistor.vercel.app';

/**
 * Returns the base URL prefix for all API calls.
 * - Native Mobile (APK): 'https://agtrustregistor.vercel.app'
 * - Custom Env: import.meta.env.VITE_API_URL
 * - Web Browser: '' (relative /api URLs proxied to backend server on port 5000)
 */
export function getApiBase(): string {
  if (Capacitor.isNativePlatform()) {
    return PRODUCTION_API_URL;
  }
  return (import.meta.env.VITE_API_URL as string) || '';
}

/**
 * Helper to build full API URL from a relative path like '/api/auth/login'
 */
export function apiUrl(path: string): string {
  const base = getApiBase();
  if (base && path.startsWith('/')) {
    return `${base}${path}`;
  }
  return path;
}
