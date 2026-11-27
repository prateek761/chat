import { useEffect, useState } from 'react';
import {
  Check,
  Clock,
  LogOut,
  MessageSquare,
  Moon,
  RotateCcw,
  Search,
  Star,
  Sun,
  Trash2,
} from 'lucide-react';
import type { PurgeSummary } from '../lib/localApi';
import type {
  AppMode,
  RetentionStats,
  StarredMessageItem,
  UserProfile,
  UserSettings,
} from '../types/chat';
import {
  formatChatListTime,
  formatFileSize,
  formatTimeRemaining,
  LIMITS,
  validateProfileForm,
} from '../utils/chatLogic';
import { Avatar } from './Avatar';

interface StarredPanelProps {
  starred: StarredMessageItem[];
  onJumpToChat: (chatId: string) => void;
}

export function StarredPanel({ starred, onJumpToChat }: StarredPanelProps) {
  return (
    <aside
      aria-label="Starred messages"
      className="flex flex-col h-full bg-white dark:bg-[#111B21] border-r border-[#E5E9E7] dark:border-[#223039] w-full md:w-[340px] lg:w-[368px] shrink-0"
    >
      <header className="px-5 pt-5 pb-4 border-b border-[#EEF2F0] dark:border-[#1D2B33]">
        <h1 className="font-display text-xl font-bold text-[#0F1B17] dark:text-[#EEF3F1]">
          Starred messages
        </h1>
        <p className="text-xs text-[#5A6B64] dark:text-[#8FA3AD] mt-0.5 tabular-nums">
          {starred.length} saved {starred.length === 1 ? 'message' : 'messages'}
        </p>
      </header>

      <div className="flex-1 overflow-y-auto ark-scroll p-3 pb-20 md:pb-4 space-y-2">
        {starred.length === 0 ? (
          <div className="px-6 py-12 text-center flex flex-col items-center">
            <div className="w-11 h-11 rounded-xl bg-[#F2F5F3] dark:bg-[#1C2A32] text-[#5A6B64] dark:text-[#8FA3AD] flex items-center justify-center mb-3">
              <Star className="w-5 h-5" aria-hidden="true" />
            </div>
            <p className="text-sm font-medium text-[#0F1B17] dark:text-[#EEF3F1] mb-1">
              No starred messages
            </p>
            <p className="text-xs text-[#5A6B64] dark:text-[#8FA3AD] max-w-[230px]">
              Tap the star icon on any message to save it for quick access later.
            </p>
          </div>
        ) : (
          starred.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onJumpToChat(item.chatId)}
              className="w-full text-left p-3.5 rounded-xl bg-[#F7F9F8] dark:bg-[#17232A] hover:bg-[#EDF3F0] dark:hover:bg-[#1D2D36] border border-[#E7ECE9] dark:border-[#23323C] transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-semibold text-[#0D7A5F] dark:text-[#34D399] truncate">
                  {item.senderName} · {item.chatName}
                </span>
                <span className="text-[11px] text-[#6B7C75] dark:text-[#7D919B] shrink-0 tabular-nums">
                  {formatChatListTime(item.createdAtMs)}
                </span>
              </div>
              <p className="text-sm text-[#0F1B17] dark:text-[#EEF3F1] line-clamp-3">
                {item.text}
              </p>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}

interface ContactsPanelProps {
  profiles: Record<string, UserProfile>;
  currentUserId: string;
  onStartChat: (uid: string) => Promise<void>;
}

export function ContactsPanel({ profiles, currentUserId, onStartChat }: ContactsPanelProps) {
  const [search, setSearch] = useState('');
  const list = Object.values(profiles)
    .filter((p) => p.uid !== currentUserId)
    .filter((p) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return (
        p.displayName.toLowerCase().includes(q) ||
        p.handle.toLowerCase().includes(q) ||
        p.about.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return (
    <aside
      aria-label="Contacts directory"
      className="flex flex-col h-full bg-white dark:bg-[#111B21] border-r border-[#E5E9E7] dark:border-[#223039] w-full md:w-[340px] lg:w-[368px] shrink-0"
    >
      <header className="px-5 pt-5 pb-3">
        <h1 className="font-display text-xl font-bold text-[#0F1B17] dark:text-[#EEF3F1]">
          Contacts
        </h1>
        <div className="relative mt-3">
          <Search
            className="w-4 h-4 text-[#6B7C75] absolute left-3.5 top-3 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter people"
            aria-label="Filter contacts"
            className="w-full h-10 pl-10 pr-3 rounded-xl bg-[#F2F5F3] dark:bg-[#1C2A32] text-sm text-[#0F1B17] dark:text-[#EEF3F1] placeholder:text-[#6B7C75] focus:outline-none focus:ring-2 focus:ring-[#0D7A5F]"
          />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto ark-scroll divide-y divide-[#F0F3F1] dark:divide-[#1B272E] pb-20 md:pb-4">
        {list.length === 0 ? (
          <div className="px-6 py-12 text-center text-xs text-[#5A6B64] dark:text-[#8FA3AD]">
            No matching contacts found.
          </div>
        ) : (
          list.map((contact) => (
            <button
              key={contact.uid}
              type="button"
              onClick={() => void onStartChat(contact.uid)}
              className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-[#F7F9F8] dark:hover:bg-[#17232A] transition-colors cursor-pointer"
            >
              <Avatar
                src={contact.photoURL}
                name={contact.displayName}
                size="md"
                isOnline={contact.isOnline}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[#0F1B17] dark:text-[#EEF3F1] truncate">
                  {contact.displayName}
                </p>
                <p className="text-xs text-[#5A6B64] dark:text-[#8FA3AD] truncate">
                  @{contact.handle}
                  {contact.about ? ` · ${contact.about}` : ''}
                </p>
              </div>
              <MessageSquare className="w-4 h-4 text-[#0D7A5F] dark:text-[#34D399] shrink-0" aria-hidden="true" />
            </button>
          ))
        )}
      </div>
    </aside>
  );
}

interface SettingsPanelProps {
  mode: AppMode;
  currentUser: UserProfile;
  settings: UserSettings;
  retentionStats: RetentionStats;
  onUpdateProfile: (updates: { displayName: string; handle: string; about: string }) => Promise<void>;
  onUpdateSettings: (updates: Partial<Pick<UserSettings, 'theme' | 'wallpaper' | 'enterToSend'>>) => Promise<void>;
  onRunRetentionSweep: () => Promise<PurgeSummary | null>;
  onWipeMyData: () => Promise<PurgeSummary | null>;
  onGoToLocalAuth: () => void;
  onResetDemo: () => void;
  onLogout: () => Promise<void>;
}

export function SettingsPanel({
  mode,
  currentUser,
  settings,
  retentionStats,
  onUpdateProfile,
  onUpdateSettings,
  onRunRetentionSweep,
  onWipeMyData,
  onGoToLocalAuth,
  onResetDemo,
  onLogout,
}: SettingsPanelProps) {
  const [displayName, setDisplayName] = useState(currentUser.displayName);
  const [handle, setHandle] = useState(currentUser.handle);
  const [about, setAbout] = useState(currentUser.about);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  const [sweepStatus, setSweepStatus] = useState<string | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);

  useEffect(() => {
    setDisplayName(currentUser.displayName);
    setHandle(currentUser.handle);
    setAbout(currentUser.about);
  }, [currentUser.displayName, currentUser.handle, currentUser.about]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateProfileForm(displayName, handle, about);
    if (err) {
      setError(err);
      setSavedNotice(false);
      return;
    }
    setError(null);
    await onUpdateProfile({ displayName, handle, about });
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 2400);
  };

  return (
    <aside
      aria-label="Settings and profile"
      className="flex flex-col h-full bg-white dark:bg-[#111B21] border-r border-[#E5E9E7] dark:border-[#223039] w-full md:w-[340px] lg:w-[368px] shrink-0"
    >
      <header className="px-5 pt-5 pb-4 border-b border-[#EEF2F0] dark:border-[#1D2B33]">
        <h1 className="font-display text-xl font-bold text-[#0F1B17] dark:text-[#EEF3F1]">
          Profile &amp; Settings
        </h1>
        <p className="text-xs text-[#5A6B64] dark:text-[#8FA3AD] mt-0.5 truncate">
          {settings.companyId ||
            settings.phoneNumber ||
            settings.email ||
            (mode === 'demo' ? 'Interactive local preview' : 'Signed in')}
        </p>
      </header>

      <div className="flex-1 overflow-y-auto ark-scroll p-5 pb-24 md:pb-6 space-y-6">
        {/* Profile Form */}
        <form onSubmit={(e) => void handleSaveProfile(e)} className="space-y-3.5">
          <div className="flex items-center gap-3.5 mb-2">
            <Avatar src={currentUser.photoURL} name={currentUser.displayName} size="lg" isOnline />
            <div className="min-w-0">
              <p className="font-display text-sm font-bold text-[#0F1B17] dark:text-[#EEF3F1] truncate">
                {currentUser.displayName}
              </p>
              <p className="text-xs text-[#5A6B64] dark:text-[#8FA3AD] truncate">
                @{currentUser.handle}
              </p>
            </div>
          </div>

          <div>
            <label
              htmlFor="profile-display-name"
              className="block text-xs font-medium text-[#394A43] dark:text-[#B4C5CE] mb-1"
            >
              Display name
            </label>
            <input
              id="profile-display-name"
              type="text"
              value={displayName}
              maxLength={LIMITS.DISPLAY_NAME_MAX}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full h-10 px-3 rounded-xl bg-[#F2F5F3] dark:bg-[#17232A] text-sm text-[#0F1B17] dark:text-[#EEF3F1] border border-transparent focus:border-[#0D7A5F] focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="profile-handle"
              className="block text-xs font-medium text-[#394A43] dark:text-[#B4C5CE] mb-1"
            >
              Handle
            </label>
            <input
              id="profile-handle"
              type="text"
              value={handle}
              maxLength={LIMITS.HANDLE_MAX}
              onChange={(e) => setHandle(e.target.value)}
              className="w-full h-10 px-3 rounded-xl bg-[#F2F5F3] dark:bg-[#17232A] text-sm text-[#0F1B17] dark:text-[#EEF3F1] border border-transparent focus:border-[#0D7A5F] focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="profile-about"
              className="block text-xs font-medium text-[#394A43] dark:text-[#B4C5CE] mb-1"
            >
              About
            </label>
            <textarea
              id="profile-about"
              rows={2}
              value={about}
              maxLength={LIMITS.ABOUT_MAX}
              onChange={(e) => setAbout(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-[#F2F5F3] dark:bg-[#17232A] text-sm text-[#0F1B17] dark:text-[#EEF3F1] border border-transparent focus:border-[#0D7A5F] focus:outline-none resize-none"
            />
          </div>

          {error && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="h-10 px-4 rounded-xl bg-[#0D7A5F] hover:bg-[#0A644E] text-white text-xs font-medium transition-colors cursor-pointer"
            >
              Save profile
            </button>
            {savedNotice && (
              <span className="text-xs font-medium text-[#0D7A5F] dark:text-[#34D399] inline-flex items-center gap-1">
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
                Saved
              </span>
            )}
          </div>
        </form>

        {/* Preferences */}
        <div className="pt-5 border-t border-[#EEF2F0] dark:border-[#1D2B33] space-y-3">
          <h2 className="text-xs font-semibold text-[#5A6B64] dark:text-[#8FA3AD]">
            Appearance &amp; Chat
          </h2>

          <div className="flex items-center justify-between gap-3 py-1">
            <div>
              <p className="text-sm font-medium text-[#0F1B17] dark:text-[#EEF3F1]">Theme</p>
              <p className="text-xs text-[#5A6B64] dark:text-[#8FA3AD]">
                Switch between light and obsidian dark
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                void onUpdateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })
              }
              className="h-9 px-3 rounded-xl bg-[#F2F5F3] dark:bg-[#17232A] text-xs font-medium text-[#0F1B17] dark:text-[#EEF3F1] inline-flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              {settings.theme === 'dark' ? (
                <>
                  <Sun className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Light</span>
                </>
              ) : (
                <>
                  <Moon className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Dark</span>
                </>
              )}
            </button>
          </div>

          <div className="flex items-center justify-between gap-3 py-1">
            <div>
              <p className="text-sm font-medium text-[#0F1B17] dark:text-[#EEF3F1]">
                Chat wallpaper
              </p>
              <p className="text-xs text-[#5A6B64] dark:text-[#8FA3AD]">
                Subtle geometric pattern or solid canvas
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                void onUpdateSettings({
                  wallpaper: settings.wallpaper === 'subtle' ? 'solid' : 'subtle',
                })
              }
              className="h-9 px-3 rounded-xl bg-[#F2F5F3] dark:bg-[#17232A] text-xs font-medium text-[#0F1B17] dark:text-[#EEF3F1] cursor-pointer shrink-0"
            >
              {settings.wallpaper === 'subtle' ? 'Pattern' : 'Solid'}
            </button>
          </div>

          <div className="flex items-center justify-between gap-3 py-1">
            <div>
              <p className="text-sm font-medium text-[#0F1B17] dark:text-[#EEF3F1]">
                Enter sends message
              </p>
              <p className="text-xs text-[#5A6B64] dark:text-[#8FA3AD]">
                Use Shift + Enter for a new line
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.enterToSend}
              aria-label="Toggle Enter to send"
              onClick={() => void onUpdateSettings({ enterToSend: !settings.enterToSend })}
              className={`w-11 h-6 rounded-full p-0.5 transition-colors cursor-pointer shrink-0 ${
                settings.enterToSend
                  ? 'bg-[#0D7A5F] dark:bg-[#10B981]'
                  : 'bg-[#CFD8D4] dark:bg-[#2C3E49]'
              }`}
            >
              <span
                className={`block w-5 h-5 rounded-full bg-white transition-transform ${
                  settings.enterToSend ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* 48-Hour Auto-Delete & Local Storage */}
        <div className="pt-5 border-t border-[#EEF2F0] dark:border-[#1D2B33] space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold text-[#5A6B64] dark:text-[#8FA3AD] flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[#0D7A5F] dark:text-[#34D399]" aria-hidden="true" />
              <span>48h Auto-Delete &amp; Storage</span>
            </h2>
            <span className="text-[11px] font-medium text-[#0D7A5F] dark:text-[#34D399]">
              {retentionStats.retentionHours}h policy
            </span>
          </div>

          <p className="text-xs text-[#5A6B64] dark:text-[#8FA3AD] leading-relaxed">
            Chats, messages, and uploaded files automatically erase from the local SQLite database and server disk 48 hours after activity.
          </p>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-2.5 rounded-xl bg-[#F4F6F5] dark:bg-[#17232A]">
              <p className="text-sm font-bold text-[#0F1B17] dark:text-[#EEF3F1] tabular-nums">
                {retentionStats.activeChats}
              </p>
              <p className="text-[11px] text-[#5A6B64] dark:text-[#8FA3AD]">Chats</p>
            </div>
            <div className="p-2.5 rounded-xl bg-[#F4F6F5] dark:bg-[#17232A]">
              <p className="text-sm font-bold text-[#0F1B17] dark:text-[#EEF3F1] tabular-nums">
                {retentionStats.activeMessages}
              </p>
              <p className="text-[11px] text-[#5A6B64] dark:text-[#8FA3AD]">Messages</p>
            </div>
            <div className="p-2.5 rounded-xl bg-[#F4F6F5] dark:bg-[#17232A]">
              <p className="text-sm font-bold text-[#0F1B17] dark:text-[#EEF3F1] tabular-nums">
                {retentionStats.activeFiles}
              </p>
              <p className="text-[11px] text-[#5A6B64] dark:text-[#8FA3AD]">
                {retentionStats.totalFileBytes > 0
                  ? formatFileSize(retentionStats.totalFileBytes)
                  : 'Files'}
              </p>
            </div>
          </div>

          {retentionStats.nextExpiryMs && (
            <p className="text-[11px] text-[#5A6B64] dark:text-[#8FA3AD] tabular-nums">
              Next scheduled deletion: {formatTimeRemaining(retentionStats.nextExpiryMs)}
            </p>
          )}

          {sweepStatus && (
            <p role="status" className="text-xs text-[#0D7A5F] dark:text-[#34D399] font-medium">
              {sweepStatus}
            </p>
          )}

          <button
            type="button"
            disabled={sweeping}
            onClick={async () => {
              setSweeping(true);
              setSweepStatus(null);
              try {
                const res = await onRunRetentionSweep();
                if (res) {
                  const total =
                    res.purgedChatIds.length + res.purgedMessageIds.length + res.purgedFileIds.length;
                  setSweepStatus(
                    total === 0
                      ? 'Cleanup complete — no items older than 48h found.'
                      : `Removed ${res.purgedChatIds.length} chats, ${res.purgedMessageIds.length} messages, ${res.purgedFileIds.length} files.`,
                  );
                }
              } finally {
                setSweeping(false);
              }
            }}
            className="w-full h-9 px-3 rounded-xl bg-[#F2F5F3] dark:bg-[#17232A] hover:bg-[#E7EDE9] dark:hover:bg-[#1E2E37] disabled:opacity-60 text-xs font-medium text-[#0F1B17] dark:text-[#EEF3F1] transition-colors cursor-pointer"
          >
            {sweeping ? 'Running cleanup…' : 'Run 48h cleanup now'}
          </button>

          {!confirmWipe ? (
            <button
              type="button"
              onClick={() => setConfirmWipe(true)}
              className="w-full h-9 px-3 rounded-xl border border-[#E2E8E5] dark:border-[#24343E] hover:bg-red-50 dark:hover:bg-red-950/30 text-xs font-medium text-red-700 dark:text-red-400 inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Delete my chats &amp; files now</span>
            </button>
          ) : (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 space-y-2">
              <p className="text-xs text-red-700 dark:text-red-300 leading-relaxed">
                Permanently erase all your conversations and uploaded server files immediately?
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmWipe(false)}
                  className="flex-1 h-8 rounded-lg bg-white dark:bg-[#17232A] text-xs font-medium text-[#0F1B17] dark:text-[#EEF3F1] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setConfirmWipe(false);
                    setSweeping(true);
                    try {
                      await onWipeMyData();
                      setSweepStatus('All your chats and uploaded server files have been erased.');
                    } finally {
                      setSweeping(false);
                    }
                  }}
                  className="flex-1 h-8 rounded-lg bg-red-600 hover:bg-red-700 text-xs font-medium text-white cursor-pointer"
                >
                  Erase now
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Account Actions */}
        <div className="pt-5 border-t border-[#EEF2F0] dark:border-[#1D2B33] space-y-2.5">
          {mode === 'demo' && (
            <>
              <button
                type="button"
                onClick={onGoToLocalAuth}
                className="w-full h-10 px-4 rounded-xl bg-[#0D7A5F] hover:bg-[#0A644E] text-white text-xs font-medium transition-colors cursor-pointer"
              >
                Sign in to Local Server
              </button>
              <button
                type="button"
                onClick={onResetDemo}
                className="w-full h-10 px-4 rounded-xl bg-[#F2F5F3] dark:bg-[#17232A] hover:bg-[#E7EDE9] dark:hover:bg-[#1E2E37] text-xs font-medium text-[#0F1B17] dark:text-[#EEF3F1] inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Reset demo conversations</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => void onLogout()}
            className="w-full h-10 px-4 rounded-xl border border-[#E2E8E5] dark:border-[#24343E] hover:bg-red-50 dark:hover:bg-red-950/30 text-xs font-medium text-red-700 dark:text-red-400 inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{mode === 'demo' ? 'Exit demo' : 'Sign out'}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
