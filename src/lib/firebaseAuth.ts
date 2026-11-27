// Client-side authentication and admin endpoints communicating with /api/ backend
import { apiUrl } from './apiBase';
import { getSocket } from './api';
import { updateWorkspacePresence, getAblyOnlineUsers } from './realtime';

export interface AppUser {
  id: string;
  name: string;
  email: string;
  passwordHash?: string;
  avatar?: string;
  role: 'superadmin' | 'admin' | 'sheet_admin' | 'user';
  status: 'active' | 'inactive';
  createdAt: string;
  phone?: string;
  lastLogin?: string;
  permissions: {
    canView: boolean;
    canEdit: boolean;
    canDownload: boolean;
    isAdmin: boolean;
    canCreateSheets?: boolean;
    viewRestrictions?: Record<string, number[]> | null;
    editRestrictions?: Record<string, number[]> | null;
    downloadRestrictions?: Record<string, number[]> | null;
    createRestrictions?: Record<string, boolean> | null;
    rowViewRestrictions?: Record<string, { start?: number; end?: number }> | null;
    rowEditRestrictions?: Record<string, { start?: number; end?: number }> | null;
    rowDownloadRestrictions?: Record<string, { start?: number; end?: number }> | null;
    fullSheetAccess?: boolean;
    allowedRegisters?: string[];
    allowedFolders?: string[];
  };
}

export async function ensureDefaultAdmin(): Promise<void> {
  // Database superadmin is already bootstrapped on the server side
  return Promise.resolve();
}

export async function firebaseLogin(email: string, password: string) {
  let networkFailed = false;
  try {
    const res = await fetch(apiUrl('/api/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      return data;
    }
    // Always surface real backend auth errors (wrong password, inactive, pending approval)
    throw new Error(data.error || 'Invalid username or password');
  } catch (e: any) {
    if (e instanceof TypeError || e?.name === 'TypeError') {
      networkFailed = true;
    } else {
      throw e;
    }
  }

  // Built-in instant fallback ONLY when backend server is unreachable
  if (networkFailed) {
    const ident = (email || '').trim().toLowerCase();
    if (
      (ident === 'admin@sjvps.com' || ident === 'admin' || ident === 'admin user') &&
      (password === 'admin123' || password === 'admin')
    ) {
      const user: AppUser = {
        id: 'usr_admin_1',
        name: 'Admin User',
        email: 'admin@sjvps.com',
        role: 'admin',
        status: 'active',
        createdAt: new Date().toISOString(),
        permissions: { canView: true, canEdit: true, canDownload: true, isAdmin: true, fullSheetAccess: true }
      };
      const token = 'mock_jwt_admin_' + Date.now();
      return { token, user };
    }

    if (
      (ident === 'collaborator@sjvps.com' || ident === 'collaborator' || ident === 'user' || ident === 'collaborator 2' || ident === 'user123') &&
      (password === 'user123' || password === 'user' || password === 'collaborator')
    ) {
      const user: AppUser = {
        id: 'usr_collab_2',
        name: 'Collaborator 2',
        email: 'collaborator@sjvps.com',
        role: 'user',
        status: 'active',
        createdAt: new Date().toISOString(),
        permissions: { canView: true, canEdit: true, canDownload: true, isAdmin: false, fullSheetAccess: true }
      };
      const token = 'mock_jwt_collab_' + Date.now();
      return { token, user };
    }
  }

  throw new Error('Unable to reach authentication server');
}

export async function requestLoginAccess(data: {
  name: string;
  email: string;
  phone?: string;
  password: string;
  reason: string;
}) {
  const res = await fetch(apiUrl('/api/auth/request-access'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || 'Failed to submit access request');
  }
  return json as { id: string; status: string; message: string };
}

export async function checkLoginRequestStatus(email: string) {
  const res = await fetch(apiUrl(`/api/auth/request-status?email=${encodeURIComponent(email.trim())}`));
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || 'Failed to check request status');
  }
  return json as {
    status: 'pending' | 'approved' | 'rejected' | 'inactive' | 'not_found';
    name?: string;
    adminResponse?: string;
    createdAt?: string;
  };
}

export async function firebaseAdminLogin(email: string, password: string) {
  const result = await firebaseLogin(email, password);
  if (result.user.role !== 'admin' && result.user.role !== 'superadmin' && !result.user.permissions?.isAdmin) {
    throw new Error('You do not have admin access');
  }
  return result;
}

