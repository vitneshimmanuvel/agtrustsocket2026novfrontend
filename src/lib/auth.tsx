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
 * Session-based auth: uses sessionStorage so closing the tab/browser logs the user out.
 * Also stores in localStorage for tab-duplication support, but clears on beforeunload.
 */
function loadSession(): { token: string | null; user: User | null } {
  // Scoped to sessionStorage only to prevent cross-tab session leakage and collisions
  const savedToken = sessionStorage.getItem(TOKEN_KEY);
  const savedUser = sessionStorage.getItem(USER_KEY);

  if (savedToken && savedUser) {
    try {
      const parsed = JSON.parse(savedUser);
      if (parsed && (parsed.email || parsed.name)) {
        return { token: savedToken, user: parsed };
      }
    } catch {
      // corrupted
    }
  }

  // Clean up sessionStorage only
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
  return { token: null, user: null };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session] = useState(loadSession);
  const [token, setToken] = useState<string | null>(session.token);
  const [user, setUser] = useState<User | null>(session.user);
  const [isLoading, setIsLoading] = useState(!!session.token);

  const login = useCallback((newToken: string, newUser: User) => {
    // Store in sessionStorage only
    sessionStorage.setItem(TOKEN_KEY, newToken);
    sessionStorage.setItem(USER_KEY, JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
    resetRealtimeAuth().catch(() => {});
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
    resetRealtimeAuth().catch(() => {});
  }, []);

  // Validate session with Firebase and subscribe to updates (permissions, status)
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
        // Sync to sessionStorage only
        sessionStorage.setItem(USER_KEY, JSON.stringify(serverUser));
        setUser(serverUser as User);
        setIsLoading(false);
      }
    }, (err) => {
      console.error('User subscription error:', err);
      logout();
      setIsLoading(false);
    });

    return () => { unsubscribe(); };
  }, [token, logout]);

  const updateUser = useCallback((partialUser: Partial<User>) => {
    setUser(prev => {
      if (!prev) return null;
      const updated = { ...prev, ...partialUser };
      sessionStorage.setItem(USER_KEY, JSON.stringify(updated));
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
