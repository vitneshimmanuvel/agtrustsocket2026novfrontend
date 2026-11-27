import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import { flushAllPendingWrites, type User } from './api';
import { firebaseGetMe, ensureDefaultAdmin, subscribeToMe } from './firebaseAuth';
import { resetRealtimeAuth } from './realtime';

const TOKEN_KEY = 'recordbook_token';
const USER_KEY = 'recordbook_user';
const LAST_ACTIVITY_KEY = 'recordbook_last_activity';
export const IDLE_LOGOUT_MS = 7 * 60 * 1000; // 7 minutes of inactivity

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
 * Tab-scoped session auth:
 * Stores token/user strictly in sessionStorage so refreshing keeps you logged in
 * and closing the tab/browser/link clears the session automatically.
 * Any leftover localStorage auth keys are purged.
 */
function clearAuthStorage(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(LAST_ACTIVITY_KEY);
    sessionStorage.removeItem('admin_workspace_mode');
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {}
}

function loadSession(): { token: string | null; user: User | null } {
  let savedToken: string | null = null;
  let savedUser: string | null = null;
  let savedLastActivity: string | null = null;
  try {
    // Always purge any legacy persistent tokens so closing the link/tab logs out
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    savedToken = sessionStorage.getItem(TOKEN_KEY);
    savedUser = sessionStorage.getItem(USER_KEY);
    savedLastActivity = sessionStorage.getItem(LAST_ACTIVITY_KEY);
  } catch {
    return { token: null, user: null };
  }

  if (savedToken && savedUser) {
    if (savedLastActivity && Number.isFinite(Number(savedLastActivity))) {
      if (Date.now() - Number(savedLastActivity) >= IDLE_LOGOUT_MS) {
        clearAuthStorage();
        return { token: null, user: null };
      }
    }
    try {
      const parsed = JSON.parse(savedUser);
      if (parsed && (parsed.email || parsed.name)) {
        try {
          sessionStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
        } catch {}
        return { token: savedToken, user: parsed };
      }
    } catch {
      // corrupted
    }
  }

  clearAuthStorage();
  return { token: null, user: null };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session] = useState(loadSession);
  const [token, setToken] = useState<string | null>(session.token);
  const [user, setUser] = useState<User | null>(session.user);
  const [isLoading, setIsLoading] = useState(!!session.token);
  const lastActivityRef = useRef<number>(Date.now());
  const idleLoggingOutRef = useRef(false);

  const login = useCallback((newToken: string, newUser: User) => {
    const now = Date.now();
    lastActivityRef.current = now;
    idleLoggingOutRef.current = false;
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      sessionStorage.setItem(TOKEN_KEY, newToken);
      sessionStorage.setItem(USER_KEY, JSON.stringify(newUser));
      sessionStorage.setItem(LAST_ACTIVITY_KEY, String(now));
    } catch {}
    setToken(newToken);
    setUser(newUser);
    resetRealtimeAuth().catch(() => {});
  }, []);

  const logout = useCallback(() => {
    idleLoggingOutRef.current = false;
    clearAuthStorage();
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

  // 7-minute frontend inactivity auto-logout (even when a sheet stays open with no changes)
  useEffect(() => {
    if (!token) return;

    const initialNow = Date.now();
    lastActivityRef.current = initialNow;
    idleLoggingOutRef.current = false;
    try {
      sessionStorage.setItem(LAST_ACTIVITY_KEY, String(initialNow));
    } catch {}

    let lastMouseMark = 0;
    const markActivity = () => {
      if (idleLoggingOutRef.current) return;
      const now = Date.now();
      lastActivityRef.current = now;
      try {
        sessionStorage.setItem(LAST_ACTIVITY_KEY, String(now));
      } catch {}
    };

    const handleMouseMove = () => {
      const now = Date.now();
      if (now - lastMouseMark >= 5000) {
        lastMouseMark = now;
        markActivity();
      }
    };

    const triggerIdleLogout = async () => {
      if (idleLoggingOutRef.current) return;
      idleLoggingOutRef.current = true;
      try {
        const active = document.activeElement;
        if (active instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) {
          active.blur();
          await new Promise((r) => setTimeout(r, 240));
        }
        await Promise.race([
          flushAllPendingWrites().catch(() => {}),
          new Promise((r) => setTimeout(r, 500)),
        ]);
      } catch {
        // proceed with logout even if flush fails
      }
      logout();
      toast('Logged out after 7 minutes of inactivity.', { id: 'idle-logout', duration: 4500 });
    };

    const checkIdle = () => {
      if (idleLoggingOutRef.current) return;
      let latest = lastActivityRef.current;
      try {
        const stored = Number(sessionStorage.getItem(LAST_ACTIVITY_KEY) || '0');
        if (Number.isFinite(stored) && stored > latest) {
          latest = stored;
          lastActivityRef.current = stored;
        }
      } catch {}
      if (Date.now() - latest >= IDLE_LOGOUT_MS) {
        void triggerIdleLogout();
      }
    };

    const activityEvents: Array<keyof WindowEventMap> = [
      'pointerdown',
      'click',
      'keydown',
      'input',
      'change',
      'paste',
      'touchstart',
      'wheel',
    ];
    for (const ev of activityEvents) {
      window.addEventListener(ev, markActivity, { capture: true, passive: true });
    }
    window.addEventListener('mousemove', handleMouseMove, { capture: true, passive: true });

    const onVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        checkIdle();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityOrFocus);
    window.addEventListener('focus', checkIdle);

    const intervalId = window.setInterval(checkIdle, 5000);

    return () => {
      window.clearInterval(intervalId);
      for (const ev of activityEvents) {
        window.removeEventListener(ev, markActivity, { capture: true });
      }
      window.removeEventListener('mousemove', handleMouseMove, { capture: true });
      document.removeEventListener('visibilitychange', onVisibilityOrFocus);
      window.removeEventListener('focus', checkIdle);
    };
  }, [token, logout]);

  const updateUser = useCallback((partialUser: Partial<User>) => {
    setUser(prev => {
      if (!prev) return null;
      const updated = { ...prev, ...partialUser };
      try {
        const serialized = JSON.stringify(updated);
        sessionStorage.setItem(USER_KEY, serialized);
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
