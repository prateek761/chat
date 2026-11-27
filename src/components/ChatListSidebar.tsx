import {
  Archive,
  BellOff,
  Check,
  CheckCheck,
  MessageSquarePlus,
  Moon,
  Pin,
  Search,
  Sun,
  X,
} from 'lucide-react';
import type { ChatFilter, EnrichedChatItem } from '../types/chat';
import { formatChatListTime } from '../utils/chatLogic';
import { Avatar } from './Avatar';

interface ChatListSidebarProps {
  chats: EnrichedChatItem[];
  activeChatId: string | null;
  currentUserId: string;
  filter: ChatFilter;
  searchQuery: string;
  totalArchivedCount: number;
  theme: 'light' | 'dark';
  onSelectChat: (chatId: string) => void;
  onChangeFilter: (filter: ChatFilter) => void;
  onChangeSearch: (query: string) => void;
  onOpenNewChat: () => void;
  onToggleTheme: () => void;
}

const FILTERS: { id: ChatFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'groups', label: 'Groups' },
  { id: 'archived', label: 'Archived' },
];

export function ChatListSidebar({
  chats,
  activeChatId,
  currentUserId,
  filter,
  searchQuery,
  totalArchivedCount,
  theme,
  onSelectChat,
  onChangeFilter,
  onChangeSearch,
  onOpenNewChat,
  onToggleTheme,
}: ChatListSidebarProps) {
  return (
    <aside
      aria-label="Conversations"
      className="flex flex-col h-full bg-white dark:bg-[#111B21] border-r border-[#E5E9E7] dark:border-[#223039] w-full md:w-[340px] lg:w-[368px] shrink-0"
    >
      {/* Sidebar Header */}
      <header className="px-4 pt-4 pb-3 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="font-display text-xl font-bold tracking-tight text-[#0F1B17] dark:text-[#EEF3F1] whitespace-nowrap">
            ARK DM
          </h1>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="md:hidden w-11 h-11 rounded-xl flex items-center justify-center text-[#5A6B64] dark:text-[#8FA3AD] hover:bg-[#F1F5F3] dark:hover:bg-[#1C2A32] transition-colors cursor-pointer"
          >
            {theme === 'dark' ? (
              <Sun className="w-5 h-5" aria-hidden="true" />
            ) : (
              <Moon className="w-5 h-5" aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            onClick={onOpenNewChat}
            aria-label="New chat"
            title="New chat or group"
            className="h-10 px-3 rounded-xl bg-[#0D7A5F] hover:bg-[#0A644E] text-white text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <MessageSquarePlus className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>New chat</span>
          </button>
        </div>
      </header>

      {/* Search bar */}
      <div className="px-4 pb-3 shrink-0">
        <div className="relative flex items-center">
          <Search
            className="w-4 h-4 text-[#6B7C75] dark:text-[#8FA3AD] absolute left-3.5 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => onChangeSearch(e.target.value)}
            placeholder="Search chats or messages"
            aria-label="Search chats or messages"
            className="w-full h-10 pl-10 pr-9 rounded-xl bg-[#F2F5F3] dark:bg-[#1C2A32] text-sm text-[#0F1B17] dark:text-[#EEF3F1] placeholder:text-[#6B7C75] dark:placeholder:text-[#7D919B] border border-transparent focus:border-[#0D7A5F] dark:focus:border-[#10B981] focus:bg-white dark:focus:bg-[#17232A] focus:outline-none transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onChangeSearch('')}
              aria-label="Clear chat search"
              className="absolute right-2 w-7 h-7 rounded-lg flex items-center justify-center text-[#6B7C75] hover:text-[#0F1B17] dark:text-[#8FA3AD] dark:hover:text-[#EEF3F1] cursor-pointer"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* Interactive Filter Segmented Bar */}
      <div className="px-4 pb-3 shrink-0" role="tablist" aria-label="Filter conversations">
        <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-[#F2F5F3] dark:bg-[#17232A]">
          {FILTERS.map(({ id, label }) => {
            const active = filter === id;
            const showArchiveCount = id === 'archived' && totalArchivedCount > 0;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onChangeFilter(id)}
                className={`h-8 px-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap truncate cursor-pointer ${
                  active
                    ? 'bg-white dark:bg-[#23343E] text-[#0F1B17] dark:text-[#EEF3F1] shadow-xs'
                    : 'text-[#5A6B64] dark:text-[#8FA3AD] hover:text-[#0F1B17] dark:hover:text-[#EEF3F1]'
                }`}
              >
                {showArchiveCount ? `${label} (${totalArchivedCount})` : label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto ark-scroll pb-20 md:pb-3" data-testid="chat-list">
        {chats.length === 0 ? (
          <div className="px-6 py-12 text-center flex flex-col items-center">
            <div className="w-11 h-11 rounded-xl bg-[#F2F5F3] dark:bg-[#1C2A32] text-[#5A6B64] dark:text-[#8FA3AD] flex items-center justify-center mb-3">
              {filter === 'archived' ? (
                <Archive className="w-5 h-5" aria-hidden="true" />
              ) : (
                <Search className="w-5 h-5" aria-hidden="true" />
              )}
            </div>
            <p className="text-sm font-medium text-[#0F1B17] dark:text-[#EEF3F1] mb-1">
              {searchQuery
                ? 'No matching conversations'
                : filter === 'archived'
                  ? 'No archived chats'
                  : filter === 'unread'
                    ? 'All caught up'
                    : filter === 'groups'
                      ? 'No group chats yet'
                      : 'No conversations yet'}
            </p>
            <p className="text-xs text-[#5A6B64] dark:text-[#8FA3AD] mb-4 max-w-[240px]">
              {searchQuery
                ? 'Try a different name or keyword.'
                : filter === 'archived'
                  ? 'Chats you archive will stay tucked away here.'
                  : 'Start a direct message or create a new group.'}
            </p>
            {searchQuery || filter !== 'all' ? (
              <button
                type="button"
                onClick={() => {
                  onChangeSearch('');
                  onChangeFilter('all');
                }}
                className="px-3.5 py-2 rounded-lg text-xs font-medium bg-[#F2F5F3] dark:bg-[#1C2A32] text-[#0F1B17] dark:text-[#EEF3F1] hover:bg-[#E5ECE8] dark:hover:bg-[#243540] transition-colors cursor-pointer"
              >
                Show all chats
              </button>
            ) : (
              <button
                type="button"
                onClick={onOpenNewChat}
                className="px-4 py-2 rounded-lg text-xs font-medium bg-[#0D7A5F] hover:bg-[#0A644E] text-white transition-colors cursor-pointer"
              >
                Start first conversation
              </button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-[#F0F3F1] dark:divide-[#1B272E]">
            {chats.map((item) => {
              const isSelected = item.chat.id === activeChatId;
              const isOwnLast = item.chat.lastMessageSenderId === currentUserId;
              const isTyping = item.typingNames.length > 0;

              return (
                <li key={item.chat.id}>
                  <button
                    type="button"
                    onClick={() => onSelectChat(item.chat.id)}
                    aria-label={`Open chat with ${item.displayName}${item.unreadCount > 0 ? `, ${item.unreadCount} unread` : ''}`}
                    aria-current={isSelected ? 'true' : undefined}
                    className={`w-full px-4 py-3 flex items-center gap-3 text-left transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[#EAF5F0] dark:bg-[#1A2D2B]'
                        : 'hover:bg-[#F7F9F8] dark:hover:bg-[#17232A]'
                    }`}
                  >
                    <Avatar
                      src={item.avatarUrl}
                      name={item.displayName}
                      size="md"
                      isGroup={item.chat.type === 'group'}
                      isOnline={item.isOnline}
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2 mb-0.5">
                        <span className="text-sm font-semibold text-[#0F1B17] dark:text-[#EEF3F1] truncate">
                          {item.displayName}
                        </span>
                        <span
                          className={`text-[11px] shrink-0 tabular-nums ${
                            item.unreadCount > 0
                              ? 'font-semibold text-[#0D7A5F] dark:text-[#34D399]'
                              : 'text-[#6B7C75] dark:text-[#7D919B]'
                          }`}
                        >
                          {formatChatListTime(item.chat.lastMessageAtMs)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1 min-w-0 flex-1">
                          {isTyping ? (
                            <span className="text-xs font-medium text-[#0D7A5F] dark:text-[#34D399] truncate">
                              {item.typingNames[0]} is typing…
                            </span>
                          ) : (
                            <>
                              {isOwnLast &&
                                (item.lastMessageRead ? (
                                  <CheckCheck
                                    className="w-3.5 h-3.5 shrink-0 text-[#0EA5E9]"
                                    aria-label="Read"
                                  />
                                ) : (
                                  <Check
                                    className="w-3.5 h-3.5 shrink-0 text-[#7B8D86] dark:text-[#728792]"
                                    aria-label="Sent"
                                  />
                                ))}
                              <span
                                className={`text-xs truncate ${
                                  item.unreadCount > 0
                                    ? 'font-medium text-[#0F1B17] dark:text-[#E2ECE8]'
                                    : 'text-[#5A6B64] dark:text-[#8FA3AD]'
                                }`}
                              >
                                {item.chat.lastMessageText || 'No messages yet'}
                              </span>
                            </>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {item.muted && (
                            <BellOff
                              className="w-3.5 h-3.5 text-[#7B8D86] dark:text-[#728792]"
                              aria-label="Muted"
                            />
                          )}
                          {item.pinned && (
                            <Pin
                              className="w-3.5 h-3.5 text-[#7B8D86] dark:text-[#728792]"
                              aria-label="Pinned"
                            />
                          )}
                          {item.unreadCount > 0 && (
                            <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#0D7A5F] dark:bg-[#10B981] text-white text-[11px] font-semibold flex items-center justify-center tabular-nums">
                              {item.unreadCount > 99 ? '99+' : item.unreadCount}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
