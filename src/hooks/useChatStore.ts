import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createDemoSeedState, DEMO_USER_ID, type DemoWorkspaceState } from '../data/demoSeed';
import {
  getStoredSessionToken,
  localApi,
  setStoredSessionToken,
  createRealtimeSocket,
  type PurgeSummary,
  type RealtimeConnection,
  type RealtimeEvent,
  type UploadResponse,
} from '../lib/localApi';
import type {
  AppMode,
  ChatMemberState,
  ChatMessage,
  ChatRoom,
  EnrichedChatItem,
  MessageReaction,
  MessageType,
  ReplyTarget,
  RetentionStats,
  StarredMessageItem,
  UserProfile,
  UserSettings,
} from '../types/chat';
import {
  formatAuthError,
  getDirectChatId,
  getUnreadMessagesForUser,
  LIMITS,
  markMessagesReadByUser,
  MAX_UPLOAD_BYTES,
  normalizePhoneNumber,
  RETENTION_HOURS,
  RETENTION_MS,
  truncateText,
  validateCompanyAuthForm,
  validateGroupForm,
  validateMessageInput,
  validatePhoneOtp,
  validateProfileForm,
} from '../utils/chatLogic';

const DEMO_STORAGE_KEY = 'ark_dm_demo_workspace_v2';

export interface SendMessagePayload {
  type: MessageType;
  text: string;
  mediaUrl?: string;
  fileId?: string;
  fileName?: string;
  fileMime?: string;
  fileSize?: number;
  voiceDurationSec?: number;
  replyTo?: ReplyTarget | null;
}

const DEFAULT_RETENTION: RetentionStats = {
  retentionHours: RETENTION_HOURS,
  activeChats: 0,
  activeMessages: 0,
  activeFiles: 0,
  totalFileBytes: 0,
  nextExpiryMs: null,
};

function loadDemoWorkspace(): DemoWorkspaceState {
  try {
    const raw = window.localStorage.getItem(DEMO_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DemoWorkspaceState;
      if (parsed && parsed.currentUser && Array.isArray(parsed.chats)) {
        return parsed;
      }
    }
  } catch {
    // Ignore invalid storage
  }
  return createDemoSeedState();
}

function saveDemoWorkspace(state: DemoWorkspaceState): void {
  try {
    window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors
  }
}

function computeDemoRetentionStats(state: DemoWorkspaceState): RetentionStats {
  let activeMessages = 0;
  let activeFiles = 0;
  let totalFileBytes = 0;
  let nextExpiryMs: number | null = null;

  const track = (val?: number) => {
    if (typeof val === 'number' && val > 0) {
      nextExpiryMs = nextExpiryMs === null ? val : Math.min(nextExpiryMs, val);
    }
  };

  for (const chat of state.chats) {
    track(chat.expiresAtMs ?? chat.lastMessageAtMs + RETENTION_MS);
    const msgs = state.messagesByChat[chat.id] ?? [];
    activeMessages += msgs.length;
    for (const m of msgs) {
      track(m.expiresAtMs ?? m.createdAtMs + RETENTION_MS);
      if (!m.deleted && (m.type === 'file' || m.type === 'image' || m.type === 'voice') && m.mediaUrl) {
        activeFiles += 1;
        totalFileBytes += m.fileSize || 0;
      }
    }
  }

  return {
    retentionHours: RETENTION_HOURS,
    activeChats: state.chats.length,
    activeMessages,
    activeFiles,
    totalFileBytes,
    nextExpiryMs,
  };
}

