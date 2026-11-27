import { useEffect, useMemo, useState } from 'react';
import { MessageSquare, MessageSquarePlus } from 'lucide-react';
import { AuthScreen } from './components/AuthScreen';
import { ChatListSidebar } from './components/ChatListSidebar';
import { ChatThread } from './components/ChatThread';
import { ContactInfoDrawer } from './components/ContactInfoDrawer';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MediaLightbox } from './components/MediaLightbox';
import { NavRail } from './components/NavRail';
import { NewChatModal } from './components/NewChatModal';
import { ContactsPanel, SettingsPanel, StarredPanel } from './components/SecondaryPanels';
import { useChatStore } from './hooks/useChatStore';
import type { ActiveNav, ChatFilter } from './types/chat';
import { filterAndSortChats } from './utils/chatLogic';

function ArkDmWorkspace() {
  const store = useChatStore();
  const [activeNav, setActiveNav] = useState<ActiveNav>('chats');
  const [chatFilter, setChatFilter] = useState<ChatFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showInfoDrawer, setShowInfoDrawer] = useState(false);
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [mobileShowThread, setMobileShowThread] = useState(false);
  const [lightboxMedia, setLightboxMedia] = useState<{
    src: string;
    caption: string;
    senderName: string;
  } | null>(null);

  // Sync Tailwind v4 `.dark` class on <html>
  useEffect(() => {
    const isDark = store.settings.theme === 'dark';
    document.documentElement.classList.toggle('dark', isDark);
  }, [store.settings.theme]);

  const filteredChats = useMemo(
    () => filterAndSortChats(store.enrichedChats, chatFilter, searchQuery, store.profiles),
    [store.enrichedChats, chatFilter, searchQuery, store.profiles],
  );

  const totalArchivedCount = useMemo(
    () => store.enrichedChats.filter((c) => c.archived).length,
    [store.enrichedChats],
  );

  const activeChat = useMemo(
    () => store.enrichedChats.find((c) => c.chat.id === store.activeChatId) ?? null,
    [store.enrichedChats, store.activeChatId],
  );

  const activeMessages = activeChat ? store.messagesByChat[activeChat.chat.id] ?? [] : [];
  const activeReactions = activeChat ? store.reactionsByChat[activeChat.chat.id] ?? [] : [];
  const starredIds = useMemo(
    () => new Set(store.starred.map((s) => s.messageId)),
    [store.starred],
  );

  const handleSelectChat = (chatId: string) => {
    store.selectChat(chatId);
    setActiveNav('chats');
    setMobileShowThread(true);
  };

  const handleToggleTheme = () => {
    void store.updateSettings({
      theme: store.settings.theme === 'dark' ? 'light' : 'dark',
    });
  };

  if (store.mode === 'auth') {
    return (
      <AuthScreen
        loading={store.authLoading}
        signingIn={store.signingIn}
        error={store.authError}
        phoneOtpSentTo={store.phoneOtpSentTo}
        localOtpHint={store.localOtpHint}
        onClearError={store.clearAuthError}
        onCompanyAuth={store.signInWithCompanyId}
        onRequestPhoneOtp={store.requestPhoneOtp}
        onVerifyPhoneOtp={store.verifyPhoneOtp}
        onResetPhoneOtp={store.resetPhoneOtp}
        onTryDemo={store.enterDemoMode}
      />
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden flex bg-[#F4F6F5] dark:bg-[#0B141A] text-[#0F1B17] dark:text-[#EEF3F1]">
      <NavRail
        activeNav={activeNav}
        onSelectNav={(nav) => {
          setActiveNav(nav);
          setMobileShowThread(false);
        }}
        totalUnreadCount={store.totalUnreadCount}
        starredCount={store.starred.length}
        theme={store.settings.theme}
        onToggleTheme={handleToggleTheme}
        currentUser={store.currentUser}
        hideMobileBar={mobileShowThread && Boolean(activeChat)}
      />

      {/* Left Pane (Sidebar / Secondary Panel) */}
      <div
        className={`${
          mobileShowThread && activeChat ? 'hidden md:flex' : 'flex'
        } h-full w-full md:w-auto shrink-0`}
      >
        {activeNav === 'chats' && (
          <ChatListSidebar
            chats={filteredChats}
            activeChatId={store.activeChatId}
            currentUserId={store.currentUser.uid}
            filter={chatFilter}
            searchQuery={searchQuery}
            totalArchivedCount={totalArchivedCount}
            theme={store.settings.theme}
            onSelectChat={handleSelectChat}
            onChangeFilter={setChatFilter}
            onChangeSearch={setSearchQuery}
            onOpenNewChat={() => setShowNewChatModal(true)}
            onToggleTheme={handleToggleTheme}
          />
        )}

        {activeNav === 'starred' && (
          <StarredPanel
            starred={store.starred}
            onJumpToChat={(chatId) => handleSelectChat(chatId)}
          />
        )}

        {activeNav === 'contacts' && (
          <ContactsPanel
            profiles={store.profiles}
            currentUserId={store.currentUser.uid}
            onStartChat={async (uid) => {
              const id = await store.startDirectChat(uid);
              if (id) handleSelectChat(id);
            }}
          />
        )}

        {activeNav === 'settings' && (
          <SettingsPanel
            mode={store.mode}
            currentUser={store.currentUser}
            settings={store.settings}
            retentionStats={store.retentionStats}
            onUpdateProfile={store.updateProfile}
            onUpdateSettings={store.updateSettings}
            onRunRetentionSweep={store.runRetentionSweep}
            onWipeMyData={store.wipeMyData}
            onGoToLocalAuth={store.exitToAuth}
            onResetDemo={store.resetDemoWorkspace}
            onLogout={store.logout}
          />
        )}
      </div>

      {/* Main Conversation Canvas */}
      <div
        className={`${
          mobileShowThread && activeChat ? 'flex' : 'hidden md:flex'
        } flex-1 h-full min-w-0`}
      >
        {activeChat ? (
          <>
            <ChatThread
              activeChat={activeChat}
              messages={activeMessages}
              reactions={activeReactions}
              profiles={store.profiles}
              starredIds={starredIds}
              currentUser={store.currentUser}
              wallpaper={store.settings.wallpaper}
              enterToSend={store.settings.enterToSend}
              showInfoDrawer={showInfoDrawer}
              onBackMobile={() => setMobileShowThread(false)}
              onToggleInfoDrawer={() => setShowInfoDrawer((v) => !v)}
              onUploadAttachment={(file, fallbackName) =>
                store.uploadAttachment(activeChat.chat.id, file, fallbackName)
              }
              onSendMessage={(payload) => store.sendMessage(activeChat.chat.id, payload)}
              onEditMessage={(msgId, text) => store.editMessage(activeChat.chat.id, msgId, text)}
              onDeleteMessage={(msgId) => store.deleteMessage(activeChat.chat.id, msgId)}
              onToggleReaction={(msgId, emoji) =>
                store.toggleReaction(activeChat.chat.id, msgId, emoji)
              }
              onToggleStar={(msg) => store.toggleStar(activeChat.displayName, msg)}
              onTypingChange={(typing) => void store.setTypingStatus(activeChat.chat.id, typing)}
              onOpenImage={(src, caption, senderName) =>
                setLightboxMedia({ src, caption, senderName })
              }
            />

            {showInfoDrawer && (
              <ContactInfoDrawer
                activeChat={activeChat}
                messages={activeMessages}
                starredIds={starredIds}
                profiles={store.profiles}
                onClose={() => setShowInfoDrawer(false)}
                onTogglePin={() =>
                  void store.updateMemberFlag(activeChat.chat.id, 'pinned', !activeChat.pinned)
                }
                onToggleMute={() =>
                  void store.updateMemberFlag(activeChat.chat.id, 'muted', !activeChat.muted)
                }
                onToggleArchive={() =>
                  void store.updateMemberFlag(
                    activeChat.chat.id,
                    'archived',
                    !activeChat.archived,
                  )
                }
                onOpenImage={(src, caption, senderName) =>
                  setLightboxMedia({ src, caption, senderName })
                }
              />
            )}
          </>
        ) : (
          <main className="flex-1 flex flex-col items-center justify-center p-8 text-center ark-chat-wallpaper">
            <div className="max-w-sm bg-white/95 dark:bg-[#17232A]/95 border border-[#E2E8E5] dark:border-[#24343E] rounded-2xl p-8">
              <div className="w-12 h-12 rounded-xl bg-[#DDF5EC] dark:bg-[#123D33] text-[#0D7A5F] dark:text-[#34D399] flex items-center justify-center mx-auto mb-4">
                <MessageSquare className="w-6 h-6" aria-hidden="true" />
              </div>
              <h2 className="font-display text-lg font-bold text-[#0F1B17] dark:text-[#EEF3F1] mb-2">
                Select a conversation
              </h2>
              <p className="text-sm text-[#5A6B64] dark:text-[#8FA3AD] mb-6 leading-relaxed">
                Pick a thread on the left or start a new direct message or group room.
              </p>
              <button
                type="button"
                onClick={() => setShowNewChatModal(true)}
                className="h-10 px-4 rounded-xl bg-[#0D7A5F] hover:bg-[#0A644E] text-white text-sm font-medium inline-flex items-center gap-2 transition-colors cursor-pointer"
              >
                <MessageSquarePlus className="w-4 h-4" aria-hidden="true" />
                <span>New conversation</span>
              </button>
            </div>
          </main>
        )}
      </div>

      {/* New Chat / Group Modal */}
      <NewChatModal
        isOpen={showNewChatModal}
        profiles={store.profiles}
        currentUserId={store.currentUser.uid}
        onClose={() => setShowNewChatModal(false)}
        onStartDirect={async (uid) => {
          const id = await store.startDirectChat(uid);
          if (id) handleSelectChat(id);
        }}
        onCreateGroup={async (name, desc, ids) => {
          const id = await store.createGroupChat(name, desc, ids);
          if (id) handleSelectChat(id);
        }}
      />

      {/* Shared Photo Lightbox */}
      <MediaLightbox
        src={lightboxMedia?.src ?? null}
        caption={lightboxMedia?.caption}
        senderName={lightboxMedia?.senderName}
        onClose={() => setLightboxMedia(null)}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ArkDmWorkspace />
    </ErrorBoundary>
  );
}