export async function firebaseGetMe(token: string) {
  let networkFailed = false;
  let lastStatus = 0;
  try {
    const res = await fetch(apiUrl('/api/auth/me'), {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      return await res.json();
    }
    lastStatus = res.status;
    if (res.status === 401 || res.status === 403) {
      const authErr: any = new Error('Unauthorized');
      authErr.status = res.status;
      authErr.code = 'UNAUTHORIZED';
      throw authErr;
    }
  } catch (e: any) {
    if (e?.code === 'UNAUTHORIZED' || e?.status === 401 || e?.status === 403) {
      throw e;
    }
    networkFailed = true;
  }

  if (networkFailed && token && token.startsWith('mock_jwt_admin_')) {
    return {
      user: {
        id: 'usr_admin_1',
        name: 'Admin User',
        email: 'admin@sjvps.com',
        role: 'admin',
        status: 'active',
        createdAt: new Date().toISOString(),
        permissions: { canView: true, canEdit: true, canDownload: true, isAdmin: true, fullSheetAccess: true }
      }
    };
  }

  if (networkFailed && token && token.startsWith('mock_jwt_collab_')) {
    return {
      user: {
        id: 'usr_collab_2',
        name: 'Collaborator 2',
        email: 'collaborator@sjvps.com',
        role: 'user',
        status: 'active',
        createdAt: new Date().toISOString(),
        permissions: { canView: true, canEdit: true, canDownload: true, isAdmin: false, fullSheetAccess: true }
      }
    };
  }

  const transientErr: any = new Error(lastStatus ? `Session check temporary error (${lastStatus})` : 'Network error checking session');
  transientErr.status = lastStatus;
  transientErr.code = 'TRANSIENT_ERROR';
  throw transientErr;
}

export function subscribeToMe(
  token: string, 
  onUpdate: (user: any) => void, 
  onError: (err: any) => void
) {
  let active = true;
  let currentUserId: string | null = null;
  let lastRefreshAt = 0;
  let inFlight = false;

  const refresh = (force = false) => {
    const now = Date.now();
    if (!force && (inFlight || now - lastRefreshAt < 30000)) return;
    inFlight = true;
    lastRefreshAt = now;
    firebaseGetMe(token)
      .then((res) => {
        if (!active) return;
        currentUserId = res?.user?.id ? String(res.user.id) : currentUserId;
        onUpdate(res.user);
      })
      .catch((err) => {
        if (active) onError(err);
      })
      .finally(() => {
        inFlight = false;
      });
  };

  refresh(true);

  // Live permission/status updates via Socket.IO & periodic check
  const socket = getSocket();
  const onPermsUpdated = (payload: { userId?: string; user?: any }) => {
    if (!active) return;
    if (currentUserId && payload?.userId && String(payload.userId) === currentUserId) {
      if (payload.user) {
        onUpdate(payload.user);
      } else {
        refresh(true);
      }
    }
  };
  socket.on('user:permissions-updated', onPermsUpdated);
  const onFocus = () => refresh(false);
  window.addEventListener('focus', onFocus);

  return () => {
    active = false;
    socket.off('user:permissions-updated', onPermsUpdated);
    window.removeEventListener('focus', onFocus);
  };
}

export async function firebaseLogout(_token: string) {
  // Stateless logout, handled client side by clearing token
  return Promise.resolve();
}

export async function firebaseChangePassword(token: string, currentPassword: string, newPassword: string) {
  const res = await fetch(apiUrl('/api/auth/change-password'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ currentPassword, newPassword })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Password change failed');
  }
  return res.json();
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const token = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('recordbook_token') : null;
    if (token) headers['Authorization'] = `Bearer ${token}`;
  } catch {}
  return headers;
}

export async function firebaseGetUsers() {
  const res = await fetch(apiUrl('/api/auth/users'), { headers: authHeaders() });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to fetch users');
  }
  return res.json();
}

export async function firebaseCreateUser(data: {
  name: string; email: string; password: string; role?: string; phone?: string;
}) {
  const res = await fetch(apiUrl('/api/auth/users'), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to create user');
  }
  return res.json();
}

export async function firebaseUpdateUser(id: string, data: Record<string, unknown>) {
  const res = await fetch(apiUrl(`/api/auth/users/${id}`), {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to update user');
  }
  return res.json();
}

export async function firebaseUpdatePermissions(id: string, permissions: Record<string, unknown>) {
  const res = await fetch(apiUrl(`/api/auth/users/${id}/permissions`), {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ permissions })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to update permissions');
  }
  return res.json();
}

export async function firebaseAdminChangePassword(id: string, newPassword: string) {
  const res = await fetch(apiUrl(`/api/auth/users/${id}`), {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ password: newPassword })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to reset password');
  }
  return res.json();
}

export async function firebaseDeleteUser(id: string) {
  const res = await fetch(apiUrl(`/api/auth/users/${id}`), {
    method: 'DELETE',
    headers: authHeaders()
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to delete user');
  }
  return res.json();
}

export async function firebaseUpdateUserStatus(id: string, status: 'active' | 'inactive') {
  const res = await fetch(apiUrl(`/api/auth/users/${id}`), {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ status })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to update status');
  }
  return res.json();
}

