import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { User } from './api';
import { firebaseGetMe, ensureDefaultAdmin, subscribeToMe } from './firebaseAuth';
import { resetRealtimeAuth } from './realtime';

const TOKEN_KEY = 'recordbook_token';
const USER_KEY = 'recordbook_user';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  updateUser: (partialUser: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Persistent & cross-tab resilient session auth:
 * Keeps token/user synchronized in both sessionStorage and localStorage so
 * tab restores, fullscreen transitions, background mobile discards, or transient
 * API blips never cause unexpected automatic logouts. Explicit logout clears both.
 */
function loadSession(): { token: string | null; user: User | null } {
  let savedToken: string | null = null;
  let savedUser: string | null = null;
  try {
    savedToken = sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY);
    savedUser = sessionStorage.getItem(USER_KEY) || localStorage.getItem(USER_KEY);
  } catch {
    return { token: null, user: null };
  }

  if (savedToken && savedUser) {
    try {
      const parsed = JSON.parse(savedUser);
      if (parsed && (parsed.email || parsed.name)) {
        try {
          sessionStorage.setItem(TOKEN_KEY, savedToken);
          sessionStorage.setItem(USER_KEY, savedUser);
          localStorage.setItem(TOKEN_KEY, savedToken);
          localStorage.setItem(USER_KEY, savedUser);
        } catch {}
        return { token: savedToken, user: parsed };
      }
    } catch {
      // corrupted
    }
  }

  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {}
  return { token: null, user: null };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session] = useState(loadSession);
  const [token, setToken] = useState<string | null>(session.token);
  const [user, setUser] = useState<User | null>(session.user);
  const [isLoading, setIsLoading] = useState(!!session.token);

  const login = useCallback((newToken: string, newUser: User) => {
    try {
      sessionStorage.setItem(TOKEN_KEY, newToken);
      sessionStorage.setItem(USER_KEY, JSON.stringify(newUser));
      localStorage.setItem(TOKEN_KEY, newToken);
      localStorage.setItem(USER_KEY, JSON.stringify(newUser));
    } catch {}
    setToken(newToken);
    setUser(newUser);
    resetRealtimeAuth().catch(() => {});
  }, []);

  const logout = useCallback(() => {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(USER_KEY);
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch {}
    setToken(null);
    setUser(null);
    resetRealtimeAuth().catch(() => {});
  }, []);

  // Validate session with backend and subscribe to updates (permissions, status)
  useEffect(() => {
    ensureDefaultAdmin().catch(() => {});

    if (!token) {
      setIsLoading(false);
      return;
    }

    const unsubscribe = subscribeToMe(token, (serverUser) => {
      if (serverUser) {
        if (serverUser.status && serverUser.status !== 'active') {
          logout();
          return;
        }
        try {
          const serialized = JSON.stringify(serverUser);
          sessionStorage.setItem(USER_KEY, serialized);
          localStorage.setItem(USER_KEY, serialized);
        } catch {}
        setUser(serverUser as User);
        setIsLoading(false);
      }
    }, (err: any) => {
      // NEVER auto-logout on transient network/5xx server errors; only logout on explicit 401/403
      const isExplicitUnauthorized =
        err?.status === 401 ||
        err?.status === 403 ||
        err?.code === 'UNAUTHORIZED' ||
        err?.message === 'Unauthorized';
      if (isExplicitUnauthorized) {
        console.warn('Session expired or unauthorized, signing out:', err);
        logout();
      } else {
        console.warn('Transient session check error (keeping active login):', err?.message || err);
      }
      setIsLoading(false);
    });

    return () => { unsubscribe(); };
  }, [token, logout]);

  const updateUser = useCallback((partialUser: Partial<User>) => {
    setUser(prev => {
      if (!prev) return null;
      const updated = { ...prev, ...partialUser };
      try {
        const serialized = JSON.stringify(updated);
        sessionStorage.setItem(USER_KEY, serialized);
        localStorage.setItem(USER_KEY, serialized);
      } catch {}
      return updated;
    });
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}

export function hasElevatedSheetAccess(user: any): boolean {
  if (!user) return false;
  return Boolean(
    user.permissions?.isAdmin ||
    user.permissions?.fullSheetAccess ||
    user.role === 'superadmin' ||
    user.role === 'admin' ||
    user.role === 'sheet_admin'
  );
}

export function canUserAccessRegister(user: any, reg: { id: number | string; folderId?: number | string | null; folder_id?: number | string | null }): boolean {
  if (!user || hasElevatedSheetAccess(user)) return true;

  const perms = user.permissions;
  const allowedRegs = perms?.allowedRegisters;
  const allowedFolders = perms?.allowedFolders;
  const folderId = reg.folderId ?? reg.folder_id;

  if (Array.isArray(allowedRegs)) {
    if (allowedRegs.map(String).includes(String(reg.id))) return true;
    if (folderId && Array.isArray(allowedFolders) && allowedFolders.map(String).includes(String(folderId))) {
      return true;
    }
    return false;
  }

  if (Array.isArray(allowedFolders)) {
    return !!(folderId && allowedFolders.map(String).includes(String(folderId)));
  }

  return perms?.canView !== false;
}

export function canUserAccessFolder(user: any, folderId: number | string, hasAllowedChildReg = false): boolean {
  if (!user || hasElevatedSheetAccess(user) || hasAllowedChildReg) return true;

  const perms = user.permissions;
  const allowedFolders = perms?.allowedFolders;
  if (Array.isArray(allowedFolders)) {
    return allowedFolders.map(String).includes(String(folderId));
  }
  if (Array.isArray(perms?.allowedRegisters)) return false;
  return perms?.canView !== false;
}