export function useChatStore() {
  const isAutostart = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.get('autostart') === '1';
  }, []);

  const [mode, setMode] = useState<AppMode>(isAutostart ? 'demo' : 'auth');
  const [authLoading, setAuthLoading] = useState<boolean>(!isAutostart);
  const [signingIn, setSigningIn] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [phoneOtpSentTo, setPhoneOtpSentTo] = useState<string | null>(null);
  const [localOtpHint, setLocalOtpHint] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(() => getStoredSessionToken());

  // Demo state
  const [demoState, setDemoState] = useState<DemoWorkspaceState>(() => loadDemoWorkspace());

  // Local server state
  const [localUser, setLocalUser] = useState<UserProfile | null>(null);
  const [localSettings, setLocalSettings] = useState<UserSettings | null>(null);
  const [localProfiles, setLocalProfiles] = useState<Record<string, UserProfile>>({});
  const [localChats, setLocalChats] = useState<ChatRoom[]>([]);
  const [localMembersByChat, setLocalMembersByChat] = useState<
    Record<string, Record<string, ChatMemberState>>
  >({});
  const [localMessagesByChat, setLocalMessagesByChat] = useState<Record<string, ChatMessage[]>>({});
  const [localReactionsByChat, setLocalReactionsByChat] = useState<
    Record<string, MessageReaction[]>
  >({});
  const [localStarred, setLocalStarred] = useState<StarredMessageItem[]>([]);
  const [localRetention, setLocalRetention] = useState<RetentionStats>(DEFAULT_RETENTION);

  // Shared UI selection state
  const [activeChatId, setActiveChatId] = useState<string | null>(
    isAutostart ? loadDemoWorkspace().chats[0]?.id ?? null : null,
  );
  const [actionError, setActionError] = useState<string | null>(null);

  const socketRef = useRef<RealtimeConnection | null>(null);
  const markingReadChatRef = useRef<string | null>(null);
  const activeChatIdRef = useRef<string | null>(activeChatId);
  activeChatIdRef.current = activeChatId;

  // Persist demo workspace on every change
  useEffect(() => {
    if (mode === 'demo') {
      saveDemoWorkspace(demoState);
    }
  }, [demoState, mode]);

  const hydrateLocalWorkspace = useCallback(async () => {
    const payload = await localApi.fetchWorkspace();
    setLocalUser(payload.currentUser);
    setLocalSettings(payload.settings);
    setLocalProfiles(payload.profiles);
    setLocalChats(payload.chats);
    setLocalMembersByChat(payload.membersByChat);
    setLocalMessagesByChat(payload.messagesByChat);
    setLocalReactionsByChat(payload.reactionsByChat);
    setLocalStarred(payload.starred);
    setLocalRetention(payload.retention);
    setActiveChatId((prev) => {
      if (prev && payload.chats.some((c) => c.id === prev)) return prev;
      return payload.chats[0]?.id ?? null;
    });
  }, []);

  // Bootstrap existing local session token on startup
  useEffect(() => {
    if (isAutostart) {
      setAuthLoading(false);
      return;
    }

    const token = getStoredSessionToken();
    if (!token) {
      setAuthLoading(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        await hydrateLocalWorkspace();
        if (!cancelled) {
          setSessionToken(token);
          setMode('local');
        }
      } catch {
        if (!cancelled) {
          setStoredSessionToken(null);
          setSessionToken(null);
          setMode('auth');
        }
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hydrateLocalWorkspace, isAutostart]);

  // Real-time WebSocket event handler (strictly idempotent)
  const handleRealtimeEvent = useCallback(
    (event: RealtimeEvent) => {
      switch (event.type) {
        case 'presence:updated': {
          setLocalProfiles((prev) => {
            const existing = prev[event.uid];
            if (!existing) return prev;
            return {
              ...prev,
              [event.uid]: {
                ...existing,
                isOnline: event.isOnline,
                lastSeenMs: event.lastSeenMs,
              },
            };
          });
          break;
        }

        case 'profile:updated': {
          setLocalProfiles((prev) => ({
            ...prev,
            [event.profile.uid]: event.profile,
          }));
          setLocalUser((prev) => (prev && prev.uid === event.profile.uid ? event.profile : prev));
          break;
        }

        case 'chat:created': {
          setLocalChats((prev) => {
            if (prev.some((c) => c.id === event.chat.id)) {
              return prev.map((c) => (c.id === event.chat.id ? event.chat : c));
            }
            return [event.chat, ...prev];
          });
          setLocalMembersByChat((prev) => ({
            ...prev,
            [event.chat.id]: {
              ...(prev[event.chat.id] ?? {}),
              ...event.members,
            },
          }));
          break;
        }

        case 'message:created': {
          setLocalChats((prev) => {
            const exists = prev.some((c) => c.id === event.chat.id);
            const next = exists
              ? prev.map((c) => (c.id === event.chat.id ? event.chat : c))
              : [event.chat, ...prev];
            return [...next].sort((a, b) => b.lastMessageAtMs - a.lastMessageAtMs);
          });
          setLocalMembersByChat((prev) => ({
            ...prev,
            [event.chat.id]: {
              ...(prev[event.chat.id] ?? {}),
              ...event.members,
            },
          }));
          setLocalMessagesByChat((prev) => {
            const existingList = prev[event.message.chatId] ?? [];
            if (existingList.some((m) => m.id === event.message.id)) {
              return prev;
            }
            return {
              ...prev,
              [event.message.chatId]: [...existingList, event.message],
            };
          });
          break;
        }

        case 'message:updated':
        case 'message:deleted': {
          setLocalMessagesByChat((prev) => {
            const list = prev[event.message.chatId];
            if (!list) return prev;
            return {
              ...prev,
              [event.message.chatId]: list.map((m) =>
                m.id === event.message.id ? event.message : m,
              ),
            };
          });
          break;
        }

        case 'message:read': {
          const msgSet = new Set(event.messageIds);
          setLocalMessagesByChat((prev) => {
            const list = prev[event.chatId];
            if (!list) return prev;
            return {
              ...prev,
              [event.chatId]: list.map((m) => {
                if (!msgSet.has(m.id) || m.readBy.includes(event.userId)) return m;
                return {
                  ...m,
                  readBy: [...m.readBy, event.userId],
                };
              }),
            };
          });
          setLocalMembersByChat((prev) => {
            const chatMembers = prev[event.chatId];
            if (!chatMembers || !chatMembers[event.userId]) return prev;
            return {
              ...prev,
              [event.chatId]: {
                ...chatMembers,
                [event.userId]: {
                  ...chatMembers[event.userId],
                  unreadCount: 0,
                  lastReadAtMs: event.readAtMs,
                },
              },
            };
          });
          break;
        }

        case 'reaction:toggled': {
          setLocalReactionsByChat((prev) => {
            const list = prev[event.chatId] ?? [];
            if (event.removed || !event.reaction) {
              return {
                ...prev,
                [event.chatId]: list.filter((r) => r.id !== event.reactionId),
              };
            }
            const exists = list.some((r) => r.id === event.reactionId);
            return {
              ...prev,
              [event.chatId]: exists
                ? list.map((r) => (r.id === event.reactionId ? event.reaction! : r))
                : [...list, event.reaction],
            };
          });
          break;
        }

        case 'member:updated': {
          setLocalMembersByChat((prev) => ({
            ...prev,
            [event.member.chatId]: {
              ...(prev[event.member.chatId] ?? {}),
              [event.member.userId]: event.member,
            },
          }));
          break;
        }

        case 'member:typing': {
          setLocalMembersByChat((prev) => {
            const chatMembers = prev[event.chatId];
            const member = chatMembers?.[event.userId];
            if (!chatMembers || !member) return prev;
            return {
              ...prev,
              [event.chatId]: {
                ...chatMembers,
                [event.userId]: {
                  ...member,
                  isTyping: event.isTyping,
                },
              },
            };
          });
          break;
        }

        case 'retention:purged': {
          const purgedChats = new Set(event.purgedChatIds);
          const purgedMsgs = new Set(event.purgedMessageIds);

          if (purgedChats.size > 0) {
            setLocalChats((prev) => prev.filter((c) => !purgedChats.has(c.id)));
            setActiveChatId((prev) => (prev && purgedChats.has(prev) ? null : prev));
          }
          if (purgedMsgs.size > 0 || purgedChats.size > 0) {
            setLocalMessagesByChat((prev) => {
              const next: Record<string, ChatMessage[]> = {};
              for (const [cid, list] of Object.entries(prev)) {
                if (purgedChats.has(cid)) continue;
                next[cid] = list.filter((m) => !purgedMsgs.has(m.id));
              }
              return next;
            });
            setLocalStarred((prev) =>
              prev.filter((s) => !purgedChats.has(s.chatId) && !purgedMsgs.has(s.messageId)),
            );
          }
          void hydrateLocalWorkspace().catch(() => {
            // Best-effort resync after retention sweep
          });
          break;
        }

        default:
          break;
      }
    },
    [hydrateLocalWorkspace],
  );

  // Connect & maintain WebSocket while signed in locally
  useEffect(() => {
    if (mode !== 'local' || !sessionToken) {
      socketRef.current?.close();
      socketRef.current = null;
      return;
    }

    const conn = createRealtimeSocket(
      sessionToken,
      handleRealtimeEvent,
      () => {
        void hydrateLocalWorkspace().catch(() => {
          // ignore transient reconnect sync errors
        });
      },
    );
    socketRef.current = conn;

    return () => {
      conn.close();
      if (socketRef.current === conn) {
        socketRef.current = null;
      }
    };
  }, [mode, sessionToken, handleRealtimeEvent, hydrateLocalWorkspace]);

  // Unified read-only data views (Local Server vs Demo)
  const currentUser: UserProfile = useMemo(() => {
    if (mode === 'demo') return demoState.currentUser;
    return (
      localUser ?? {
        uid: '',
        displayName: 'ARK Member',
        handle: 'ark_member',
        about: 'Available on ARK DM',
        photoURL: '',
        discoverable: true,
        isOnline: true,
        lastSeenMs: Date.now(),
      }
    );
  }, [mode, demoState.currentUser, localUser]);

  const settings: UserSettings = useMemo(() => {
    if (mode === 'demo') return demoState.settings;
    return (
      localSettings ?? {
        uid: currentUser.uid,
        email: '',
        theme: 'light',
        wallpaper: 'subtle',
        enterToSend: true,
      }
    );
  }, [mode, demoState.settings, localSettings, currentUser.uid]);

  const profiles = mode === 'demo' ? demoState.profiles : localProfiles;
  const chats = mode === 'demo' ? demoState.chats : localChats;
  const membersByChat = mode === 'demo' ? demoState.members : localMembersByChat;
  const messagesByChat = mode === 'demo' ? demoState.messagesByChat : localMessagesByChat;
  const reactionsByChat = mode === 'demo' ? demoState.reactionsByChat : localReactionsByChat;
  const starred = mode === 'demo' ? demoState.starred : localStarred;

  const retentionStats: RetentionStats = useMemo(() => {
    if (mode === 'demo') return computeDemoRetentionStats(demoState);
    return localRetention;
  }, [mode, demoState, localRetention]);

  const enrichedChats: EnrichedChatItem[] = useMemo(() => {
    return chats.map((chat) => {
      const chatMembers = membersByChat[chat.id] ?? {};
      const myMember = chatMembers[currentUser.uid];
      const otherUid =
        chat.type === 'direct'
          ? chat.participantIds.find((id) => id !== currentUser.uid) ?? currentUser.uid
          : undefined;
      const otherProfile = otherUid ? profiles[otherUid] : undefined;

      const displayName =
        chat.type === 'group'
          ? chat.name || 'Untitled Group'
          : otherProfile?.displayName || 'Saved Notes';
      const avatarUrl =
        chat.type === 'group' ? chat.avatarUrl : otherProfile?.photoURL || '';
      const isOnline = chat.type === 'direct' ? Boolean(otherProfile?.isOnline) : false;
      const lastSeenMs =
        chat.type === 'direct' ? otherProfile?.lastSeenMs ?? chat.lastMessageAtMs : chat.lastMessageAtMs;

      const typingNames = Object.values(chatMembers)
        .filter((m) => m.userId !== currentUser.uid && m.isTyping)
        .map((m) => profiles[m.userId]?.displayName || 'Someone');

      const chatMsgs = messagesByChat[chat.id] ?? [];
      const lastMsg = chatMsgs.length > 0 ? chatMsgs[chatMsgs.length - 1] : undefined;
      const lastMessageRead = lastMsg
        ? lastMsg.readBy.some((uid) => uid !== lastMsg.senderId)
        : Object.values(chatMembers).some(
            (m) => m.userId !== currentUser.uid && m.lastReadAtMs >= chat.lastMessageAtMs,
          );

      return {
        chat,
        displayName,
        subtitle:
          chat.type === 'group'
            ? `${chat.participantIds.length} members`
            : otherProfile?.about || 'Available on ARK DM',
        avatarUrl,
        isOnline,
        lastSeenMs,
        pinned: myMember?.pinned ?? false,
        muted: myMember?.muted ?? false,
        archived: myMember?.archived ?? false,
        unreadCount: myMember?.unreadCount ?? 0,
        lastMessageRead,
        typingNames,
        otherParticipant: otherProfile,
      };
    });
  }, [chats, membersByChat, messagesByChat, profiles, currentUser.uid]);

  const totalUnreadCount = useMemo(
    () =>
      enrichedChats.reduce((acc, item) => (item.archived ? acc : acc + item.unreadCount), 0),
    [enrichedChats],
  );

  // Auth actions (100% Local Server — no Firebase)
  const signInWithCompanyId = useCallback(
    async (params: {
      identifier: string;
      password: string;
      displayName?: string;
      mode: 'signin' | 'signup';
    }): Promise<boolean> => {
      if (signingIn) return false;
      const validationError = validateCompanyAuthForm(params);
      if (validationError) {
        setAuthError(validationError);
        return false;
      }

      setSigningIn(true);
      setAuthError(null);
      try {
        const res =
          params.mode === 'signup'
            ? await localApi.companySignup({
                identifier: params.identifier.trim(),
                password: params.password,
                displayName: (params.displayName || '').trim(),
              })
            : await localApi.companySignin({
                identifier: params.identifier.trim(),
                password: params.password,
              });

        setStoredSessionToken(res.token);
        setSessionToken(res.token);
        await hydrateLocalWorkspace();
        setMode('local');
        return true;
      } catch (err) {
        setAuthError(formatAuthError(err));
        return false;
      } finally {
        setSigningIn(false);
      }
    },
    [signingIn, hydrateLocalWorkspace],
  );

  const requestPhoneOtp = useCallback(
    async (rawPhone: string): Promise<boolean> => {
      if (signingIn) return false;
      const normalized = normalizePhoneNumber(rawPhone);
      if ('error' in normalized) {
        setAuthError(normalized.error);
        return false;
      }

      setSigningIn(true);
      setAuthError(null);
      try {
        const res = await localApi.requestPhoneOtp(normalized.e164);
        setPhoneOtpSentTo(res.phoneNumber);
        setLocalOtpHint(res.localOtpCode ?? null);
        return true;
      } catch (err) {
        setAuthError(formatAuthError(err));
        return false;
      } finally {
        setSigningIn(false);
      }
    },
    [signingIn],
  );

  const verifyPhoneOtp = useCallback(
    async (code: string, displayName?: string): Promise<boolean> => {
      if (signingIn) return false;
      if (!phoneOtpSentTo) {
        setAuthError('Request a verification code first.');
        return false;
      }
      const otpError = validatePhoneOtp(code);
      if (otpError) {
        setAuthError(otpError);
        return false;
      }

      setSigningIn(true);
      setAuthError(null);
      try {
        const res = await localApi.verifyPhoneOtp({
          phoneNumber: phoneOtpSentTo,
          code: code.trim(),
          displayName: displayName?.trim() || undefined,
        });
        setStoredSessionToken(res.token);
        setSessionToken(res.token);
        setPhoneOtpSentTo(null);
        setLocalOtpHint(null);
        await hydrateLocalWorkspace();
        setMode('local');
        return true;
      } catch (err) {
        setAuthError(formatAuthError(err));
        return false;
      } finally {
        setSigningIn(false);
      }
    },
    [signingIn, phoneOtpSentTo, hydrateLocalWorkspace],
  );

  const resetPhoneOtp = useCallback(() => {
    setPhoneOtpSentTo(null);
    setLocalOtpHint(null);
    setAuthError(null);
  }, []);

  const clearAuthError = useCallback(() => {
    setAuthError(null);
  }, []);

  const enterDemoMode = useCallback(() => {
    setAuthError(null);
    setMode('demo');
    setActiveChatId((prev) => prev ?? demoState.chats[0]?.id ?? null);
  }, [demoState.chats]);

  const exitToAuth = useCallback(() => {
    setAuthError(null);
    setMode('auth');
    setActiveChatId(null);
  }, []);

  const logout = useCallback(async () => {
    if (mode === 'demo') {
      exitToAuth();
      return;
    }
    try {
      await localApi.logout();
    } catch {
      // ignore if token already cleared
    }
    socketRef.current?.close();
    socketRef.current = null;
    setStoredSessionToken(null);
    setSessionToken(null);
    setLocalUser(null);
    setLocalSettings(null);
    setLocalChats([]);
    setLocalMembersByChat({});
    setLocalMessagesByChat({});
    setLocalReactionsByChat({});
    setLocalStarred([]);
    setActiveChatId(null);
    setMode('auth');
  }, [mode, exitToAuth]);

  const resetDemoWorkspace = useCallback(() => {
    const fresh = createDemoSeedState();
    setDemoState(fresh);
    setActiveChatId(fresh.chats[0]?.id ?? null);
  }, []);

  // Mark chat read automatically whenever active conversation has unread incoming messages
  const markChatRead = useCallback(
    async (chatId: string) => {
      if (mode === 'demo') {
        const now = Date.now();
        setDemoState((prev) => {
          const chatMembers = prev.members[chatId];
          const myMember = chatMembers?.[DEMO_USER_ID];
          const currentMsgs = prev.messagesByChat[chatId] ?? [];
          const nextMsgs = markMessagesReadByUser(currentMsgs, DEMO_USER_ID);
          const hasUnreadCount = Boolean(myMember && myMember.unreadCount > 0);
          if (!hasUnreadCount && nextMsgs === currentMsgs) return prev;
          return {
            ...prev,
            members: {
              ...prev.members,
              [chatId]: {
                ...(chatMembers ?? {}),
                ...(myMember ? { [DEMO_USER_ID]: { ...myMember, unreadCount: 0, lastReadAtMs: now } } : {}),
              },
            },
            messagesByChat: {
              ...prev.messagesByChat,
              [chatId]: nextMsgs,
            },
          };
        });
        return;
      }

      if (mode !== 'local' || !currentUser.uid) return;
      if (markingReadChatRef.current === chatId) return;
      markingReadChatRef.current = chatId;

      try {
        const res = await localApi.markChatRead(chatId);
        const now = Date.now();
        const updatedSet = new Set(res.updatedMessageIds);
        setLocalMembersByChat((prev) => {
          const chatMembers = prev[chatId];
          const myMember = chatMembers?.[currentUser.uid];
          if (!chatMembers || !myMember) return prev;
          return {
            ...prev,
            [chatId]: {
              ...chatMembers,
              [currentUser.uid]: {
                ...myMember,
                unreadCount: 0,
                lastReadAtMs: now,
              },
            },
          };
        });
        if (updatedSet.size > 0) {
          setLocalMessagesByChat((prev) => {
            const list = prev[chatId] ?? [];
            return {
              ...prev,
              [chatId]: list.map((m) =>
                updatedSet.has(m.id) && !m.readBy.includes(currentUser.uid)
                  ? { ...m, readBy: [...m.readBy, currentUser.uid] }
                  : m,
              ),
            };
          });
        }
      } catch {
        // Ignore transient read receipt failures
      } finally {
        if (markingReadChatRef.current === chatId) {
          markingReadChatRef.current = null;
        }
      }
    },
    [mode, currentUser.uid],
  );

  useEffect(() => {
    if (!activeChatId || mode === 'auth') return;
    const activeMsgs = messagesByChat[activeChatId] ?? [];
    const unreadIncoming = getUnreadMessagesForUser(activeMsgs, currentUser.uid);
    const myMember = membersByChat[activeChatId]?.[currentUser.uid];
    if (unreadIncoming.length > 0 || (myMember && myMember.unreadCount > 0)) {
      void markChatRead(activeChatId);
    }
  }, [activeChatId, mode, messagesByChat, membersByChat, currentUser.uid, markChatRead]);

  const selectChat = useCallback(
    (chatId: string) => {
      setActiveChatId(chatId);
      void markChatRead(chatId);
    },
    [markChatRead],
  );

  // Upload any attachment (photo, document, voice blob) to local server disk (./data/uploads/)
  const uploadAttachment = useCallback(
    async (chatId: string, file: File | Blob, fallbackName?: string): Promise<UploadResponse> => {
      if (file.size > MAX_UPLOAD_BYTES) {
        throw new Error('File exceeds the 15 MB limit.');
      }

      if (mode === 'local') {
        return localApi.uploadFile(file, chatId, fallbackName);
      }

      // Demo mode preview fallback
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Could not read file.'));
        reader.readAsDataURL(file);
      });
      const fileName = file instanceof File ? file.name : fallbackName || 'attachment';
      const fileMime = file.type || 'application/octet-stream';
      return {
        fileId: `demo_file_${Date.now()}`,
        url: dataUrl,
        fileName,
        fileMime,
        fileSize: file.size,
        expiresAtMs: Date.now() + RETENTION_MS,
      };
    },
    [mode],
  );

  // Send message (text, image, voice, or file)
  const sendMessage = useCallback(
    async (chatId: string, payload: SendMessagePayload) => {
      const hasMedia = Boolean(
        payload.mediaUrl || payload.fileId || payload.type === 'voice' || payload.type === 'file',
      );
      const err = validateMessageInput(payload.text, hasMedia);
      if (err) {
        setActionError(err);
        return;
      }

      const trimmedText = truncateText(payload.text.trim(), LIMITS.MESSAGE_TEXT_MAX);
      const previewText = truncateText(
        payload.type === 'image'
          ? trimmedText || 'Photo'
          : payload.type === 'voice'
            ? `Voice note (${payload.voiceDurationSec || 1}s)`
            : payload.type === 'file'
              ? trimmedText || `File: ${payload.fileName || 'Attachment'}`
              : trimmedText,
        LIMITS.LAST_MESSAGE_MAX,
      );

      if (mode === 'demo') {
        const now = Date.now();
        const chat = demoState.chats.find((c) => c.id === chatId);
        if (!chat) return;
        const msgId = `msg_${now}_${Math.random().toString(36).slice(2, 7)}`;
        const newMsg: ChatMessage = {
          id: msgId,
          chatId,
          senderId: DEMO_USER_ID,
          senderName: demoState.currentUser.displayName,
          participantIds: chat.participantIds,
          type: payload.type,
          text: trimmedText,
          mediaUrl: payload.mediaUrl || '',
          fileId: payload.fileId || '',
          fileName: payload.fileName || '',
          fileMime: payload.fileMime || '',
          fileSize: payload.fileSize || 0,
          voiceDurationSec: payload.voiceDurationSec || 0,
          replyToId: payload.replyTo?.messageId || '',
          replyToSender: payload.replyTo?.senderName || '',
          replyToText: truncateText(payload.replyTo?.text || '', LIMITS.REPLY_PREVIEW_MAX),
          edited: false,
          deleted: false,
          readBy: [DEMO_USER_ID],
          createdAtMs: now,
          updatedAtMs: now,
          expiresAtMs: now + RETENTION_MS,
        };

        setDemoState((prev) => ({
          ...prev,
          chats: prev.chats.map((c) =>
            c.id === chatId
              ? {
                  ...c,
                  lastMessageText: previewText,
                  lastMessageSenderId: DEMO_USER_ID,
                  lastMessageAtMs: now,
                  updatedAtMs: now,
                  expiresAtMs: now + RETENTION_MS,
                }
              : c,
          ),
          messagesByChat: {
            ...prev.messagesByChat,
            [chatId]: [...(prev.messagesByChat[chatId] ?? []), newMsg],
          },
        }));
        return;
      }

      if (mode !== 'local') return;
      try {
        const res = await localApi.sendMessage(chatId, {
          type: payload.type,
          text: trimmedText,
          mediaUrl: payload.mediaUrl,
          fileId: payload.fileId,
          fileName: payload.fileName,
          fileMime: payload.fileMime,
          fileSize: payload.fileSize,
          voiceDurationSec: payload.voiceDurationSec,
          replyTo: payload.replyTo,
        });

        setLocalChats((prev) => {
          const exists = prev.some((c) => c.id === res.chat.id);
          const next = exists
            ? prev.map((c) => (c.id === res.chat.id ? res.chat : c))
            : [res.chat, ...prev];
          return [...next].sort((a, b) => b.lastMessageAtMs - a.lastMessageAtMs);
        });
        setLocalMembersByChat((prev) => ({
          ...prev,
          [res.chat.id]: {
            ...(prev[res.chat.id] ?? {}),
            ...res.members,
          },
        }));
        setLocalMessagesByChat((prev) => {
          const existingList = prev[chatId] ?? [];
          if (existingList.some((m) => m.id === res.message.id)) return prev;
          return {
            ...prev,
            [chatId]: [...existingList, res.message],
          };
        });
        setLocalRetention(res.retention);
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Could not send message.');
      }
    },
    [mode, demoState.chats, demoState.currentUser.displayName],
  );

  // Edit own message
  const editMessage = useCallback(
    async (chatId: string, messageId: string, newText: string) => {
      const err = validateMessageInput(newText, false);
      if (err) {
        setActionError(err);
        return;
      }
      const trimmed = truncateText(newText.trim(), LIMITS.MESSAGE_TEXT_MAX);

      if (mode === 'demo') {
        const now = Date.now();
        setDemoState((prev) => ({
          ...prev,
          messagesByChat: {
            ...prev.messagesByChat,
            [chatId]: (prev.messagesByChat[chatId] ?? []).map((m) =>
              m.id === messageId ? { ...m, text: trimmed, edited: true, updatedAtMs: now } : m,
            ),
          },
        }));
        return;
      }

      if (mode !== 'local') return;
      try {
        const res = await localApi.editMessage(chatId, messageId, trimmed);
        setLocalMessagesByChat((prev) => ({
          ...prev,
          [chatId]: (prev[chatId] ?? []).map((m) => (m.id === messageId ? res.message : m)),
        }));
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Could not edit message.');
      }
    },
    [mode],
  );

  // Soft-delete own message (and immediately delete any server disk file)
  const deleteMessage = useCallback(
    async (chatId: string, messageId: string) => {
      if (mode === 'demo') {
        const now = Date.now();
        setDemoState((prev) => ({
          ...prev,
          messagesByChat: {
            ...prev.messagesByChat,
            [chatId]: (prev.messagesByChat[chatId] ?? []).map((m) =>
              m.id === messageId
                ? {
                    ...m,
                    deleted: true,
                    text: '',
                    mediaUrl: '',
                    fileId: '',
                    fileName: '',
                    fileSize: 0,
                    updatedAtMs: now,
                  }
                : m,
            ),
          },
        }));
        return;
      }

      if (mode !== 'local') return;
      try {
        const res = await localApi.deleteMessage(chatId, messageId);
        setLocalMessagesByChat((prev) => ({
          ...prev,
          [chatId]: (prev[chatId] ?? []).map((m) => (m.id === messageId ? res.message : m)),
        }));
        setLocalRetention(res.retention);
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Could not delete message.');
      }
    },
    [mode],
  );

  // Toggle emoji reaction
  const toggleReaction = useCallback(
    async (chatId: string, messageId: string, emoji: string) => {
      if (mode === 'demo') {
        const now = Date.now();
        const reactionId = `${messageId}_${DEMO_USER_ID}`;
        setDemoState((prev) => {
          const list = prev.reactionsByChat[chatId] ?? [];
          const existing = list.find((r) => r.id === reactionId);
          let nextList: MessageReaction[];
          if (existing && existing.emoji === emoji) {
            nextList = list.filter((r) => r.id !== reactionId);
          } else if (existing) {
            nextList = list.map((r) =>
              r.id === reactionId ? { ...r, emoji, createdAtMs: now } : r,
            );
          } else {
            nextList = [
              ...list,
              { id: reactionId, chatId, messageId, userId: DEMO_USER_ID, emoji, createdAtMs: now },
            ];
          }
          return {
            ...prev,
            reactionsByChat: { ...prev.reactionsByChat, [chatId]: nextList },
          };
        });
        return;
      }

      if (mode !== 'local') return;
      try {
        const res = await localApi.toggleReaction(chatId, messageId, emoji);
        setLocalReactionsByChat((prev) => {
          const list = prev[chatId] ?? [];
          if (res.removed || !res.reaction) {
            return { ...prev, [chatId]: list.filter((r) => r.id !== res.reactionId) };
          }
          const exists = list.some((r) => r.id === res.reactionId);
          return {
            ...prev,
            [chatId]: exists
              ? list.map((r) => (r.id === res.reactionId ? res.reaction! : r))
              : [...list, res.reaction],
          };
        });
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Could not update reaction.');
      }
    },
    [mode],
  );

  // Star / unstar message
  const toggleStar = useCallback(
    async (chatName: string, message: ChatMessage) => {
      if (mode === 'demo') {
        setDemoState((prev) => {
          const exists = prev.starred.some((s) => s.messageId === message.id);
          if (exists) {
            return { ...prev, starred: prev.starred.filter((s) => s.messageId !== message.id) };
          }
          const newStar: StarredMessageItem = {
            id: message.id,
            userId: DEMO_USER_ID,
            chatId: message.chatId,
            messageId: message.id,
            chatName,
            senderName: message.senderName,
            text:
              message.text ||
              (message.type === 'image'
                ? 'Photo'
                : message.type === 'file'
                  ? `File: ${message.fileName || 'Attachment'}`
                  : 'Voice note'),
            createdAtMs: Date.now(),
          };
          return { ...prev, starred: [newStar, ...prev.starred] };
        });
        return;
      }

      if (mode !== 'local') return;
      try {
        const res = await localApi.toggleStar({
          chatId: message.chatId,
          messageId: message.id,
          chatName,
        });
        if (res.starred && res.item) {
          setLocalStarred((prev) => [res.item!, ...prev.filter((s) => s.messageId !== message.id)]);
        } else {
          setLocalStarred((prev) => prev.filter((s) => s.messageId !== message.id));
        }
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Could not update starred message.');
      }
    },
    [mode],
  );

  // Pin / Mute / Archive
  const updateMemberFlag = useCallback(
    async (chatId: string, field: 'pinned' | 'muted' | 'archived', value: boolean) => {
      if (mode === 'demo') {
        setDemoState((prev) => {
          const chatMembers = prev.members[chatId] ?? {};
          const existing = chatMembers[DEMO_USER_ID];
          if (!existing) return prev;
          return {
            ...prev,
            members: {
              ...prev.members,
              [chatId]: {
                ...chatMembers,
                [DEMO_USER_ID]: { ...existing, [field]: value },
              },
            },
          };
        });
        return;
      }

      if (mode !== 'local') return;
      try {
        const res = await localApi.updateMember(chatId, { [field]: value });
        setLocalMembersByChat((prev) => ({
          ...prev,
          [chatId]: {
            ...(prev[chatId] ?? {}),
            [res.member.userId]: res.member,
          },
        }));
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Could not update conversation setting.');
      }
    },
    [mode],
  );

  // Typing indicator over WebSocket
  const setTypingStatus = useCallback(
    async (chatId: string, isTyping: boolean) => {
      if (mode !== 'local') return;
      socketRef.current?.sendTyping(chatId, isTyping);
    },
    [mode],
  );

  // Start direct chat
  const startDirectChat = useCallback(
    async (targetUid: string): Promise<string | null> => {
      if (mode === 'demo') {
        const chatId = getDirectChatId(DEMO_USER_ID, targetUid);
        const existing = demoState.chats.find((c) => c.id === chatId);
        if (existing) {
          setActiveChatId(existing.id);
          return existing.id;
        }
        const now = Date.now();
        const participants = Array.from(new Set([DEMO_USER_ID, targetUid]));
        const newChat: ChatRoom = {
          id: chatId,
          type: 'direct',
          name: '',
          description: '',
          avatarUrl: '',
          createdBy: DEMO_USER_ID,
          participantIds: participants,
          lastMessageText: '',
          lastMessageSenderId: '',
          lastMessageAtMs: now,
          createdAtMs: now,
          updatedAtMs: now,
          expiresAtMs: now + RETENTION_MS,
        };
        setDemoState((prev) => ({
          ...prev,
          chats: [newChat, ...prev.chats],
          members: {
            ...prev.members,
            [chatId]: Object.fromEntries(
              participants.map((uid) => [
                uid,
                {
                  chatId,
                  userId: uid,
                  role: uid === DEMO_USER_ID ? 'admin' : 'member',
                  pinned: false,
                  muted: false,
                  archived: false,
                  unreadCount: 0,
                  isTyping: false,
                  lastReadAtMs: now,
                },
              ]),
            ),
          },
          messagesByChat: { ...prev.messagesByChat, [chatId]: [] },
        }));
        setActiveChatId(chatId);
        return chatId;
      }

      if (mode !== 'local') return null;
      try {
        const res = await localApi.startDirectChat(targetUid);
        setLocalChats((prev) => {
          if (prev.some((c) => c.id === res.chat.id)) return prev;
          return [res.chat, ...prev];
        });
        setLocalMembersByChat((prev) => ({
          ...prev,
          [res.chat.id]: {
            ...(prev[res.chat.id] ?? {}),
            ...res.members,
          },
        }));
        setActiveChatId(res.chat.id);
        return res.chat.id;
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Could not start conversation.');
        return null;
      }
    },
    [mode, demoState.chats],
  );

  // Create group chat
  const createGroupChat = useCallback(
    async (name: string, description: string, selectedMemberIds: string[]): Promise<string | null> => {
      const err = validateGroupForm(name, description, selectedMemberIds);
      if (err) {
        setActionError(err);
        return null;
      }
      const cleanName = truncateText(name.trim(), LIMITS.GROUP_NAME_MAX);
      const cleanDesc = truncateText(description.trim(), LIMITS.GROUP_DESC_MAX);

      if (mode === 'demo') {
        const now = Date.now();
        const chatId = `grp_${now}_${Math.random().toString(36).slice(2, 6)}`;
        const participants = Array.from(new Set([DEMO_USER_ID, ...selectedMemberIds])).slice(
          0,
          LIMITS.MAX_PARTICIPANTS,
        );
        const newChat: ChatRoom = {
          id: chatId,
          type: 'group',
          name: cleanName,
          description: cleanDesc,
          avatarUrl: '',
          createdBy: DEMO_USER_ID,
          participantIds: participants,
          lastMessageText: 'Group created',
          lastMessageSenderId: DEMO_USER_ID,
          lastMessageAtMs: now,
          createdAtMs: now,
          updatedAtMs: now,
          expiresAtMs: now + RETENTION_MS,
        };
        setDemoState((prev) => ({
          ...prev,
          chats: [newChat, ...prev.chats],
          members: {
            ...prev.members,
            [chatId]: Object.fromEntries(
              participants.map((uid) => [
                uid,
                {
                  chatId,
                  userId: uid,
                  role: uid === DEMO_USER_ID ? 'admin' : 'member',
                  pinned: false,
                  muted: false,
                  archived: false,
                  unreadCount: 0,
                  isTyping: false,
                  lastReadAtMs: now,
                },
              ]),
            ),
          },
          messagesByChat: { ...prev.messagesByChat, [chatId]: [] },
        }));
        setActiveChatId(chatId);
        return chatId;
      }

      if (mode !== 'local') return null;
      try {
        const res = await localApi.createGroupChat({
          name: cleanName,
          description: cleanDesc,
          memberIds: selectedMemberIds,
        });
        setLocalChats((prev) => [res.chat, ...prev.filter((c) => c.id !== res.chat.id)]);
        setLocalMembersByChat((prev) => ({
          ...prev,
          [res.chat.id]: res.members,
        }));
        setActiveChatId(res.chat.id);
        return res.chat.id;
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Could not create group.');
        return null;
      }
    },
    [mode],
  );

  // Update profile
  const updateProfile = useCallback(
    async (updates: { displayName: string; handle: string; about: string }) => {
      const err = validateProfileForm(updates.displayName, updates.handle, updates.about);
      if (err) {
        setActionError(err);
        return;
      }
      const clean = {
        displayName: truncateText(updates.displayName.trim(), LIMITS.DISPLAY_NAME_MAX),
        handle: truncateText(updates.handle.trim().toLowerCase(), LIMITS.HANDLE_MAX),
        about: truncateText(updates.about.trim(), LIMITS.ABOUT_MAX),
      };

      if (mode === 'demo') {
        setDemoState((prev) => {
          const updated = { ...prev.currentUser, ...clean };
          return {
            ...prev,
            currentUser: updated,
            profiles: { ...prev.profiles, [DEMO_USER_ID]: updated },
          };
        });
        return;
      }

      if (mode !== 'local') return;
      try {
        const res = await localApi.updateProfile(clean);
        setLocalUser(res.user);
        setLocalProfiles((prev) => ({ ...prev, [res.user.uid]: res.user }));
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Could not update profile.');
      }
    },
    [mode],
  );

  // Update settings
  const updateSettings = useCallback(
    async (updates: Partial<Pick<UserSettings, 'theme' | 'wallpaper' | 'enterToSend'>>) => {
      if (mode === 'demo') {
        setDemoState((prev) => ({
          ...prev,
          settings: { ...prev.settings, ...updates },
        }));
        return;
      }

      if (mode !== 'local') return;
      setLocalSettings((prev) => (prev ? { ...prev, ...updates } : prev));
      try {
        const res = await localApi.updateSettings(updates);
        setLocalSettings(res.settings);
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Could not save settings.');
      }
    },
    [mode],
  );

  // Run 48h retention cleanup on demand
  const runRetentionSweep = useCallback(async (): Promise<PurgeSummary | null> => {
    if (mode === 'demo') {
      const now = Date.now();
      const purgedChatIds: string[] = [];
      const purgedMessageIds: string[] = [];
      setDemoState((prev) => {
        const survivingChats = prev.chats.filter((c) => {
          const exp = c.expiresAtMs ?? c.lastMessageAtMs + RETENTION_MS;
          if (exp <= now) {
            purgedChatIds.push(c.id);
            return false;
          }
          return true;
        });
        const nextMessages: Record<string, ChatMessage[]> = {};
        for (const c of survivingChats) {
          nextMessages[c.id] = (prev.messagesByChat[c.id] ?? []).filter((m) => {
            const exp = m.expiresAtMs ?? m.createdAtMs + RETENTION_MS;
            if (exp <= now) {
              purgedMessageIds.push(m.id);
              return false;
            }
            return true;
          });
        }
        return {
          ...prev,
          chats: survivingChats,
          messagesByChat: nextMessages,
        };
      });
      return {
        purgedChatIds,
        purgedMessageIds,
        purgedFileIds: [],
        deletedDiskFiles: [],
        updatedChatIds: [],
        purgedAtMs: now,
      };
    }

    if (mode !== 'local') return null;
    try {
      const res = await localApi.runRetentionSweep();
      setLocalRetention(res.retention);
      await hydrateLocalWorkspace();
      return res.result;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not run cleanup.');
      return null;
    }
  }, [mode, hydrateLocalWorkspace]);

  // Wipe all user chats & files immediately from DB & local server disk
  const wipeMyData = useCallback(async (): Promise<PurgeSummary | null> => {
    if (mode === 'demo') {
      const now = Date.now();
      setDemoState((prev) => ({
        ...prev,
        chats: [],
        members: {},
        messagesByChat: {},
        reactionsByChat: {},
        starred: [],
      }));
      setActiveChatId(null);
      return {
        purgedChatIds: [],
        purgedMessageIds: [],
        purgedFileIds: [],
        deletedDiskFiles: [],
        updatedChatIds: [],
        purgedAtMs: now,
      };
    }

    if (mode !== 'local') return null;
    try {
      const res = await localApi.wipeMyData();
      setLocalChats([]);
      setLocalMembersByChat({});
      setLocalMessagesByChat({});
      setLocalReactionsByChat({});
      setLocalStarred([]);
      setLocalRetention(res.retention);
      setActiveChatId(null);
      return res.result;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not delete data.');
      return null;
    }
  }, [mode]);

  return {
    mode,
    authLoading,
    signingIn,
    authError,
    phoneOtpSentTo,
    localOtpHint,
    actionError,
    clearActionError: () => setActionError(null),
    clearAuthError,
    currentUser,
    settings,
    profiles,
    enrichedChats,
    messagesByChat,
    reactionsByChat,
    starred,
    retentionStats,
    activeChatId,
    totalUnreadCount,
    selectChat,
    signInWithCompanyId,
    requestPhoneOtp,
    verifyPhoneOtp,
    resetPhoneOtp,
    enterDemoMode,
    exitToAuth,
    logout,
    resetDemoWorkspace,
    uploadAttachment,
    sendMessage,
    editMessage,
    deleteMessage,
    toggleReaction,
    toggleStar,
    updateMemberFlag,
    setTypingStatus,
    startDirectChat,
    createGroupChat,
    updateProfile,
    updateSettings,
    runRetentionSweep,
    wipeMyData,
  };
}
