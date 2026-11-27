export type AppMode = 'auth' | 'local' | 'demo';

export type ActiveNav = 'chats' | 'starred' | 'contacts' | 'settings';

export type ChatFilter = 'all' | 'unread' | 'groups' | 'archived';

export type MessageType = 'text' | 'image' | 'voice' | 'file';

export interface UserProfile {
  uid: string;
  displayName: string;
  handle: string;
  about: string;
  photoURL: string;
  discoverable: boolean;
  isOnline: boolean;
  lastSeenMs: number;
}

export interface UserSettings {
  uid: string;
  email: string;
  phoneNumber?: string;
  companyId?: string;
  theme: 'light' | 'dark';
  wallpaper: 'subtle' | 'solid';
  enterToSend: boolean;
}

export interface ChatRoom {
  id: string;
  type: 'direct' | 'group';
  name: string;
  description: string;
  avatarUrl: string;
  createdBy: string;
  participantIds: string[];
  lastMessageText: string;
  lastMessageSenderId: string;
  lastMessageAtMs: number;
  createdAtMs: number;
  updatedAtMs: number;
  expiresAtMs?: number;
}

export interface ChatMemberState {
  chatId: string;
  userId: string;
  role: 'admin' | 'member';
  pinned: boolean;
  muted: boolean;
  archived: boolean;
  unreadCount: number;
  isTyping: boolean;
  lastReadAtMs: number;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  senderId: string;
  senderName: string;
  participantIds: string[];
  type: MessageType;
  text: string;
  mediaUrl: string;
  fileId?: string;
  fileName?: string;
  fileMime?: string;
  fileSize?: number;
  voiceDurationSec: number;
  replyToId: string;
  replyToSender: string;
  replyToText: string;
  edited: boolean;
  deleted: boolean;
  readBy: string[];
  createdAtMs: number;
  updatedAtMs: number;
  expiresAtMs?: number;
}

export interface RetentionStats {
  retentionHours: number;
  activeChats: number;
  activeMessages: number;
  activeFiles: number;
  totalFileBytes: number;
  nextExpiryMs: number | null;
}

export interface MessageReaction {
  id: string;
  chatId: string;
  messageId: string;
  userId: string;
  emoji: string;
  createdAtMs: number;
}

export interface StarredMessageItem {
  id: string;
  userId: string;
  chatId: string;
  messageId: string;
  chatName: string;
  senderName: string;
  text: string;
  createdAtMs: number;
}

export interface EnrichedChatItem {
  chat: ChatRoom;
  displayName: string;
  subtitle: string;
  avatarUrl: string;
  isOnline: boolean;
  lastSeenMs: number;
  pinned: boolean;
  muted: boolean;
  archived: boolean;
  unreadCount: number;
  lastMessageRead: boolean;
  typingNames: string[];
  otherParticipant?: UserProfile;
}

export interface AggregatedReaction {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  userIds: string[];
}

export interface MessageDateGroup {
  dateKey: string;
  label: string;
  messages: ChatMessage[];
}

export interface ReplyTarget {
  messageId: string;
  senderName: string;
  text: string;
}
