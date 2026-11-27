import { useMemo, useState } from 'react';
import { Check, Search, Users, X } from 'lucide-react';
import type { UserProfile } from '../types/chat';
import { LIMITS, validateGroupForm } from '../utils/chatLogic';
import { Avatar } from './Avatar';

interface NewChatModalProps {
  isOpen: boolean;
  profiles: Record<string, UserProfile>;
  currentUserId: string;
  onClose: () => void;
  onStartDirect: (targetUid: string) => Promise<void>;
  onCreateGroup: (name: string, description: string, memberIds: string[]) => Promise<void>;
}

export function NewChatModal({
  isOpen,
  profiles,
  currentUserId,
  onClose,
  onStartDirect,
  onCreateGroup,
}: NewChatModalProps) {
  const [tab, setTab] = useState<'direct' | 'group'>('direct');
  const [query, setQuery] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupDesc, setGroupDesc] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const contacts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.values(profiles)
      .filter((p) => p.uid !== currentUserId)
      .filter((p) => {
        if (!q) return true;
        return (
          p.displayName.toLowerCase().includes(q) ||
          p.handle.toLowerCase().includes(q) ||
          p.about.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [profiles, currentUserId, query]);

  if (!isOpen) return null;

  const resetAndClose = () => {
    setQuery('');
    setGroupName('');
    setGroupDesc('');
    setSelectedIds([]);
    setError(null);
    setTab('direct');
    onClose();
  };

  const toggleMember = (uid: string) => {
    setError(null);
    setSelectedIds((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid],
    );
  };

  const handleGroupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationErr = validateGroupForm(groupName, groupDesc, selectedIds);
    if (validationErr) {
      setError(validationErr);
      return;
    }
    setSubmitting(true);
    try {
      await onCreateGroup(groupName, groupDesc, selectedIds);
      resetAndClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New conversation"
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={resetAndClose}
    >
      <div
        className="w-full max-w-md bg-white dark:bg-[#17232A] border border-[#DFE6E3] dark:border-[#24343E] rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-4 border-b border-[#E5E9E7] dark:border-[#223039] flex items-center justify-between">
          <h2 className="font-display text-base font-bold text-[#0F1B17] dark:text-[#EEF3F1]">
            Start a conversation
          </h2>
          <button
            type="button"
            onClick={resetAndClose}
            aria-label="Close new conversation dialog"
            className="w-9 h-9 rounded-xl flex items-center justify-center text-[#5A6B64] dark:text-[#8FA3AD] hover:bg-[#F2F5F3] dark:hover:bg-[#22323B] cursor-pointer"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </header>

        {/* Tabs */}
        <div className="px-5 pt-4">
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#F2F5F3] dark:bg-[#111B21]">
            <button
              type="button"
              onClick={() => {
                setTab('direct');
                setError(null);
              }}
              className={`h-9 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                tab === 'direct'
                  ? 'bg-white dark:bg-[#23343E] text-[#0F1B17] dark:text-[#EEF3F1] shadow-xs'
                  : 'text-[#5A6B64] dark:text-[#8FA3AD]'
              }`}
            >
              Direct message
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('group');
                setError(null);
              }}
              className={`h-9 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                tab === 'group'
                  ? 'bg-white dark:bg-[#23343E] text-[#0F1B17] dark:text-[#EEF3F1] shadow-xs'
                  : 'text-[#5A6B64] dark:text-[#8FA3AD]'
              }`}
            >
              New group
            </button>
          </div>
        </div>

        {tab === 'direct' ? (
          <div className="p-5 flex-1 flex flex-col min-h-0">
            <div className="relative mb-3">
              <Search
                className="w-4 h-4 text-[#6B7C75] absolute left-3.5 top-3 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search contacts by name or handle"
                aria-label="Search contacts"
                className="w-full h-10 pl-10 pr-3 rounded-xl bg-[#F2F5F3] dark:bg-[#111B21] text-sm text-[#0F1B17] dark:text-[#EEF3F1] placeholder:text-[#6B7C75] focus:outline-none focus:ring-2 focus:ring-[#0D7A5F]"
              />
            </div>

            <div className="flex-1 overflow-y-auto ark-scroll divide-y divide-[#F0F3F1] dark:divide-[#1F2D35]">
              {contacts.length === 0 ? (
                <div className="py-10 text-center text-sm text-[#5A6B64] dark:text-[#8FA3AD]">
                  <p className="font-medium text-[#0F1B17] dark:text-[#EEF3F1] mb-1">
                    No contacts found
                  </p>
                  <p className="text-xs mb-4">
                    Invite teammates to sign in to ARK DM, or message yourself for saved notes.
                  </p>
                  <button
                    type="button"
                    onClick={async () => {
                      await onStartDirect(currentUserId);
                      resetAndClose();
                    }}
                    className="px-4 py-2 rounded-xl bg-[#0D7A5F] hover:bg-[#0A644E] text-white text-xs font-medium cursor-pointer"
                  >
                    Message yourself (Saved Notes)
                  </button>
                </div>
              ) : (
                contacts.map((contact) => (
                  <button
                    key={contact.uid}
                    type="button"
                    onClick={async () => {
                      await onStartDirect(contact.uid);
                      resetAndClose();
                    }}
                    className="w-full py-3 px-2 flex items-center gap-3 text-left hover:bg-[#F5F8F6] dark:hover:bg-[#1E2E37] rounded-xl transition-colors cursor-pointer"
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
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <form onSubmit={(e) => void handleGroupSubmit(e)} className="p-5 flex-1 flex flex-col min-h-0 gap-3.5">
            <div>
              <label
                htmlFor="ark-group-name"
                className="block text-xs font-medium text-[#394A43] dark:text-[#B4C5CE] mb-1.5"
              >
                Group name
              </label>
              <input
                id="ark-group-name"
                type="text"
                value={groupName}
                maxLength={LIMITS.GROUP_NAME_MAX}
                onChange={(e) => {
                  setGroupName(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="e.g. ARK Launch Crew"
                className="w-full h-10 px-3.5 rounded-xl bg-[#F2F5F3] dark:bg-[#111B21] text-sm text-[#0F1B17] dark:text-[#EEF3F1] border border-transparent focus:border-[#0D7A5F] focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="ark-group-desc"
                className="block text-xs font-medium text-[#394A43] dark:text-[#B4C5CE] mb-1.5"
              >
                Description (optional)
              </label>
              <input
                id="ark-group-desc"
                type="text"
                value={groupDesc}
                maxLength={LIMITS.GROUP_DESC_MAX}
                onChange={(e) => setGroupDesc(e.target.value)}
                placeholder="What is this group for?"
                className="w-full h-10 px-3.5 rounded-xl bg-[#F2F5F3] dark:bg-[#111B21] text-sm text-[#0F1B17] dark:text-[#EEF3F1] border border-transparent focus:border-[#0D7A5F] focus:outline-none"
              />
            </div>

            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-[#394A43] dark:text-[#B4C5CE]">
                  Add participants
                </span>
                <span className="text-xs text-[#6B7C75] dark:text-[#8FA3AD] tabular-nums">
                  {selectedIds.length} selected
                </span>
              </div>
              <div className="flex-1 max-h-48 overflow-y-auto ark-scroll border border-[#E5E9E7] dark:border-[#223039] rounded-xl divide-y divide-[#F0F3F1] dark:divide-[#1F2D35]">
                {contacts.length === 0 ? (
                  <p className="p-4 text-xs text-center text-[#5A6B64] dark:text-[#8FA3AD]">
                    No other contacts available yet.
                  </p>
                ) : (
                  contacts.map((contact) => {
                    const checked = selectedIds.includes(contact.uid);
                    return (
                      <button
                        key={contact.uid}
                        type="button"
                        onClick={() => toggleMember(contact.uid)}
                        aria-pressed={checked}
                        className="w-full px-3 py-2.5 flex items-center gap-3 text-left hover:bg-[#F5F8F6] dark:hover:bg-[#1E2E37] transition-colors cursor-pointer"
                      >
                        <Avatar src={contact.photoURL} name={contact.displayName} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-[#0F1B17] dark:text-[#EEF3F1] truncate">
                            {contact.displayName}
                          </p>
                          <p className="text-xs text-[#5A6B64] dark:text-[#8FA3AD] truncate">
                            @{contact.handle}
                          </p>
                        </div>
                        <span
                          className={`w-5 h-5 rounded-md flex items-center justify-center border transition-colors ${
                            checked
                              ? 'bg-[#0D7A5F] border-[#0D7A5F] text-white'
                              : 'border-[#C8D3CE] dark:border-[#3A4D58]'
                          }`}
                        >
                          {checked && <Check className="w-3.5 h-3.5" aria-hidden="true" />}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {error && (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                {error}
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={resetAndClose}
                className="h-10 px-4 rounded-xl text-xs font-medium text-[#5A6B64] dark:text-[#8FA3AD] hover:bg-[#F2F5F3] dark:hover:bg-[#22323B] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="h-10 px-4 rounded-xl bg-[#0D7A5F] hover:bg-[#0A644E] disabled:opacity-60 text-white text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Users className="w-4 h-4" aria-hidden="true" />
                <span>{submitting ? 'Creating…' : 'Create group'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
