import type {
  AggregatedReaction,
  ChatFilter,
  ChatMessage,
  EnrichedChatItem,
  MessageDateGroup,
  MessageReaction,
  UserProfile,
} from '../types/chat';

// Synchronized validation and 48-hour auto-delete retention constants
export const RETENTION_HOURS = 48;
export const RETENTION_MS = RETENTION_HOURS * 60 * 60 * 1000;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB

export const LIMITS = {
  ID_MAX: 128,
  DISPLAY_NAME_MIN: 1,
  DISPLAY_NAME_MAX: 80,
  HANDLE_MIN: 2,
  HANDLE_MAX: 40,
  ABOUT_MAX: 160,
  GROUP_NAME_MIN: 1,
  GROUP_NAME_MAX: 80,
  GROUP_DESC_MAX: 240,
  MESSAGE_TEXT_MAX: 2000,
  LAST_MESSAGE_MAX: 500,
  REPLY_PREVIEW_MAX: 240,
  MAX_PARTICIPANTS: 20,
  MEDIA_URL_MAX: 150000,
  VOICE_DURATION_MAX: 600,
} as const;

export const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
export const HANDLE_PATTERN = /^[a-z0-9._-]+$/;

export const QUICK_REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '🙏', '🔥'] as const;

export const PICKER_EMOJIS = [
  '😀', '😊', '😂', '🥰', '😎', '🤔', '🙌', '👏',
  '👍', '❤️', '🔥', '✨', '🎉', '🚀', '☕', '📌',
  '✅', '⚡', '🎯', '💡', '🙏', '👋', '🤝', '💬',
] as const;

export function sanitizeHandle(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, LIMITS.HANDLE_MAX);
  return cleaned.length >= LIMITS.HANDLE_MIN ? cleaned : `user_${cleaned || 'ark'}`;
}

export function getDirectChatId(uidA: string, uidB: string): string {
  const sorted = [uidA, uidB].sort();
  return `dm_${sorted[0]}_${sorted[1]}`.slice(0, LIMITS.ID_MAX);
}

export function validateMessageInput(text: string, hasMedia: boolean): string | null {
  const trimmed = text.trim();
  if (!hasMedia && trimmed.length === 0) {
    return 'Enter a message before sending.';
  }
  if (trimmed.length > LIMITS.MESSAGE_TEXT_MAX) {
    return `Message cannot exceed ${LIMITS.MESSAGE_TEXT_MAX} characters.`;
  }
  return null;
}

export function validateGroupForm(
  name: string,
  description: string,
  selectedMemberIds: string[],
): string | null {
  const trimmedName = name.trim();
  if (trimmedName.length < LIMITS.GROUP_NAME_MIN) {
    return 'Enter a group name.';
  }
  if (trimmedName.length > LIMITS.GROUP_NAME_MAX) {
    return `Group name cannot exceed ${LIMITS.GROUP_NAME_MAX} characters.`;
  }
  if (description.trim().length > LIMITS.GROUP_DESC_MAX) {
    return `Description cannot exceed ${LIMITS.GROUP_DESC_MAX} characters.`;
  }
  if (selectedMemberIds.length === 0) {
    return 'Select at least one participant to create a group.';
  }
  if (selectedMemberIds.length + 1 > LIMITS.MAX_PARTICIPANTS) {
    return `Groups support up to ${LIMITS.MAX_PARTICIPANTS} participants.`;
  }
  return null;
}

