// API Service - LEGACY / UNUSED as of Phase 6
//
// This file predates the Spring Boot backend and targets endpoints
// (/accounts, /following) that were never implemented server-side.
// It is not imported anywhere in the app. The real backend integration
// lives in src/hooks/usePolymarket.ts, useFollowing.ts, and ProfileScreen.tsx,
// using src/config/api.ts (Spring Boot, port 8080) for /api/traders,
// /api/markets, /api/follows, and /api/push-tokens.
//
// Kept for reference only — safe to delete.

const BASE_URL = 'http://10.0.2.2:8080/api'; // Android emulator localhost
// const BASE_URL = 'http://localhost:8080/api'; // iOS simulator
// const BASE_URL = 'https://your-deployed-backend.com/api'; // Production

export const api = {
  // Get all accounts with their open positions
  getAccounts: async () => {
    const res = await fetch(`${BASE_URL}/accounts`);
    if (!res.ok) throw new Error('Failed to fetch accounts');
    return res.json();
  },

  // Get a single account by address
  getAccount: async (address: string) => {
    const res = await fetch(`${BASE_URL}/accounts/${address}`);
    if (!res.ok) throw new Error('Failed to fetch account');
    return res.json();
  },

  // Follow an account
  followAccount: async (address: string) => {
    const res = await fetch(`${BASE_URL}/following`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
    });
    if (!res.ok) throw new Error('Failed to follow account');
    return res.json();
  },

  // Unfollow an account
  unfollowAccount: async (address: string) => {
    const res = await fetch(`${BASE_URL}/following/${address}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to unfollow account');
  },

  // Get top accounts sorted by profit or volume
  getTopAccounts: async (sort: 'profit' | 'volume') => {
    const res = await fetch(`${BASE_URL}/accounts/top?sort=${sort}`);
    if (!res.ok) throw new Error('Failed to fetch top accounts');
    return res.json();
  },
};
