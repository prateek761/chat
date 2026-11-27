import type {
  ChatMemberState,
  ChatMessage,
  ChatRoom,
  MessageReaction,
  ReplyTarget,
  RetentionStats,
  StarredMessageItem,
  UserProfile,
  UserSettings,
} from '../types/chat';

const SESSION_TOKEN_KEY = 'ark_dm_local_session_v1';

export function getStoredSessionToken(): string | null {
  try {
    return window.localStorage.getItem(SESSION_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredSessionToken(token: string | null): void {
  try {
    if (token) {
      window.localStorage.setItem(SESSION_TOKEN_KEY, token);
    } else {
      window.localStorage.removeItem(SESSION_TOKEN_KEY);
    }
  } catch {
    // Ignore storage quota / privacy errors
  }
}

export function buildAuthedFileUrl(url: string): string {
  if (!url) return '';
  if (!url.startsWith('/api/files/')) return url;
  const token = getStoredSessionToken();
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getStoredSessionToken();
  const headers = new Headers(init.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!(init.body instanceof FormData) && !headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, {
    ...init,
    headers,
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg =
      typeof data.error === 'string' && data.error.trim()
        ? data.error
        : `Request failed (${res.status})`;
    const err = new Error(msg) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return data as T;
}

export interface AuthResponse {
  token: string;
  user: UserProfile;
  settings: UserSettings;
}

export interface WorkspacePayload {
  currentUser: UserProfile;
  settings: UserSettings;
  profiles: Record<string, UserProfile>;
  chats: ChatRoom[];
  membersByChat: Record<string, Record<string, ChatMemberState>>;
  messagesByChat: Record<string, ChatMessage[]>;
  reactionsByChat: Record<string, MessageReaction[]>;
  starred: StarredMessageItem[];
  retention: RetentionStats;
}

export interface UploadResponse {
  fileId: string;
  url: string;
  fileName: string;
  fileMime: string;
  fileSize: number;
  expiresAtMs: number;
}

export interface PurgeSummary {
  purgedChatIds: string[];
  purgedMessageIds: string[];
  purgedFileIds: string[];
  deletedDiskFiles: string[];
  updatedChatIds: string[];
  purgedAtMs: number;
}

export const localApi = {
  companySignup: (params: { identifier: string; password: string; displayName: string }) =>
    apiRequest<AuthResponse>('/api/auth/company/signup', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  companySignin: (params: { identifier: string; password: string }) =>
    apiRequest<AuthResponse>('/api/auth/company/signin', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  requestPhoneOtp: (phoneNumber: string) =>
    apiRequest<{ phoneNumber: string; expiresInSec: number; localOtpCode?: string }>(
      '/api/auth/phone/request-otp',
      {
        method: 'POST',
        body: JSON.stringify({ phoneNumber }),
      },
    ),

  verifyPhoneOtp: (params: { phoneNumber: string; code: string; displayName?: string }) =>
    apiRequest<AuthResponse>('/api/auth/phone/verify-otp', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  logout: () => apiRequest<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  fetchWorkspace: () => apiRequest<WorkspacePayload>('/api/workspace'),

  updateProfile: (updates: { displayName: string; handle: string; about: string }) =>
    apiRequest<{ user: UserProfile }>('/api/profile', {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }),

  updateSettings: (updates: Partial<Pick<UserSettings, 'theme' | 'wallpaper' | 'enterToSend'>>) =>
    apiRequest<{ settings: UserSettings }>('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }),

  startDirectChat: (targetUid: string) =>
    apiRequest<{ chat: ChatRoom; members: Record<string, ChatMemberState> }>('/api/chats/direct', {
      method: 'POST',
      body: JSON.stringify({ targetUid }),
    }),

  createGroupChat: (params: { name: string; description: string; memberIds: string[] }) =>
    apiRequest<{ chat: ChatRoom; members: Record<string, ChatMemberState> }>('/api/chats/group', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  updateMember: (
    chatId: string,
    updates: Partial<Pick<ChatMemberState, 'pinned' | 'muted' | 'archived' | 'isTyping'>>,
  ) =>
    apiRequest<{ member: ChatMemberState }>(`/api/chats/${encodeURIComponent(chatId)}/member`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }),

  markChatRead: (chatId: string) =>
    apiRequest<{ ok: boolean; updatedMessageIds: string[] }>(
      `/api/chats/${encodeURIComponent(chatId)}/read`,
      { method: 'POST' },
    ),

  uploadFile: (file: File | Blob, chatId: string, filename?: string) => {
    const form = new FormData();
    if (file instanceof File) {
      form.append('file', file);
    } else {
      form.append('file', file, filename || 'attachment.bin');
    }
    if (chatId) {
      form.append('chatId', chatId);
    }
    return apiRequest<UploadResponse>('/api/uploads', {
      method: 'POST',
      body: form,
    });
  },

  sendMessage: (
    chatId: string,
    payload: {
      type: 'text' | 'image' | 'voice' | 'file';
      text: string;
      mediaUrl?: string;
      fileId?: string;
      fileName?: string;
      fileMime?: string;
      fileSize?: number;
      voiceDurationSec?: number;
      replyTo?: ReplyTarget | null;
    },
  ) =>
    apiRequest<{
      message: ChatMessage;
      chat: ChatRoom;
      members: Record<string, ChatMemberState>;
      retention: RetentionStats;
    }>(`/api/chats/${encodeURIComponent(chatId)}/messages`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  editMessage: (chatId: string, messageId: string, text: string) =>
    apiRequest<{ message: ChatMessage }>(
      `/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ text }),
      },
    ),

  deleteMessage: (chatId: string, messageId: string) =>
    apiRequest<{ message: ChatMessage; retention: RetentionStats }>(
      `/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`,
      { method: 'DELETE' },
    ),

  toggleReaction: (chatId: string, messageId: string, emoji: string) =>
    apiRequest<{ reactionId: string; removed: boolean; reaction: MessageReaction | null }>(
      `/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/reactions`,
      {
        method: 'POST',
        body: JSON.stringify({ emoji }),
      },
    ),

  toggleStar: (params: { chatId: string; messageId: string; chatName: string }) =>
    apiRequest<{ starred: boolean; id?: string; item?: StarredMessageItem }>('/api/starred/toggle', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  runRetentionSweep: () =>
    apiRequest<{ result: PurgeSummary; retention: RetentionStats }>('/api/retention/sweep', {
      method: 'POST',
    }),

  wipeMyData: () =>
    apiRequest<{ result: PurgeSummary; retention: RetentionStats }>('/api/retention/wipe-my-data', {
      method: 'POST',
    }),
};

export type RealtimeEvent =
  | { type: 'connected'; uid: string; retentionHours: number; retentionMs: number }
  | { type: 'presence:updated'; uid: string; isOnline: boolean; lastSeenMs: number }
  | { type: 'profile:updated'; profile: UserProfile }
  | { type: 'chat:created'; chat: ChatRoom; members: Record<string, ChatMemberState> }
  | {
      type: 'message:created';
      message: ChatMessage;
      chat: ChatRoom;
      members: Record<string, ChatMemberState>;
    }
  | { type: 'message:updated'; message: ChatMessage }
  | { type: 'message:deleted'; message: ChatMessage }
  | { type: 'message:read'; chatId: string; userId: string; messageIds: string[]; readAtMs: number }
  | {
      type: 'reaction:toggled';
      chatId: string;
      messageId: string;
      reactionId: string;
      removed: boolean;
      reaction: MessageReaction | null;
    }
  | { type: 'member:updated'; member: ChatMemberState }
  | { type: 'member:typing'; chatId: string; userId: string; isTyping: boolean }
  | ({ type: 'retention:purged' } & PurgeSummary);

export interface RealtimeConnection {
  sendTyping: (chatId: string, isTyping: boolean) => void;
  close: () => void;
}

export function createRealtimeSocket(
  token: string,
  onEvent: (event: RealtimeEvent) => void,
  onReconnect: () => void,
): RealtimeConnection {
  let ws: WebSocket | null = null;
  let closedManually = false;
  let attempt = 0;
  let reconnectTimer: number | null = null;
  let hasConnectedOnce = false;

  const connect = () => {
    if (closedManually) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;

    try {
      ws = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      const reconnecting = hasConnectedOnce;
      hasConnectedOnce = true;
      attempt = 0;
      if (reconnecting) {
        onReconnect();
      }
    };

    ws.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(String(ev.data)) as RealtimeEvent;
        onEvent(parsed);
      } catch {
        // Ignore non-JSON frames
      }
    };

    ws.onclose = () => {
      ws = null;
      if (!closedManually) {
        scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // Let onclose drive reconnect backoff
    };
  };

  const scheduleReconnect = () => {
    if (closedManually || reconnectTimer !== null) return;
    const delay = Math.min(10_000, 800 * Math.pow(1.6, attempt));
    attempt += 1;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  connect();

  return {
    sendTyping(chatId: string, isTyping: boolean) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'typing', chatId, isTyping }));
      }
    },
    close() {
      closedManually = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        try {
          ws.close();
        } catch {
          // ignore
        }
        ws = null;
      }
    },
  };
}