export function validateProfileForm(
  displayName: string,
  handle: string,
  about: string,
): string | null {
  const name = displayName.trim();
  const cleanHandle = handle.trim().toLowerCase();
  if (name.length < LIMITS.DISPLAY_NAME_MIN) {
    return 'Display name is required.';
  }
  if (name.length > LIMITS.DISPLAY_NAME_MAX) {
    return `Display name cannot exceed ${LIMITS.DISPLAY_NAME_MAX} characters.`;
  }
  if (cleanHandle.length < LIMITS.HANDLE_MIN || cleanHandle.length > LIMITS.HANDLE_MAX) {
    return `Handle must be between ${LIMITS.HANDLE_MIN} and ${LIMITS.HANDLE_MAX} characters.`;
  }
  if (!HANDLE_PATTERN.test(cleanHandle)) {
    return 'Handle may only use lowercase letters, numbers, dots, underscores, or hyphens.';
  }
  if (about.trim().length > LIMITS.ABOUT_MAX) {
    return `About cannot exceed ${LIMITS.ABOUT_MAX} characters.`;
  }
  return null;
}

export function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen);
}

export function filterAndSortChats(
  items: EnrichedChatItem[],
  filter: ChatFilter,
  searchQuery: string,
  profilesById?: Record<string, UserProfile>,
): EnrichedChatItem[] {
  const q = searchQuery.trim().toLowerCase();

  const filtered = items.filter((item) => {
    if (filter === 'archived') {
      if (!item.archived) return false;
    } else {
      if (item.archived) return false;
      if (filter === 'unread' && item.unreadCount <= 0) return false;
      if (filter === 'groups' && item.chat.type !== 'group') return false;
    }

    if (!q) return true;

    if (item.displayName.toLowerCase().includes(q)) return true;
    if (item.chat.lastMessageText.toLowerCase().includes(q)) return true;
    if (item.otherParticipant?.handle.toLowerCase().includes(q)) return true;
    if (profilesById && item.chat.type === 'group') {
      return item.chat.participantIds.some((uid) => {
        const p = profilesById[uid];
        return p ? p.displayName.toLowerCase().includes(q) : false;
      });
    }
    return false;
  });

  return [...filtered].sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }
    return b.chat.lastMessageAtMs - a.chat.lastMessageAtMs;
  });
}

export function aggregateReactions(
  reactions: MessageReaction[],
  currentUserId: string,
): AggregatedReaction[] {
  const map = new Map<string, { count: number; reactedByMe: boolean; userIds: string[] }>();

  for (const r of reactions) {
    const existing = map.get(r.emoji);
    if (existing) {
      existing.count += 1;
      existing.userIds.push(r.userId);
      if (r.userId === currentUserId) existing.reactedByMe = true;
    } else {
      map.set(r.emoji, {
        count: 1,
        reactedByMe: r.userId === currentUserId,
        userIds: [r.userId],
      });
    }
  }

  return Array.from(map.entries()).map(([emoji, info]) => ({
    emoji,
    count: info.count,
    reactedByMe: info.reactedByMe,
    userIds: info.userIds,
  }));
}

