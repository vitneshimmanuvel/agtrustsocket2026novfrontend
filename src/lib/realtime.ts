import { createClient, type PubSubClient, type RealtimeChannel, type PresenceMessage } from '@ably/pubsub-device';
import { io, type Socket } from 'socket.io-client';
import { apiUrl } from './apiBase';

export interface RealtimeSocketLike {
  readonly id: string | undefined;
  readonly connected: boolean;
  on(event: string, listener: (...args: any[]) => void): this;
  off(event: string, listener?: (...args: any[]) => void): this;
  emit(event: string, ...args: any[]): this;
}

export interface WorkspacePresencePayload {
  userId: string;
  name: string;
  email?: string;
  role?: string;
  avatar?: string;
  registerId?: string | number | null;
  registerName?: string | null;
  page?: string;
}

export interface AblyOnlineUserInfo {
  id: string;
  name: string;
  email?: string;
  role?: string;
  avatar?: string;
  currentPage?: string;
  currentRegisterId?: string;
  currentRegisterName?: string;
  lastSeen: number;
  isOnline: boolean;
}

const USER_COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1'
];

function getUserColor(userId: string | number): string {
  const hash = String(userId).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return USER_COLORS[hash % USER_COLORS.length];
}

function getStoredAuthToken(): string | null {
  try {
    return sessionStorage.getItem('recordbook_token') || localStorage.getItem('recordbook_token');
  } catch {
    return null;
  }
}

