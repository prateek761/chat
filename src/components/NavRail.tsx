import { MessageSquare, Moon, Settings, Star, Sun, Users } from 'lucide-react';
import type { ActiveNav, UserProfile } from '../types/chat';
import { Avatar } from './Avatar';

interface NavRailProps {
  activeNav: ActiveNav;
  onSelectNav: (nav: ActiveNav) => void;
  totalUnreadCount: number;
  starredCount: number;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  currentUser: UserProfile;
  hideMobileBar?: boolean;
}

const NAV_ITEMS: { id: ActiveNav; label: string; icon: typeof MessageSquare }[] = [
  { id: 'chats', label: 'Chats', icon: MessageSquare },
  { id: 'contacts', label: 'Contacts', icon: Users },
  { id: 'starred', label: 'Starred', icon: Star },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function NavRail({
  activeNav,
  onSelectNav,
  totalUnreadCount,
  starredCount,
  theme,
  onToggleTheme,
  currentUser,
  hideMobileBar = false,
}: NavRailProps) {
  return (
    <>
      {/* Desktop vertical navigation rail */}
      <nav
        aria-label="Primary navigation"
        className="hidden md:flex flex-col items-center justify-between w-16 shrink-0 bg-[#F8FAF9] dark:bg-[#17232A] border-r border-[#E5E9E7] dark:border-[#223039] py-4 select-none"
      >
        <div className="flex flex-col items-center gap-5">
          <button
            type="button"
            onClick={() => onSelectNav('chats')}
            aria-label="ARK DM Home"
            className="w-10 h-10 rounded-xl bg-[#0D7A5F] text-white font-display font-bold text-base flex items-center justify-center hover:bg-[#0A644E] transition-colors cursor-pointer"
          >
            A
          </button>

          <div className="flex flex-col items-center gap-1.5">
            {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
              const isActive = activeNav === id;
              const badge =
                id === 'chats' && totalUnreadCount > 0
                  ? totalUnreadCount
                  : id === 'starred' && starredCount > 0
                    ? starredCount
                    : 0;

              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSelectNav(id)}
                  aria-label={label}
                  aria-current={isActive ? 'page' : undefined}
                  title={label}
                  className={`relative w-11 h-11 rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-[#DDF5EC] text-[#0D7A5F] dark:bg-[#123D33] dark:text-[#34D399]'
                      : 'text-[#5A6B64] dark:text-[#8FA3AD] hover:bg-[#EDF2EF] dark:hover:bg-[#203039] hover:text-[#0F1B17] dark:hover:text-[#EEF3F1]'
                  }`}
                >
                  <Icon className="w-5 h-5" aria-hidden="true" />
                  {badge > 0 && id === 'chats' && (
                    <span className="absolute top-1.5 right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#0D7A5F] dark:bg-[#10B981] text-white text-[10px] font-semibold flex items-center justify-center tabular-nums">
                      {badge > 99 ? '99+' : badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            className="w-11 h-11 rounded-xl flex items-center justify-center text-[#5A6B64] dark:text-[#8FA3AD] hover:bg-[#EDF2EF] dark:hover:bg-[#203039] hover:text-[#0F1B17] dark:hover:text-[#EEF3F1] transition-colors cursor-pointer"
          >
            {theme === 'dark' ? (
              <Sun className="w-5 h-5" aria-hidden="true" />
            ) : (
              <Moon className="w-5 h-5" aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            onClick={() => onSelectNav('settings')}
            aria-label={`Profile settings for ${currentUser.displayName}`}
            title={currentUser.displayName}
            className="rounded-full p-0.5 hover:ring-2 hover:ring-[#0D7A5F]/40 transition-all cursor-pointer"
          >
            <Avatar src={currentUser.photoURL} name={currentUser.displayName} size="sm" />
          </button>
        </div>
      </nav>

      {/* Mobile bottom tab bar (<= 64px, well within 15% mobile sticky cap) */}
      {!hideMobileBar && (
        <nav
          aria-label="Mobile navigation"
          className="md:hidden fixed bottom-0 left-0 right-0 z-30 h-16 bg-white/95 dark:bg-[#17232A]/95 backdrop-blur-md border-t border-[#E5E9E7] dark:border-[#223039] grid grid-cols-4 items-center px-2"
        >
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
            const isActive = activeNav === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelectNav(id)}
                aria-label={label}
                aria-current={isActive ? 'page' : undefined}
                className={`relative h-12 flex flex-col items-center justify-center gap-1 rounded-xl transition-colors ${
                  isActive
                    ? 'text-[#0D7A5F] dark:text-[#34D399]'
                    : 'text-[#5A6B64] dark:text-[#8FA3AD]'
                }`}
              >
                <Icon className="w-5 h-5" aria-hidden="true" />
                <span className="text-[11px] font-medium leading-none">{label}</span>
                {id === 'chats' && totalUnreadCount > 0 && (
                  <span className="absolute top-1 right-5 min-w-[16px] h-4 px-1 rounded-full bg-[#0D7A5F] dark:bg-[#10B981] text-white text-[10px] font-semibold flex items-center justify-center tabular-nums">
                    {totalUnreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      )}
    </>
  );
}