export function getDayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatDateDivider(ms: number, nowMs: number = Date.now()): string {
  const target = new Date(ms);
  const now = new Date(nowMs);
  const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  const todayDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diffDays = Math.round((todayDay - targetDay) / 86_400_000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays > 1 && diffDays < 7) {
    return target.toLocaleDateString('en-US', { weekday: 'long' });
  }
  return target.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: target.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

export function groupMessagesByDate(
  messages: ChatMessage[],
  nowMs: number = Date.now(),
): MessageDateGroup[] {
  const sorted = [...messages].sort((a, b) => a.createdAtMs - b.createdAtMs);
  const groups: MessageDateGroup[] = [];

  for (const msg of sorted) {
    const key = getDayKey(msg.createdAtMs);
    const last = groups[groups.length - 1];
    if (last && last.dateKey === key) {
      last.messages.push(msg);
    } else {
      groups.push({
        dateKey: key,
        label: formatDateDivider(msg.createdAtMs, nowMs),
        messages: [msg],
      });
    }
  }

  return groups;
}

export function formatMessageTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatChatListTime(ms: number, nowMs: number = Date.now()): string {
  const target = new Date(ms);
  const now = new Date(nowMs);
  const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  const todayDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diffDays = Math.round((todayDay - targetDay) / 86_400_000);

  if (diffDays === 0) {
    return formatMessageTime(ms);
  }
  if (diffDays === 1) {
    return 'Yesterday';
  }
  if (diffDays > 1 && diffDays < 7) {
    return target.toLocaleDateString('en-US', { weekday: 'short' });
  }
  return target.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatLastSeen(lastSeenMs: number, isOnline: boolean, nowMs: number = Date.now()): string {
  if (isOnline) return 'Online';
  const diffMin = Math.max(1, Math.floor((nowMs - lastSeenMs) / 60_000));
  if (diffMin < 60) return `Last seen ${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `Last seen ${diffHr}h ago`;
  return `Last seen ${formatChatListTime(lastSeenMs, nowMs)}`;
}

export function formatVoiceDuration(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatTimeRemaining(expiresAtMs?: number | null, nowMs: number = Date.now()): string {
  if (!expiresAtMs || !Number.isFinite(expiresAtMs)) return `${RETENTION_HOURS}h auto-delete`;
  const remainingMs = expiresAtMs - nowMs;
  if (remainingMs <= 0) return 'Expiring now';
  const totalMinutes = Math.ceil(remainingMs / 60_000);
  if (totalMinutes < 60) {
    return `${totalMinutes}m left`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins > 0 ? `${hours}h ${mins}m left` : `${hours}h left`;
}

export function searchMessagesInThread(messages: ChatMessage[], query: string): ChatMessage[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return messages.filter(
    (m) =>
      !m.deleted &&
      (m.text.toLowerCase().includes(q) ||
        m.senderName.toLowerCase().includes(q) ||
        m.replyToText.toLowerCase().includes(q) ||
        (m.fileName ? m.fileName.toLowerCase().includes(q) : false)),
  );
}

export function filterMessagesByQuery(
  messages: ChatMessage[],
  query: string,
  filterMode: 'filter' | 'context',
): { visibleMessages: ChatMessage[]; matchIds: string[] } {
  const q = query.trim();
  if (!q) {
    return { visibleMessages: messages, matchIds: [] };
  }
  const matches = searchMessagesInThread(messages, q);
  const matchIds = matches.map((m) => m.id);
  return {
    visibleMessages: filterMode === 'filter' ? matches : messages,
    matchIds,
  };
}

export function getUnreadMessagesForUser(messages: ChatMessage[], userId: string): ChatMessage[] {
  return messages.filter(
    (m) => !m.deleted && m.senderId !== userId && !m.readBy.includes(userId),
  );
}

export function markMessagesReadByUser(messages: ChatMessage[], userId: string): ChatMessage[] {
  let changed = false;
  const next = messages.map((m) => {
    if (!m.deleted && m.senderId !== userId && !m.readBy.includes(userId)) {
      changed = true;
      return {
        ...m,
        readBy: Array.from(new Set([...m.readBy, userId])).slice(0, LIMITS.MAX_PARTICIPANTS),
      };
    }
    return m;
  });
  return changed ? next : messages;
}

export interface ReadReceiptSummary {
  status: 'sent' | 'read';
  readByOthers: string[];
  label: string;
}

export function getMessageReadStatus(
  message: ChatMessage,
  profilesById?: Record<string, UserProfile>,
): ReadReceiptSummary {
  const readByOthers = message.readBy.filter((uid) => uid !== message.senderId);
  if (readByOthers.length === 0) {
    return { status: 'sent', readByOthers: [], label: 'Sent' };
  }
  if (!profilesById) {
    return { status: 'read', readByOthers, label: 'Read' };
  }
  const names = readByOthers
    .map((uid) => profilesById[uid]?.displayName)
    .filter((n): n is string => Boolean(n));
  if (names.length === 0) {
    return { status: 'read', readByOthers, label: 'Read' };
  }
  if (names.length === 1) {
    return { status: 'read', readByOthers, label: `Read by ${names[0]}` };
  }
  if (names.length === 2) {
    return { status: 'read', readByOthers, label: `Read by ${names[0]} and ${names[1]}` };
  }
  return {
    status: 'read',
    readByOthers,
    label: `Read by ${names[0]}, ${names[1]} +${names.length - 2}`,
  };
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export const COMPANY_ID_DOMAIN = 'company.arkdm.app';

const SIMPLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COMPANY_ID_RE = /^[a-zA-Z0-9._-]{3,40}$/;
const E164_PHONE_RE = /^\+[1-9]\d{7,14}$/;
const OTP_CODE_RE = /^\d{6}$/;

export function resolveCompanyIdLogin(
  rawInput: string,
): { email: string; companyId: string; isCorporateEmail: boolean } | { error: string } {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { error: 'Enter your Company ID or work email.' };
  }

  if (trimmed.includes('@')) {
    const lower = trimmed.toLowerCase();
    if (lower.length > 254 || !SIMPLE_EMAIL_RE.test(lower)) {
      return { error: 'Enter a valid work email address (for example, name@company.com).' };
    }
    return { email: lower, companyId: lower, isCorporateEmail: true };
  }

  if (!COMPANY_ID_RE.test(trimmed)) {
    return {
      error: 'Company ID must be 3–40 characters using letters, numbers, dots, hyphens, or underscores.',
    };
  }

  return {
    email: `${trimmed.toLowerCase()}@${COMPANY_ID_DOMAIN}`,
    companyId: trimmed,
    isCorporateEmail: false,
  };
}

export function extractCompanyIdFromEmail(email: string): string {
  const lower = email.trim().toLowerCase();
  const suffix = `@${COMPANY_ID_DOMAIN}`;
  if (lower.endsWith(suffix)) {
    return lower.slice(0, -suffix.length);
  }
  return email.trim();
}

export function normalizePhoneNumber(rawInput: string): { e164: string } | { error: string } {
  const cleaned = rawInput.trim().replace(/[\s\-().]/g, '');
  if (!cleaned) {
    return { error: 'Enter your phone number with country code.' };
  }
  if (!cleaned.startsWith('+')) {
    return {
      error: 'Include your country code starting with + (for example, +91 98765 43210 or +1 650 555 0100).',
    };
  }
  if (!E164_PHONE_RE.test(cleaned)) {
    return {
      error: 'Enter a valid international phone number (8–15 digits after +, no leading 0).',
    };
  }
  return { e164: cleaned };
}

export function validateCompanyAuthForm(params: {
  identifier: string;
  password: string;
  displayName?: string;
  mode: 'signin' | 'signup';
}): string | null {
  const resolved = resolveCompanyIdLogin(params.identifier);
  if ('error' in resolved) {
    return resolved.error;
  }
  if (params.mode === 'signup') {
    const name = (params.displayName || '').trim();
    if (!name) return 'Enter your display name to create an account.';
    if (name.length > LIMITS.DISPLAY_NAME_MAX) {
      return `Display name must be ${LIMITS.DISPLAY_NAME_MAX} characters or fewer.`;
    }
  }
  if (params.password.length < 6) {
    return 'Password must be at least 6 characters.';
  }
  if (params.password.length > 128) {
    return 'Password must be 128 characters or fewer.';
  }
  return null;
}

export function validatePhoneOtp(code: string): string | null {
  const cleaned = code.trim();
  if (!OTP_CODE_RE.test(cleaned)) {
    return 'Enter the 6-digit verification code sent via SMS.';
  }
  return null;
}

export function formatAuthError(error: unknown): string | null {
  const rawMessage = error instanceof Error ? error.message : String(error || '');
  const lower = rawMessage.toLowerCase();

  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('load failed')) {
    return 'Could not reach the local ARK DM server. Make sure the server is running and try again.';
  }
  if (lower.includes('session expired')) {
    return 'Your session expired. Sign in again to continue.';
  }

  const cleaned = rawMessage.trim();
  return cleaned || 'Could not complete sign-in. Please try again.';
}