function getStoredUser(): any | null {
  try {
    const raw = sessionStorage.getItem('recordbook_user') || localStorage.getItem('recordbook_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function isStoredUserAdmin(): boolean {
  const u = getStoredUser();
  if (!u) return false;
  return u.role === 'superadmin' || u.role === 'admin' || !!u.permissions?.isAdmin;
}

interface JoinedRoomState {
  registerId: string;
  seq: number;
  cancelled: boolean;
  userName: string;
  userId: string;
  avatar: string;
  color: string;
  joinedAt: number;
  lockedCell: { entryId: any; colId: string; mode?: 'focus' | 'edit' } | null;
  channel: RealtimeChannel;
  latestMembers: PresenceMessage[];
  presenceHandler: () => void;
  messageHandlers: Array<{ name: string; fn: (msg: { data?: any }) => void }>;
  syncing: boolean;
  syncQueued: boolean;
  presenceQueue: Promise<void>;
}

const listeners = new Map<string, Set<(...args: any[]) => void>>();
const joinedRooms = new Map<string, JoinedRoomState>();
const roomSeqMap = new Map<string, number>();

let ablyClient: PubSubClient | null = null;
let fallbackSocket: Socket | null = null;
let useSocketFallback = false;
let ablyConnected = false;
let hadConnectionLoss = false;

let attachedAdminChannel: RealtimeChannel | null = null;
let adminHandlers: Array<{ name: string; fn: (msg: { data?: any }) => void }> = [];

let attachedUserChannel: RealtimeChannel | null = null;
let attachedUserId: string | null = null;
let userHandlers: Array<{ name: string; fn: (msg: { data?: any }) => void }> = [];

let workspaceChannel: RealtimeChannel | null = null;
let currentWorkspacePresence: Record<string, any> | null = null;
const workspaceSubscribers = new Set<(users: AblyOnlineUserInfo[]) => void>();
let workspacePresenceListenerBound = false;

const REGISTER_CHANNEL_EVENTS = [
  'cell:update',
  'row:add',
  'row:insert',
  'row:delete',
  'row:bulk-delete',
  'row:reorder',
  'register:update',
  'register:delete',
  'column:update',
  'cell:live-typing',
];

function dispatchLocal(event: string, ...args: any[]): void {
  const set = listeners.get(event);
  if (!set || set.size === 0) return;
  for (const fn of Array.from(set)) {
    try {
      fn(...args);
    } catch (err) {
      console.error(`[Realtime listener error] ${event}:`, err);
    }
  }
}

function getFallbackSocket(): Socket {
  if (!fallbackSocket) {
    const token = getStoredAuthToken();
    fallbackSocket = io({
      path: '/socket.io/',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      auth: token ? { token } : undefined,
    });

    for (const [event, set] of listeners.entries()) {
      for (const fn of set) {
        fallbackSocket.on(event, fn);
      }
    }
  }
  return fallbackSocket;
}

function activateSocketFallback(): void {
  if (useSocketFallback) return;
  useSocketFallback = true;
  console.info('[Realtime] Ably not configured on server (501); using Socket.IO fallback.');

  if (ablyClient) {
    try {
      ablyClient.close();
    } catch {
      // ignore
    }
    ablyClient = null;
  }

  const sock = getFallbackSocket();
  for (const room of joinedRooms.values()) {
    sock.emit('join-register', {
      registerId: room.registerId,
      userName: room.userName,
      userId: room.userId,
      avatar: room.avatar,
    });
  }
}

function ensureAblyClient(): PubSubClient | null {
  if (useSocketFallback) return null;
  if (ablyClient) return ablyClient;

  ablyClient = createClient({
    echoMessages: false,
    authCallback: async (_tokenParams, callback) => {
      try {
        const headers: Record<string, string> = {};
        const token = getStoredAuthToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(apiUrl('/api/ably/token'), { headers });
        if (res.status === 501) {
          activateSocketFallback();
          callback('ably_not_configured', null);
          return;
        }
        if (!res.ok) {
          const errText = await res.text().catch(() => `HTTP ${res.status}`);
          callback(errText || `HTTP ${res.status}`, null);
          return;
        }
        const tokenRequest = await res.json();
        callback(null, tokenRequest);
      } catch (err: any) {
        callback(err?.message || 'Ably token request failed', null);
      }
    },
  });

  ablyClient.connection.on('connected', () => {
    const isReconnect = hadConnectionLoss;
    ablyConnected = true;
    hadConnectionLoss = false;
    dispatchLocal('connect');
    if (isReconnect) {
      dispatchLocal('realtime:resync');
    }
  });

  ablyClient.connection.on('disconnected', () => {
    ablyConnected = false;
    hadConnectionLoss = true;
  });

  ablyClient.connection.on('suspended', () => {
    ablyConnected = false;
    hadConnectionLoss = true;
  });

  ablyClient.connection.on('closed', () => {
    ablyConnected = false;
  });

  return ablyClient;
}

function hasAnyListener(events: string[]): boolean {
  return events.some((ev) => (listeners.get(ev)?.size || 0) > 0);
}

function detachAdminSubscription(): void {
  if (attachedAdminChannel) {
    for (const h of adminHandlers) {
      try {
        attachedAdminChannel.unsubscribe(h.name, h.fn);
      } catch {
        // ignore
      }
    }
    adminHandlers = [];
    if (attachedAdminChannel.state === 'attached') {
      attachedAdminChannel.detach().catch(() => {});
    }
    attachedAdminChannel = null;
  }
}

function detachUserSubscription(): void {
  if (attachedUserChannel) {
    for (const h of userHandlers) {
      try {
        attachedUserChannel.unsubscribe(h.name, h.fn);
      } catch {
        // ignore
      }
    }
    userHandlers = [];
    if (attachedUserChannel.state === 'attached') {
      attachedUserChannel.detach().catch(() => {});
    }
    attachedUserChannel = null;
    attachedUserId = null;
  }
}

function syncPrivateSubscriptions(): void {
  const client = ensureAblyClient();
  if (!client) return;

  const user = getStoredUser();
  const uid = user?.id ? String(user.id) : null;

  // 1. Private User Notification & Permissions Channel: user:<userId>
  const wantsUserEvents = hasAnyListener(['user:notification', 'user:permissions-updated']);
  if (!uid || !wantsUserEvents) {
    if (!uid) detachUserSubscription();
  } else if (attachedUserId !== uid) {
    detachUserSubscription();
    const ch = client.channels.get(`user:${uid}`);
    const onNotif = (msg: { data?: any }) => dispatchLocal('user:notification', msg.data);
    const onPerms = (msg: { data?: any }) => dispatchLocal('user:permissions-updated', msg.data);
    ch.subscribe('user:notification', onNotif).catch(() => {});
    ch.subscribe('user:permissions-updated', onPerms).catch(() => {});
    attachedUserChannel = ch;
    attachedUserId = uid;
    userHandlers = [
      { name: 'user:notification', fn: onNotif },
      { name: 'user:permissions-updated', fn: onPerms },
    ];
  }

  // 2. Admin Notification & Request Queue Channel: admin:events
  const wantsAdminEvents = hasAnyListener(['admin:notification', 'admin:requests-updated']);
  if (!isStoredUserAdmin()) {
    detachAdminSubscription();
  } else if (wantsAdminEvents && !attachedAdminChannel) {
    const ch = client.channels.get('admin:events');
    const onAdminNotif = (msg: { data?: any }) => dispatchLocal('admin:notification', msg.data);
    const onReqUpd = (msg: { data?: any }) => dispatchLocal('admin:requests-updated', msg.data);
    ch.subscribe('admin:notification', onAdminNotif).catch(() => {});
    ch.subscribe('admin:requests-updated', onReqUpd).catch(() => {});
    attachedAdminChannel = ch;
    adminHandlers = [
      { name: 'admin:notification', fn: onAdminNotif },
      { name: 'admin:requests-updated', fn: onReqUpd },
    ];
  }
}

async function syncRoomPresence(room: JoinedRoomState): Promise<void> {
  if (room.syncing) {
    room.syncQueued = true;
    return;
  }
  room.syncing = true;
  try {
    do {
      room.syncQueued = false;
      const members = await room.channel.presence.get();
      room.latestMembers = members;

      const byUserId = new Map<string, any>();
      const locks: Array<{
        entryId: any;
        colId: string;
        userName: string;
        userId: any;
        color: string;
        lockerSocketId?: string;
        mode?: 'focus' | 'edit';
      }> = [];

      for (const m of members) {
        const d = (m.data && typeof m.data === 'object') ? m.data : {};
        const uId = String(d.id || m.clientId || m.connectionId);
        const uName = String(d.name || 'User');
        const uColor = String(d.color || getUserColor(uId));

        if (!byUserId.has(uId)) {
          byUserId.set(uId, {
            id: d.id || m.clientId || m.connectionId,
            name: uName,
            avatar: d.avatar || '',
            color: uColor,
            joinedAt: d.joinedAt || m.timestamp || Date.now(),
          });
        }

        if (d.lockedCell && d.lockedCell.entryId !== undefined && d.lockedCell.colId !== undefined) {
          locks.push({
            entryId: d.lockedCell.entryId,
            colId: String(d.lockedCell.colId),
            userName: uName,
            userId: d.id || m.clientId || m.connectionId,
            color: uColor,
            lockerSocketId: m.connectionId,
            mode: d.lockedCell.mode === 'focus' ? 'focus' : 'edit',
          });
        }
      }

      dispatchLocal('presence:update', {
        registerId: room.registerId,
        users: Array.from(byUserId.values()),
      });

      dispatchLocal('cell:locks-snapshot', {
        registerId: room.registerId,
        locks,
      });
    } while (room.syncQueued);
  } catch (err: any) {
    console.warn(`[Ably Presence Sync Warning] register:${room.registerId}:`, err?.message || err);
  } finally {
    room.syncing = false;
  }
}

async function joinRegisterRoom(data: {
  registerId: string | number;
  userName?: string;
  userId?: string | number;
  avatar?: string;
}): Promise<void> {
  if (!data?.registerId) return;
  const regId = String(data.registerId);
  const client = ensureAblyClient();
  if (!client) return;

  const userName = data.userName || 'Collaborator';
  const userId = String(data.userId || 'anon');
  const avatar = data.avatar || '';
  const color = getUserColor(userId);

  const enqueueRoomPresence = (targetRoom: JoinedRoomState, op: () => Promise<void>) => {
    targetRoom.presenceQueue = targetRoom.presenceQueue
      .catch(() => {})
      .then(async () => {
        if (targetRoom.cancelled || joinedRooms.get(targetRoom.registerId) !== targetRoom) return;
        await op();
      })
      .catch(() => {});
    return targetRoom.presenceQueue;
  };

  const existing = joinedRooms.get(regId);
  if (existing) {
    existing.userName = userName;
    existing.userId = userId;
    existing.avatar = avatar;
    existing.color = color;
    await enqueueRoomPresence(existing, async () => {
      await existing.channel.presence.enter({
        id: existing.userId,
        name: existing.userName,
        avatar: existing.avatar,
        color: existing.color,
        joinedAt: existing.joinedAt,
        lockedCell: existing.lockedCell,
      });
      await syncRoomPresence(existing);
    });
    return;
  }

  const channel = client.channels.get(`register:${regId}`);
  const seq = (roomSeqMap.get(regId) || 0) + 1;
  roomSeqMap.set(regId, seq);

  const room: JoinedRoomState = {
    registerId: regId,
    seq,
    cancelled: false,
    userName,
    userId,
    avatar,
    color,
    joinedAt: Date.now(),
    lockedCell: null,
    channel,
    latestMembers: [],
    presenceHandler: () => {
      syncRoomPresence(room);
    },
    messageHandlers: [],
    syncing: false,
    syncQueued: false,
    presenceQueue: Promise.resolve(),
  };
  joinedRooms.set(regId, room);

  for (const eventName of REGISTER_CHANNEL_EVENTS) {
    const fn = (msg: { data?: any }) => {
      dispatchLocal(eventName, msg.data);
    };
    room.messageHandlers.push({ name: eventName, fn });
    channel.subscribe(eventName, fn).catch(() => {});
  }

  channel.presence.subscribe(['enter', 'update', 'leave', 'present'], room.presenceHandler).catch(() => {});

  try {
    await enqueueRoomPresence(room, async () => {
      await channel.presence.enter({
        id: room.userId,
        name: room.userName,
        avatar: room.avatar,
        color: room.color,
        joinedAt: room.joinedAt,
        lockedCell: room.lockedCell,
      });
      if (room.cancelled || joinedRooms.get(regId) !== room) {
        if (!joinedRooms.has(regId) && channel.state === 'attached') {
          channel.presence.leave().catch(() => {}).finally(() => {
            if (!joinedRooms.has(regId) && channel.state === 'attached') {
              channel.detach().catch(() => {});
            }
          });
        }
        return;
      }
      await syncRoomPresence(room);
    });
  } catch (err: any) {
    console.warn(`[Ably Join Room Warning] register:${regId}:`, err?.message || err);
  }
}

function leaveRegisterRoom(data: { registerId: string | number }): void {
  if (!data?.registerId) return;
  const regId = String(data.registerId);
  const room = joinedRooms.get(regId);
  if (!room) return;
  room.cancelled = true;
  joinedRooms.delete(regId);

  for (const h of room.messageHandlers) {
    try {
      room.channel.unsubscribe(h.name, h.fn);
    } catch {
      // ignore
    }
  }
  try {
    room.channel.presence.unsubscribe(room.presenceHandler);
  } catch {
    // ignore
  }
  const leavingSeq = room.seq;
  queueMicrotask(() => {
    // Only leave/detach when another mount hasn't immediately rejoined this register
    if (joinedRooms.has(regId) || roomSeqMap.get(regId) !== leavingSeq) {
      return;
    }
    if (room.channel.state === 'attached') {
      room.channel.presence.leave().catch(() => {}).finally(() => {
        if (!joinedRooms.has(regId) && roomSeqMap.get(regId) === leavingSeq && room.channel.state === 'attached') {
          room.channel.detach().catch(() => {});
        }
      });
    }
  });
}

function focusCell(data: {
  registerId: string | number;
  entryId: any;
  colId: string | number;
  userName?: string;
  userId?: string | number;
  mode?: 'focus' | 'edit';
}): void {
  if (!data?.registerId || data.entryId === undefined || data.colId === undefined) return;
  const regId = String(data.registerId);
  const colId = String(data.colId);
  const mode: 'focus' | 'edit' = data.mode === 'focus' ? 'focus' : 'edit';
  const room = joinedRooms.get(regId);
  if (!room) return;

  if (mode === 'edit') {
    const myConnId = ablyClient?.connection?.id;
    for (const m of room.latestMembers) {
      const lock = m.data?.lockedCell;
      if (!lock || lock.mode === 'focus') continue;
      const isSameCell = String(lock.entryId) === String(data.entryId) && String(lock.colId) === colId;
      const isDifferentConn = myConnId ? m.connectionId !== myConnId : String(m.data?.id) !== String(room.userId);
      if (isSameCell && isDifferentConn) {
        dispatchLocal('cell:lock-rejected', {
          registerId: regId,
          entryId: data.entryId,
          colId,
          lockedBy: m.data?.name || 'Collaborator',
          color: m.data?.color || getUserColor(m.data?.id || m.connectionId),
        });
        return;
      }
    }
  }

  // Skip redundant frame if unchanged
  if (
    room.lockedCell &&
    String(room.lockedCell.entryId) === String(data.entryId) &&
    String(room.lockedCell.colId) === colId &&
    (room.lockedCell.mode || 'edit') === mode
  ) {
    return;
  }

  const nextLocked = { entryId: data.entryId, colId, mode };
  room.lockedCell = nextLocked;
  const nextName = data.userName || room.userName;
  room.presenceQueue = room.presenceQueue
    .catch(() => {})
    .then(async () => {
      if (room.cancelled || joinedRooms.get(regId) !== room) return;
      await room.channel.presence.update({
        id: room.userId,
        name: nextName,
        avatar: room.avatar,
        color: room.color,
        joinedAt: room.joinedAt,
        lockedCell: room.lockedCell,
      });
    })
    .catch(() => {});
}

function blurCell(data: { registerId: string | number; entryId: any; colId: string | number }): void {
  if (!data?.registerId) return;
  const regId = String(data.registerId);
  const room = joinedRooms.get(regId);
  if (!room || !room.lockedCell) return;

  const matches =
    String(room.lockedCell.entryId) === String(data.entryId) &&
    String(room.lockedCell.colId) === String(data.colId);
  if (!matches) return;

  room.lockedCell = null;
  room.presenceQueue = room.presenceQueue
    .catch(() => {})
    .then(async () => {
      if (room.cancelled || joinedRooms.get(regId) !== room) return;
      await room.channel.presence.update({
        id: room.userId,
        name: room.userName,
        avatar: room.avatar,
        color: room.color,
        joinedAt: room.joinedAt,
        lockedCell: room.lockedCell,
      });
    })
    .catch(() => {});
}

function publishToRoomChannel(eventName: string, data: any): void {
  if (!data?.registerId) return;
  const regId = String(data.registerId);
  const client = ensureAblyClient();
  if (!client) return;
  const channel = joinedRooms.get(regId)?.channel || client.channels.get(`register:${regId}`);
  channel.publish(eventName, data).catch((err: any) => {
    console.warn(`[Ably Publish Warning] ${eventName} on register:${regId}:`, err?.message || err);
  });
}

const realtimeFacade: RealtimeSocketLike = {
  get id(): string | undefined {
    if (useSocketFallback && fallbackSocket) return fallbackSocket.id;
    return ablyClient?.connection?.id || undefined;
  },
  get connected(): boolean {
    if (useSocketFallback && fallbackSocket) return fallbackSocket.connected;
    return ablyConnected;
  },
  on(event: string, listener: (...args: any[]) => void) {
    let set = listeners.get(event);
    if (!set) {
      set = new Set();
      listeners.set(event, set);
    }
    set.add(listener);

    if (useSocketFallback) {
      getFallbackSocket().on(event, listener);
    } else if (getStoredUser()?.id) {
      ensureAblyClient();
      syncPrivateSubscriptions();
    }
    return this;
  },
  off(event: string, listener?: (...args: any[]) => void) {
    if (listener) {
      listeners.get(event)?.delete(listener);
      if (fallbackSocket) fallbackSocket.off(event, listener);
    } else {
      listeners.delete(event);
      if (fallbackSocket) fallbackSocket.off(event);
    }
    return this;
  },
  emit(event: string, ...args: any[]) {
    if (useSocketFallback) {
      getFallbackSocket().emit(event, ...args);
      return this;
    }

    const payload = args[0];
    switch (event) {
      case 'join-register':
        joinRegisterRoom(payload);
        break;
      case 'leave-register':
        leaveRegisterRoom(payload);
        break;
      case 'cell:focus':
        focusCell(payload);
        break;
      case 'cell:blur':
        blurCell(payload);
        break;
      case 'cell:live-typing':
      case 'row:add':
      case 'row:delete':
      case 'column:update':
        publishToRoomChannel(event, payload);
        break;
      default:
        break;
    }
    return this;
  },
};

export function getRealtimeSocket(): RealtimeSocketLike {
  return realtimeFacade;
}

/**
 * Call whenever auth session changes (login / logout) so Ably re-mints tokens
 * with the updated user/admin capabilities and attaches private user/admin channels.
 */
export async function resetRealtimeAuth(): Promise<void> {
  const user = getStoredUser();
  const uid = user?.id ? String(user.id) : null;

  if (useSocketFallback) {
    if (fallbackSocket) {
      const token = getStoredAuthToken();
      fallbackSocket.auth = token ? { token } : {};
      fallbackSocket.disconnect();
      fallbackSocket.connect();
    }
    return;
  }

  detachAdminSubscription();
  if (!uid || (attachedUserId && attachedUserId !== uid)) {
    detachUserSubscription();
  }

  if (!uid) {
    if (workspaceChannel?.state === 'attached') {
      await workspaceChannel.presence.leave().catch(() => {});
      await workspaceChannel.detach().catch(() => {});
    }
    currentWorkspacePresence = null;
    workspacePresenceListenerBound = false;
    workspaceChannel = null;
    return;
  }

  const wasInitialized = Boolean(ablyClient);
  const client = ensureAblyClient();
  if (client) {
    if (wasInitialized) {
      try {
        await client.auth.authorize();
      } catch {
        // ignore if guest/disconnected
      }
    }
    syncPrivateSubscriptions();
  }
}

function getWorkspaceChannel(): RealtimeChannel | null {
  if (useSocketFallback) return null;
  const client = ensureAblyClient();
  if (!client) return null;
  if (!workspaceChannel) {
    workspaceChannel = client.channels.get('workspace:presence');
  }
  if (!workspacePresenceListenerBound) {
    workspacePresenceListenerBound = true;
    workspaceChannel.presence.subscribe(['enter', 'update', 'leave'], async () => {
      if (workspaceSubscribers.size === 0) return;
      const users = await getAblyOnlineUsers();
      for (const cb of workspaceSubscribers) {
        try {
          cb(users);
        } catch {
          // ignore
        }
      }
    }).catch(() => {});
  }
  return workspaceChannel;
}

export async function updateWorkspacePresence(info: WorkspacePresencePayload): Promise<void> {
  if (!info?.userId) return;
  const ch = getWorkspaceChannel();
  if (!ch) return;

  const payload = {
    id: String(info.userId),
    name: info.name,
    email: info.email || '',
    role: info.role || 'user',
    avatar: info.avatar || '',
    currentPage: info.page || '',
    currentRegisterId: info.registerId ? String(info.registerId) : '',
    currentRegisterName: info.registerName || '',
    lastSeen: Date.now(),
  };

  // Skip duplicate presence frames if nothing changed
  const prev = currentWorkspacePresence;
  if (
    prev &&
    prev.id === payload.id &&
    prev.currentPage === payload.currentPage &&
    prev.currentRegisterId === payload.currentRegisterId &&
    prev.currentRegisterName === payload.currentRegisterName
  ) {
    return;
  }
  currentWorkspacePresence = payload;

  try {
    if (ch.state === 'attached') {
      await ch.presence.update(payload);
    } else {
      await ch.presence.enter(payload);
    }
  } catch {
    // ignore transient offline errors
  }
}

export async function leaveWorkspacePresence(): Promise<void> {
  currentWorkspacePresence = null;
  if (workspaceChannel?.state === 'attached') {
    await workspaceChannel.presence.leave().catch(() => {});
  }
}

export async function getAblyOnlineUsers(): Promise<AblyOnlineUserInfo[]> {
  const ch = getWorkspaceChannel();
  if (!ch) return [];
  try {
    const members = await Promise.race<PresenceMessage[]>([
      ch.presence.get(),
      new Promise<PresenceMessage[]>((resolve) => setTimeout(() => resolve([]), 2500)),
    ]);
    const byId = new Map<string, AblyOnlineUserInfo>();
    for (const m of members) {
      const d = (m.data && typeof m.data === 'object') ? m.data : {};
      const id = String(d.id || m.clientId || m.connectionId);
      const lastSeen = Number(d.lastSeen || m.timestamp || Date.now());
      const prev = byId.get(id);
      if (!prev || lastSeen >= prev.lastSeen) {
        byId.set(id, {
          id,
          name: String(d.name || 'User'),
          email: d.email || '',
          role: d.role || 'user',
          avatar: d.avatar || '',
          currentPage: d.currentPage || '',
          currentRegisterId: d.currentRegisterId || '',
          currentRegisterName: d.currentRegisterName || '',
          lastSeen,
          isOnline: true,
        });
      }
    }
    return Array.from(byId.values());
  } catch {
    return [];
  }
}

export function subscribeWorkspacePresence(cb: (users: AblyOnlineUserInfo[]) => void): () => void {
  workspaceSubscribers.add(cb);
  getWorkspaceChannel();
  return () => {
    workspaceSubscribers.delete(cb);
  };
}
