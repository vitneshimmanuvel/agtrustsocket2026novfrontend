import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from './auth';
import { firebaseGetMyNotifications, firebaseMarkNotificationRead, firebaseMarkAllNotificationsRead } from './firebaseAuth';
import { getSocket } from './api';

export type NotificationType = 'warning' | 'error' | 'info' | 'success';

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  timestamp: string;
  isRead: boolean;
  link?: {
    registerId: string;
    rowId?: string | number;
  };
}

export interface Reminder {
  id: string;
  triggerTime?: number; // Unix timestamp (optional)
  message: string;
  registerId: string;
  rowId?: string | number;
  colId?: string;
  status: 'Pending' | 'Complete';
}

interface NotificationContextType {
  notifications: AppNotification[];
  unreadCount: number;
  addNotification: (notification: Omit<AppNotification, 'id' | 'timestamp' | 'isRead'>) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  removeNotification: (id: string) => void;
  clearAll: () => void;
  scheduleReminder: (reminder: Omit<Reminder, 'id'>) => void;
  reminders: Reminder[];
  setReminders: React.Dispatch<React.SetStateAction<Reminder[]>>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>(() => {
    try {
      const stored = localStorage.getItem('ag_notifications');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [
      {
        id: 'sys-welcome',
        title: 'AG Trust Record Book v2.9.4 beta Active',
        message: 'Advanced History Filters, Automated Daily Backup Cron, and Immutable Link Sync enabled.',
        type: 'success',
        timestamp: new Date().toISOString(),
        isRead: false
      },
      {
        id: 'sys-sync',
        title: 'Live Server Connection',
        message: 'Connected to live PostgreSQL database with 100% real-time data sync.',
        type: 'info',
        timestamp: new Date(Date.now() - 300000).toISOString(),
        isRead: false
      },
      {
        id: 'sys-feature',
        title: 'Sidebar Reordering Enabled',
        message: 'You can now click and hold any folder in the sidebar to drag and reorder positions.',
        type: 'info',
        timestamp: new Date(Date.now() - 600000).toISOString(),
        isRead: false
      }
    ];
  });

  const [reminders, setReminders] = useState<Reminder[]>(() => {
    try {
      const stored = localStorage.getItem('ag_reminders');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const unreadCount = notifications.filter(n => !n.isRead).length;

  useEffect(() => {
    try {
      localStorage.setItem('ag_notifications', JSON.stringify(notifications));
    } catch (e) {
      console.error('Failed to save notifications:', e);
    }
  }, [notifications]);

  useEffect(() => {
    localStorage.setItem('ag_reminders', JSON.stringify(reminders));
  }, [reminders]);

  const addNotification = (notif: Omit<AppNotification, 'id' | 'timestamp' | 'isRead'>) => {
    const newNotif: AppNotification = {
      ...notif,
      id: Date.now().toString() + Math.random().toString(36).substring(7),
      timestamp: new Date().toISOString(),
      isRead: false,
    };
    setNotifications(prev => [newNotif, ...prev]);
  };

  const remindersRef = useRef(reminders);
  
  useEffect(() => {
    remindersRef.current = reminders;
  }, [reminders]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const currentReminders = remindersRef.current;
      
      const triggered = currentReminders.filter(r => r.status === 'Pending' && r.triggerTime !== undefined && r.triggerTime <= now);
      
      if (triggered.length > 0) {
        // Push the notifications
        setNotifications(curr => {
          const newNotifs: AppNotification[] = triggered.map(r => ({
            id: Date.now().toString() + Math.random().toString(36).substring(7),
            title: 'Reminder',
            message: r.message,
            type: 'info',
            timestamp: new Date().toISOString(),
            isRead: false,
            link: { registerId: r.registerId, rowId: r.rowId }
          }));
          return [...newNotifs, ...curr];
        });
        
        // Mark triggered reminders as Complete
        setReminders(prev => prev.map(r => (r.status === 'Pending' && r.triggerTime !== undefined && r.triggerTime <= now) ? { ...r, status: 'Complete' } : r));
      }
    }, 10000); // Check every 10 seconds

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const uid = user?.id ? String(user.id) : '';
    if (!uid) return;

    const loadServerNotifs = async () => {
      try {
        const res = await firebaseGetMyNotifications(uid);
        const serverList = Array.isArray(res?.notifications) ? res.notifications : [];
        if (serverList.length === 0) return;
        setNotifications(prev => {
          const seen = new Set(prev.map(n => n.id));
          const additions: AppNotification[] = [];
          for (const s of serverList) {
            if (!seen.has(s.id)) {
              additions.push({
                id: s.id,
                title: s.title || 'Update',
                message: s.message || '',
                type: (s.type as NotificationType) || 'info',
                timestamp: s.createdAt || new Date().toISOString(),
                isRead: Boolean(s.isRead),
                link: s.meta?.registerId ? { registerId: String(s.meta.registerId) } : undefined,
              });
            }
          }
          if (additions.length === 0) return prev;
          return [...additions, ...prev].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        });
      } catch {}
    };

    loadServerNotifs();

    const socket = getSocket();
    const onUserNotif = (notif: any) => {
      if (!notif || String(notif.userId) !== uid) return;
      const item: AppNotification = {
        id: notif.id || Date.now().toString(),
        title: notif.title || 'Notification',
        message: notif.message || '',
        type: (notif.type as NotificationType) || 'info',
        timestamp: notif.createdAt || new Date().toISOString(),
        isRead: false,
        link: notif.meta?.registerId ? { registerId: String(notif.meta.registerId) } : undefined,
      };
      setNotifications(prev => prev.some(n => n.id === item.id) ? prev : [item, ...prev]);
      if (item.type === 'success') toast.success(item.message || item.title);
      else if (item.type === 'error') toast.error(item.message || item.title);
      else toast(item.message || item.title);
    };
    socket.on('user:notification', onUserNotif);

    return () => {
      socket.off('user:notification', onUserNotif);
    };
  }, [user?.id]);

  const markAsRead = (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
    firebaseMarkNotificationRead(id).catch(() => {});
  };

  const markAllAsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    if (user?.id) {
      firebaseMarkAllNotificationsRead(String(user.id)).catch(() => {});
    }
  };

  const removeNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const clearAll = () => {
    setNotifications([]);
  };

  const scheduleReminder = (reminder: Omit<Reminder, 'id'>) => {
    setReminders(prev => [...prev, { ...reminder, id: Date.now().toString() }]);
  };

  return (
    <NotificationContext.Provider value={{
      notifications,
      unreadCount,
      addNotification,
      markAsRead,
      markAllAsRead,
      removeNotification,
      clearAll,
      scheduleReminder,
      reminders,
      setReminders
    }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
}