export async function logActivity(
  userId: string, 
  userName: string, 
  action: string, 
  details: string,
  registerId?: string | number,
  registerName?: string
) {
  const res = await fetch(apiUrl('/api/activity'), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ userId, userName, action, details, registerId, registerName })
  });
  if (!res.ok) {
    const err = await res.json();
    console.error('Failed to log activity:', err.error);
  }
}

export function firebaseLogWorkspaceAction(
  userId: string, 
  userName: string, 
  action: string, 
  details: string,
  registerId?: string | number,
  registerName?: string
) {
  logActivity(userId, userName, action, details, registerId, registerName).catch(() => {});
}

export async function firebaseGetActivity(limitCount = 200) {
  const res = await fetch(apiUrl(`/api/activity?limit=${limitCount}`), { headers: authHeaders() });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to fetch activity');
  }
  return res.json();
}

export async function firebaseGetUserActivity(userId: string) {
  const res = await fetch(apiUrl(`/api/activity/user/${userId}`), { headers: authHeaders() });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to fetch user activity');
  }
  return res.json();
}

export type AppRequestType = 'download' | 'delete_register' | 'account_access' | 'edit_access' | 'view_access';

export async function firebaseCreateRequest(
  userId: string,
  userName: string,
  data: { registerName: string; description: string; type: AppRequestType; registerId?: string | number; scope?: object }
) {
  const res = await fetch(apiUrl('/api/requests'), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ userId, userName, ...data })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to create request');
  }
  return res.json();
}

export async function firebaseGetMyDownloadRequests(userId: string) {
  const res = await fetch(apiUrl(`/api/requests/my?userId=${encodeURIComponent(userId)}`), { headers: authHeaders() });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to fetch my requests');
  }
  return res.json();
}

export async function firebaseGetAllDownloadRequests() {
  const res = await fetch(apiUrl('/api/requests/all'), { headers: authHeaders() });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to fetch all requests');
  }
  return res.json();
}

export async function firebaseGetPendingDownloadRequests() {
  const res = await fetch(apiUrl('/api/requests/pending'), { headers: authHeaders() });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to fetch pending requests');
  }
  return res.json();
}

export async function firebaseRespondRequest(
  requestId: string,
  status: 'approved' | 'rejected',
  adminResponse: string,
  adminName: string = 'Admin'
) {
  const res = await fetch(apiUrl(`/api/requests/${requestId}/respond`), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ status, adminResponse, adminName })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to respond to request');
  }
  return res.json();
}

export async function firebaseDeleteRequest(requestId: string) {
  const res = await fetch(apiUrl(`/api/requests/${requestId}`), {
    method: 'DELETE',
    headers: authHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to remove request');
  }
  return res.json();
}

export async function firebaseCreateNotification(
  userId: string,
  data: { title: string; message: string; type: string; meta?: Record<string, any> }
) {
  const res = await fetch(apiUrl('/api/notifications'), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ userId, ...data })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to create notification');
  }
  return res.json();
}

export async function firebaseGetMyNotifications(userId: string) {
  const res = await fetch(apiUrl(`/api/notifications?userId=${encodeURIComponent(userId)}`), { headers: authHeaders() });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to fetch notifications');
  }
  return res.json();
}

export async function firebaseMarkNotificationRead(notifId: string) {
  const res = await fetch(apiUrl(`/api/notifications/${notifId}/read`), {
    method: 'PUT',
    headers: authHeaders()
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to mark read');
  }
}

export async function firebaseMarkAllNotificationsRead(userId: string) {
  const res = await fetch(apiUrl('/api/notifications/read-all'), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ userId })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to mark all read');
  }
}

export interface OnlineUserItem {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar?: string;
  currentActivity: string;
  lastActive: string;
  status: 'online' | 'idle' | 'offline';
}

export async function sendPresenceHeartbeat(data: {
  userId: string;
  userName: string;
  email?: string;
  role?: string;
  avatar?: string;
  currentActivity?: string;
  registerId?: string | number | null;
  registerName?: string | null;
}) {
  try {
    await updateWorkspacePresence({
      userId: data.userId,
      name: data.userName,
      email: data.email,
      role: data.role,
      avatar: data.avatar,
      registerId: data.registerId,
      registerName: data.registerName,
      page: data.currentActivity,
    });
  } catch {
    // Ignore transient presence errors
  }
}

export async function firebaseGetOnlineUsers(): Promise<{ users: OnlineUserItem[] }> {
  const ablyUsers = await getAblyOnlineUsers();
  return {
    users: ablyUsers.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email || '',
      role: u.role || 'user',
      avatar: u.avatar || '',
      currentActivity: u.currentPage || (u.currentRegisterName ? `Viewing "${u.currentRegisterName}"` : 'Active in app'),
      lastActive: new Date(u.lastSeen).toISOString(),
      status: 'online' as const,
    }))
  };
}

