import {
  Archive,
  Bell,
  BellOff,
  Clock,
  Download,
  FileText,
  Image as ImageIcon,
  Pin,
  PinOff,
  Star,
  X,
} from 'lucide-react';
import { buildAuthedFileUrl } from '../lib/localApi';
import type { ChatMessage, EnrichedChatItem, UserProfile } from '../types/chat';
import { formatFileSize, formatLastSeen, formatTimeRemaining } from '../utils/chatLogic';
import { Avatar } from './Avatar';

interface ContactInfoDrawerProps {
  activeChat: EnrichedChatItem;
  messages: ChatMessage[];
  starredIds: Set<string>;
  profiles: Record<string, UserProfile>;
  onClose: () => void;
  onTogglePin: () => void;
  onToggleMute: () => void;
  onToggleArchive: () => void;
  onOpenImage: (src: string, caption: string, senderName: string) => void;
}

export function ContactInfoDrawer({
  activeChat,
  messages,
  starredIds,
  profiles,
  onClose,
  onTogglePin,
  onToggleMute,
  onToggleArchive,
  onOpenImage,
}: ContactInfoDrawerProps) {
  const sharedMedia = messages.filter((m) => !m.deleted && m.type === 'image' && m.mediaUrl);
  const sharedFiles = messages.filter((m) => !m.deleted && m.type === 'file' && m.mediaUrl);
  const starredInChat = messages.filter((m) => !m.deleted && starredIds.has(m.id));
  const isGroup = activeChat.chat.type === 'group';

  return (
    <aside
      aria-label="Conversation info"
      className="fixed inset-y-0 right-0 z-40 w-full sm:w-[330px] lg:static lg:z-auto lg:w-[320px] shrink-0 bg-white dark:bg-[#111B21] border-l border-[#E5E9E7] dark:border-[#223039] flex flex-col h-full shadow-xl lg:shadow-none"
    >
      <header className="h-16 px-4 border-b border-[#E5E9E7] dark:border-[#223039] flex items-center justify-between shrink-0">
        <h3 className="font-display text-sm font-semibold text-[#0F1B17] dark:text-[#EEF3F1]">
          {isGroup ? 'Group info' : 'Contact info'}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close info panel"
          className="w-10 h-10 rounded-xl flex items-center justify-center text-[#5A6B64] dark:text-[#8FA3AD] hover:bg-[#F2F5F3] dark:hover:bg-[#1C2A32] transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto ark-scroll divide-y divide-[#EEF2F0] dark:divide-[#1D2B33]">
        {/* Identity Summary */}
        <div className="px-6 py-6 flex flex-col items-center text-center">
          <Avatar
            src={activeChat.avatarUrl}
            name={activeChat.displayName}
            size="xl"
            isGroup={isGroup}
            isOnline={activeChat.isOnline}
          />
          <h4 className="mt-3.5 font-display text-lg font-bold text-[#0F1B17] dark:text-[#EEF3F1]">
            {activeChat.displayName}
          </h4>
          <p className="text-xs text-[#5A6B64] dark:text-[#8FA3AD] mt-0.5">
            {isGroup
              ? `Group · ${activeChat.chat.participantIds.length} participants`
              : `@${activeChat.otherParticipant?.handle || 'member'} · ${formatLastSeen(activeChat.lastSeenMs, activeChat.isOnline)}`}
          </p>
          {(activeChat.chat.description || activeChat.otherParticipant?.about) && (
            <p className="mt-3 text-sm text-[#394A43] dark:text-[#B4C5CE] leading-relaxed">
              {isGroup ? activeChat.chat.description : activeChat.otherParticipant?.about}
            </p>
          )}
        </div>

        {/* Quick Actions */}
        <div className="px-4 py-4 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={onTogglePin}
            className={`py-2.5 px-2 rounded-xl flex flex-col items-center justify-center gap-1.5 text-xs font-medium transition-colors cursor-pointer ${
              activeChat.pinned
                ? 'bg-[#DDF5EC] text-[#0D7A5F] dark:bg-[#123D33] dark:text-[#34D399]'
                : 'bg-[#F4F6F5] dark:bg-[#17232A] text-[#394A43] dark:text-[#B4C5CE] hover:bg-[#EAEFED] dark:hover:bg-[#1E2E37]'
            }`}
          >
            {activeChat.pinned ? (
              <PinOff className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Pin className="w-4 h-4" aria-hidden="true" />
            )}
            <span>{activeChat.pinned ? 'Unpin' : 'Pin'}</span>
          </button>

          <button
            type="button"
            onClick={onToggleMute}
            className={`py-2.5 px-2 rounded-xl flex flex-col items-center justify-center gap-1.5 text-xs font-medium transition-colors cursor-pointer ${
              activeChat.muted
                ? 'bg-[#DDF5EC] text-[#0D7A5F] dark:bg-[#123D33] dark:text-[#34D399]'
                : 'bg-[#F4F6F5] dark:bg-[#17232A] text-[#394A43] dark:text-[#B4C5CE] hover:bg-[#EAEFED] dark:hover:bg-[#1E2E37]'
            }`}
          >
            {activeChat.muted ? (
              <BellOff className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Bell className="w-4 h-4" aria-hidden="true" />
            )}
            <span>{activeChat.muted ? 'Unmute' : 'Mute'}</span>
          </button>

          <button
            type="button"
            onClick={onToggleArchive}
            className={`py-2.5 px-2 rounded-xl flex flex-col items-center justify-center gap-1.5 text-xs font-medium transition-colors cursor-pointer ${
              activeChat.archived
                ? 'bg-[#DDF5EC] text-[#0D7A5F] dark:bg-[#123D33] dark:text-[#34D399]'
                : 'bg-[#F4F6F5] dark:bg-[#17232A] text-[#394A43] dark:text-[#B4C5CE] hover:bg-[#EAEFED] dark:hover:bg-[#1E2E37]'
            }`}
          >
            <Archive className="w-4 h-4" aria-hidden="true" />
            <span>{activeChat.archived ? 'Unarchive' : 'Archive'}</span>
          </button>
        </div>

        {/* 48-Hour Auto-Delete Policy */}
        <div className="px-5 py-4 flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#DDF5EC] dark:bg-[#123D33] text-[#0D7A5F] dark:text-[#34D399] flex items-center justify-center shrink-0 mt-0.5">
            <Clock className="w-4 h-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[#0F1B17] dark:text-[#EEF3F1]">
              48-hour auto-delete active
            </p>
            <p className="text-xs text-[#5A6B64] dark:text-[#8FA3AD] mt-0.5 leading-relaxed">
              Messages and server files in this thread erase automatically after 48 hours of inactivity.
            </p>
            {activeChat.chat.expiresAtMs && (
              <p className="text-[11px] font-medium text-[#0D7A5F] dark:text-[#34D399] mt-1 tabular-nums">
                Thread expires: {formatTimeRemaining(activeChat.chat.expiresAtMs)}
              </p>
            )}
          </div>
        </div>

        {/* Shared Media */}
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-[#5A6B64] dark:text-[#8FA3AD]">
              Shared media
            </span>
            <span className="text-xs text-[#6B7C75] dark:text-[#7D919B] tabular-nums">
              {sharedMedia.length}
            </span>
          </div>

          {sharedMedia.length === 0 ? (
            <div className="py-5 text-center rounded-xl bg-[#F6F8F7] dark:bg-[#17232A] text-xs text-[#6B7C75] dark:text-[#8FA3AD] flex flex-col items-center gap-1.5">
              <ImageIcon className="w-4 h-4 opacity-70" aria-hidden="true" />
              <span>No photos shared yet</span>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {sharedMedia.map((m) => {
                const resolvedUrl = buildAuthedFileUrl(m.mediaUrl);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onOpenImage(resolvedUrl, m.text, m.senderName)}
                    aria-label={`Open shared photo from ${m.senderName}`}
                    className="aspect-square rounded-lg overflow-hidden bg-[#F2F5F3] dark:bg-[#1C2A32] cursor-pointer"
                  >
                    <img
                      src={resolvedUrl}
                      alt={m.text || 'Shared photo'}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover hover:scale-105 transition-transform"
                    />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Shared Files */}
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-[#5A6B64] dark:text-[#8FA3AD]">
              Shared files
            </span>
            <span className="text-xs text-[#6B7C75] dark:text-[#7D919B] tabular-nums">
              {sharedFiles.length}
            </span>
          </div>

          {sharedFiles.length === 0 ? (
            <p className="text-xs text-[#6B7C75] dark:text-[#7D919B]">
              No files uploaded in this chat yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {sharedFiles.map((m) => {
                const dlUrl = buildAuthedFileUrl(
                  `${m.mediaUrl}${m.mediaUrl.includes('?') ? '&' : '?'}download=1`,
                );
                return (
                  <li
                    key={m.id}
                    className="p-2.5 rounded-xl bg-[#F6F8F7] dark:bg-[#17232A] flex items-center gap-2.5"
                  >
                    <FileText
                      className="w-4 h-4 text-[#0D7A5F] dark:text-[#34D399] shrink-0"
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-[#0F1B17] dark:text-[#EEF3F1] truncate">
                        {m.fileName || 'Attachment'}
                      </p>
                      <p className="text-[11px] text-[#6B7C75] dark:text-[#8FA3AD] tabular-nums">
                        {formatFileSize(m.fileSize || 0)}
                      </p>
                    </div>
                    <a
                      href={dlUrl}
                      download={m.fileName || 'attachment'}
                      aria-label={`Download ${m.fileName || 'file'}`}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-[#5A6B64] dark:text-[#8FA3AD] hover:bg-black/5 dark:hover:bg-white/10 shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" aria-hidden="true" />
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Starred Messages Count */}
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[#5A6B64] dark:text-[#8FA3AD]">
              Starred in this chat
            </span>
            <span className="text-xs text-[#6B7C75] dark:text-[#7D919B] tabular-nums">
              {starredInChat.length}
            </span>
          </div>
          {starredInChat.length === 0 ? (
            <p className="text-xs text-[#6B7C75] dark:text-[#7D919B]">
              Star any message to keep it handy here.
            </p>
          ) : (
            <ul className="space-y-2">
              {starredInChat.slice(0, 4).map((m) => (
                <li
                  key={m.id}
                  className="p-2.5 rounded-xl bg-[#F6F8F7] dark:bg-[#17232A] text-xs"
                >
                  <div className="flex items-center gap-1.5 text-[#5A6B64] dark:text-[#8FA3AD] mb-0.5">
                    <Star className="w-3 h-3 text-amber-500 fill-current shrink-0" aria-hidden="true" />
                    <span className="font-medium truncate">{m.senderName}</span>
                  </div>
                  <p className="text-[#0F1B17] dark:text-[#EEF3F1] line-clamp-2">{m.text}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Group Participants */}
        {isGroup && (
          <div className="px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-[#5A6B64] dark:text-[#8FA3AD]">
                Members
              </span>
              <span className="text-xs text-[#6B7C75] dark:text-[#7D919B] tabular-nums">
                {activeChat.chat.participantIds.length}
              </span>
            </div>
            <ul className="space-y-2.5">
              {activeChat.chat.participantIds.map((pid) => {
                const p = profiles[pid];
                const isCreator = pid === activeChat.chat.createdBy;
                return (
                  <li key={pid} className="flex items-center gap-3">
                    <Avatar
                      src={p?.photoURL}
                      name={p?.displayName || 'Member'}
                      size="sm"
                      isOnline={p?.isOnline}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[#0F1B17] dark:text-[#EEF3F1] truncate">
                        {p?.displayName || 'ARK User'}
                      </p>
                      <p className="text-xs text-[#5A6B64] dark:text-[#8FA3AD] truncate">
                        {isCreator ? 'Group admin' : p?.about || 'Member'}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </aside>
  );
}
