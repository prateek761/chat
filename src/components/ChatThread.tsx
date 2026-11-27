import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Clock,
  FileText,
  ImagePlus,
  Info,
  Mic,
  Paperclip,
  Search,
  SendHorizontal,
  Smile,
  Square,
  X,
} from 'lucide-react';
import type { UploadResponse } from '../lib/localApi';
import type {
  ChatMessage,
  EnrichedChatItem,
  MessageReaction,
  ReplyTarget,
  UserProfile,
} from '../types/chat';
import type { SendMessagePayload } from '../hooks/useChatStore';
import {
  aggregateReactions,
  filterMessagesByQuery,
  formatFileSize,
  formatLastSeen,
  formatVoiceDuration,
  groupMessagesByDate,
  LIMITS,
  MAX_UPLOAD_BYTES,
  PICKER_EMOJIS,
  validateMessageInput,
} from '../utils/chatLogic';
import { Avatar } from './Avatar';
import { MessageBubble } from './MessageBubble';

interface ChatThreadProps {
  activeChat: EnrichedChatItem;
  messages: ChatMessage[];
  reactions: MessageReaction[];
  profiles: Record<string, UserProfile>;
  starredIds: Set<string>;
  currentUser: UserProfile;
  wallpaper: 'subtle' | 'solid';
  enterToSend: boolean;
  showInfoDrawer: boolean;
  onBackMobile: () => void;
  onToggleInfoDrawer: () => void;
  onUploadAttachment: (file: File | Blob, fallbackName?: string) => Promise<UploadResponse>;
  onSendMessage: (payload: SendMessagePayload) => Promise<void>;
  onEditMessage: (messageId: string, newText: string) => Promise<void>;
  onDeleteMessage: (messageId: string) => Promise<void>;
  onToggleReaction: (messageId: string, emoji: string) => Promise<void>;
  onToggleStar: (message: ChatMessage) => Promise<void>;
  onTypingChange: (isTyping: boolean) => void;
  onOpenImage: (src: string, caption: string, senderName: string) => void;
}

interface PendingAttachment {
  kind: 'image' | 'file';
  file: File;
  previewUrl?: string;
}

async function compressImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Unsupported image format.'));
      img.onload = () => {
        const maxDim = 840;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const compressed = canvas.toDataURL('image/jpeg', 0.72);
        resolve(compressed.slice(0, LIMITS.MEDIA_URL_MAX));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function ChatThread({
  activeChat,
  messages,
  reactions,
  profiles,
  starredIds,
  currentUser,
  wallpaper,
  enterToSend,
  showInfoDrawer,
  onBackMobile,
  onToggleInfoDrawer,
  onUploadAttachment,
  onSendMessage,
  onEditMessage,
  onDeleteMessage,
  onToggleReaction,
  onToggleStar,
  onTypingChange,
  onOpenImage,
}: ChatThreadProps) {
  const [draft, setDraft] = useState('');
  const [composerError, setComposerError] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showEmojiMenu, setShowEmojiMenu] = useState(false);

  // In-chat search, filter, and match jump
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const [threadSearch, setThreadSearch] = useState('');
  const [searchFilterMode, setSearchFilterMode] = useState<'filter' | 'context'>('filter');
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recordTimerRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);

  // Reset per-chat ephemeral composer state when switching conversations
  useEffect(() => {
    setReplyTarget(null);
    setEditingMessage(null);
    setPendingAttachment(null);
    setComposerError(null);
    setShowEmojiMenu(false);
    setShowMobileSearch(false);
    setThreadSearch('');
    setSearchFilterMode('filter');
    setActiveMatchIndex(0);
  }, [activeChat.chat.id]);

  // Scroll to bottom when active chat or message count changes (only when not searching)
  useEffect(() => {
    if (!threadSearch.trim()) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [activeChat.chat.id, messages.length, threadSearch]);

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
      if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
    };
  }, []);

  const reactionsByMessageId = useMemo(() => {
    const map: Record<string, MessageReaction[]> = {};
    for (const r of reactions) {
      if (!map[r.messageId]) map[r.messageId] = [];
      map[r.messageId].push(r);
    }
    return map;
  }, [reactions]);

  const { visibleMessages, matchIds } = useMemo(
    () => filterMessagesByQuery(messages, threadSearch, searchFilterMode),
    [messages, threadSearch, searchFilterMode],
  );

  const dateGroups = useMemo(() => groupMessagesByDate(visibleMessages), [visibleMessages]);

  const safeMatchIndex = matchIds.length > 0 ? activeMatchIndex % matchIds.length : 0;
  const activeMatchId = matchIds.length > 0 ? matchIds[safeMatchIndex] : null;

  useEffect(() => {
    setActiveMatchIndex(0);
  }, [threadSearch]);

  useEffect(() => {
    if (!activeMatchId || !threadSearch.trim()) return;
    const el = document.getElementById(`msg-${activeMatchId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeMatchId, searchFilterMode, threadSearch]);

  const jumpMatch = (delta: number) => {
    if (matchIds.length === 0) return;
    setActiveMatchIndex((prev) => (prev + delta + matchIds.length) % matchIds.length);
  };

  const handleDraftChange = (val: string) => {
    setDraft(val);
    if (composerError) setComposerError(null);
    onTypingChange(val.trim().length > 0);
    if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = window.setTimeout(() => onTypingChange(false), 2500);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (uploading) return;

    if (editingMessage) {
      const err = validateMessageInput(draft, false);
      if (err) {
        setComposerError(err);
        return;
      }
      await onEditMessage(editingMessage.id, draft);
      setEditingMessage(null);
      setDraft('');
      setComposerError(null);
      return;
    }

    const validationErr = validateMessageInput(draft, Boolean(pendingAttachment));
    if (validationErr) {
      setComposerError(validationErr);
      return;
    }

    const attachmentToSend = pendingAttachment;
    const textToSend = draft;
    const replyToSend = replyTarget;

    if (attachmentToSend) {
      setUploading(true);
      setComposerError(null);
      try {
        const uploaded = await onUploadAttachment(attachmentToSend.file);
        const payload: SendMessagePayload = {
          type: attachmentToSend.kind,
          text: textToSend,
          mediaUrl: uploaded.url,
          fileId: uploaded.fileId,
          fileName: uploaded.fileName,
          fileMime: uploaded.fileMime,
          fileSize: uploaded.fileSize,
          replyTo: replyToSend,
        };
        setDraft('');
        setPendingAttachment(null);
        setReplyTarget(null);
        setShowEmojiMenu(false);
        onTypingChange(false);
        await onSendMessage(payload);
      } catch (err) {
        setComposerError(err instanceof Error ? err.message : 'Could not upload file to local server.');
      } finally {
        setUploading(false);
      }
      return;
    }

    const payload: SendMessagePayload = {
      type: 'text',
      text: textToSend,
      mediaUrl: '',
      replyTo: replyToSend,
    };

    setDraft('');
    setReplyTarget(null);
    setShowEmojiMenu(false);
    setComposerError(null);
    onTypingChange(false);

    await onSendMessage(payload);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (enterToSend && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setComposerError('Please choose a valid image file (PNG, JPG, or WebP).');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setComposerError('Photo exceeds the 15 MB local upload limit.');
      return;
    }
    try {
      const previewUrl = await compressImageToDataUrl(file);
      setPendingAttachment({ kind: 'image', file, previewUrl });
      setComposerError(null);
      textareaRef.current?.focus();
    } catch {
      setComposerError('Could not process the selected image.');
    }
  };

  const handleGenericFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setComposerError('File exceeds the 15 MB local upload limit.');
      return;
    }
    if (file.type.startsWith('image/')) {
      void compressImageToDataUrl(file)
        .then((previewUrl) => {
          setPendingAttachment({ kind: 'image', file, previewUrl });
          setComposerError(null);
          textareaRef.current?.focus();
        })
        .catch(() => {
          setPendingAttachment({ kind: 'file', file });
          setComposerError(null);
        });
      return;
    }
    setPendingAttachment({ kind: 'file', file });
    setComposerError(null);
    textareaRef.current?.focus();
  };

  const startVoiceRecording = async () => {
    setComposerError(null);
    setIsRecording(true);
    setRecordSeconds(1);
    audioChunksRef.current = [];

    recordTimerRef.current = window.setInterval(() => {
      setRecordSeconds((s) => s + 1);
    }, 1000);

    try {
      if (navigator.mediaDevices && typeof MediaRecorder !== 'undefined') {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;
        recorder.ondataavailable = (ev) => {
          if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
        };
        recorder.start();
      }
    } catch {
      // Fallback cleanly to timer-based voice note clip when microphone permission is absent
      mediaRecorderRef.current = null;
    }
  };

  const stopVoiceRecording = async (cancel: boolean) => {
    const duration = Math.max(1, recordSeconds);
    if (recordTimerRef.current) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    setIsRecording(false);
    setRecordSeconds(0);

    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;

    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => {
          recorder.stream.getTracks().forEach((t) => t.stop());
          resolve();
        };
        recorder.stop();
      });
    }

    if (cancel) return;

    let uploadedVoice: UploadResponse | null = null;
    if (audioChunksRef.current.length > 0) {
      const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      try {
        uploadedVoice = await onUploadAttachment(blob, `voice-note-${Date.now()}.webm`);
      } catch {
        uploadedVoice = null;
      }
    }

    await onSendMessage({
      type: 'voice',
      text: 'Voice note',
      mediaUrl: uploadedVoice?.url || '',
      fileId: uploadedVoice?.fileId || '',
      fileName: uploadedVoice?.fileName || '',
      fileMime: uploadedVoice?.fileMime || '',
      fileSize: uploadedVoice?.fileSize || 0,
      voiceDurationSec: duration,
      replyTo: replyTarget,
    });
    setReplyTarget(null);
  };

  const statusLine =
    activeChat.typingNames.length > 0
      ? `${activeChat.typingNames.join(', ')} typing…`
      : activeChat.chat.type === 'group'
        ? `${activeChat.chat.participantIds.length} members`
        : formatLastSeen(activeChat.lastSeenMs, activeChat.isOnline);

  return (
    <main
      aria-label={`Chat with ${activeChat.displayName}`}
      className="flex-1 flex flex-col h-full min-w-0 bg-[#F4F6F5] dark:bg-[#0B141A]"
    >
      {/* Active Conversation Top Bar */}
      <header className="h-16 px-3 sm:px-5 bg-white dark:bg-[#17232A] border-b border-[#E5E9E7] dark:border-[#223039] flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={onBackMobile}
            aria-label="Back to chats"
            className="md:hidden w-11 h-11 -ml-1 rounded-xl flex items-center justify-center text-[#0F1B17] dark:text-[#EEF3F1] hover:bg-[#F2F5F3] dark:hover:bg-[#22323B] transition-colors shrink-0"
          >
            <ArrowLeft className="w-5 h-5" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onToggleInfoDrawer}
            aria-label={`View info for ${activeChat.displayName}`}
            className="flex items-center gap-3 min-w-0 text-left rounded-xl py-1 pr-2 hover:bg-[#F4F7F5] dark:hover:bg-[#1E2E37] transition-colors cursor-pointer"
          >
            <Avatar
              src={activeChat.avatarUrl}
              name={activeChat.displayName}
              size="sm"
              isGroup={activeChat.chat.type === 'group'}
              isOnline={activeChat.isOnline}
            />
            <div className="min-w-0">
              <h2 className="font-display text-[15px] font-semibold text-[#0F1B17] dark:text-[#EEF3F1] truncate leading-tight">
                {activeChat.displayName}
              </h2>
              <p
                className={`text-xs truncate leading-tight mt-0.5 ${
                  activeChat.isOnline || activeChat.typingNames.length > 0
                    ? 'text-[#0D7A5F] dark:text-[#34D399] font-medium'
                    : 'text-[#5A6B64] dark:text-[#8FA3AD]'
                }`}
              >
                {statusLine}
              </p>
            </div>
          </button>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Persistent Desktop In-Thread Search Bar */}
          <div className="hidden sm:flex items-center relative w-52 lg:w-64">
            <Search
              className="w-4 h-4 text-[#6B7C75] dark:text-[#8FA3AD] absolute left-3 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={threadSearch}
              onChange={(e) => setThreadSearch(e.target.value)}
              placeholder="Search in conversation"
              aria-label="Search messages in conversation"
              className="w-full h-9 pl-9 pr-8 rounded-xl bg-[#F2F5F3] dark:bg-[#1E2D36] text-xs sm:text-sm text-[#0F1B17] dark:text-[#EEF3F1] placeholder:text-[#6B7C75] dark:placeholder:text-[#7D919B] border border-transparent focus:border-[#0D7A5F] dark:focus:border-[#10B981] focus:bg-white dark:focus:bg-[#142027] focus:outline-none transition-colors"
            />
            {threadSearch && (
              <button
                type="button"
                onClick={() => setThreadSearch('')}
                aria-label="Clear conversation search"
                className="absolute right-1.5 w-6 h-6 rounded-lg flex items-center justify-center text-[#5A6B64] dark:text-[#8FA3AD] hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          {/* Mobile Search Toggle Button */}
          <button
            type="button"
            onClick={() => {
              setShowMobileSearch((v) => !v);
              if (showMobileSearch) setThreadSearch('');
            }}
            aria-label="Toggle mobile message search"
            aria-expanded={showMobileSearch}
            title="Search in chat"
            className={`sm:hidden w-10 h-10 rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
              showMobileSearch || threadSearch
                ? 'bg-[#DDF5EC] text-[#0D7A5F] dark:bg-[#123D33] dark:text-[#34D399]'
                : 'text-[#5A6B64] dark:text-[#8FA3AD] hover:bg-[#F2F5F3] dark:hover:bg-[#22323B]'
            }`}
          >
            <Search className="w-5 h-5" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onToggleInfoDrawer}
            aria-label={showInfoDrawer ? 'Close contact info' : 'Open contact info'}
            aria-expanded={showInfoDrawer}
            title="Contact info"
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
              showInfoDrawer
                ? 'bg-[#DDF5EC] text-[#0D7A5F] dark:bg-[#123D33] dark:text-[#34D399]'
                : 'text-[#5A6B64] dark:text-[#8FA3AD] hover:bg-[#F2F5F3] dark:hover:bg-[#22323B]'
            }`}
          >
            <Info className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Mobile Search Input Bar */}
      {showMobileSearch && (
        <div className="sm:hidden px-3 py-2 bg-[#F8FAF9] dark:bg-[#141F26] border-b border-[#E5E9E7] dark:border-[#223039] flex items-center gap-2 shrink-0">
          <Search className="w-4 h-4 text-[#5A6B64] dark:text-[#8FA3AD] shrink-0" aria-hidden="true" />
          <input
            type="search"
            value={threadSearch}
            onChange={(e) => setThreadSearch(e.target.value)}
            placeholder="Search messages in this chat…"
            aria-label="Search messages in conversation"
            autoFocus
            className="flex-1 bg-transparent text-sm text-[#0F1B17] dark:text-[#EEF3F1] placeholder:text-[#6B7C75] focus:outline-none"
          />
          <button
            type="button"
            onClick={() => {
              setShowMobileSearch(false);
              setThreadSearch('');
            }}
            aria-label="Close mobile message search"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#5A6B64] dark:text-[#8FA3AD] cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Active Search Filter & Match Navigation Strip */}
      {threadSearch.trim().length > 0 && (
        <div
          role="region"
          aria-label="Search results controls"
          className="px-4 sm:px-5 py-2 bg-[#F8FAF9] dark:bg-[#141F26] border-b border-[#E5E9E7] dark:border-[#223039] flex flex-wrap items-center justify-between gap-2 shrink-0"
        >
          <div className="flex items-center gap-3 text-xs">
            <span className="font-medium text-[#0F1B17] dark:text-[#EEF3F1] tabular-nums">
              {matchIds.length === 0
                ? '0 matches'
                : `${safeMatchIndex + 1} of ${matchIds.length} ${matchIds.length === 1 ? 'match' : 'matches'}`}
            </span>

            {matchIds.length > 0 && (
              <div className="inline-flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => jumpMatch(-1)}
                  aria-label="Previous matching message"
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-[#5A6B64] dark:text-[#8FA3AD] hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                >
                  <ChevronUp className="w-4 h-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => jumpMatch(1)}
                  aria-label="Next matching message"
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-[#5A6B64] dark:text-[#8FA3AD] hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                >
                  <ChevronDown className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="inline-flex items-center p-0.5 rounded-lg bg-[#EAEFED] dark:bg-[#1E2D36]">
              <button
                type="button"
                onClick={() => setSearchFilterMode('filter')}
                aria-pressed={searchFilterMode === 'filter'}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  searchFilterMode === 'filter'
                    ? 'bg-white dark:bg-[#283B46] text-[#0F1B17] dark:text-[#EEF3F1] shadow-xs'
                    : 'text-[#5A6B64] dark:text-[#8FA3AD]'
                }`}
              >
                Matches only
              </button>
              <button
                type="button"
                onClick={() => setSearchFilterMode('context')}
                aria-pressed={searchFilterMode === 'context'}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  searchFilterMode === 'context'
                    ? 'bg-white dark:bg-[#283B46] text-[#0F1B17] dark:text-[#EEF3F1] shadow-xs'
                    : 'text-[#5A6B64] dark:text-[#8FA3AD]'
                }`}
              >
                Full thread
              </button>
            </div>

            <button
              type="button"
              onClick={() => setThreadSearch('')}
              className="px-2.5 py-1 rounded-lg text-xs font-medium text-[#5A6B64] dark:text-[#8FA3AD] hover:text-[#0F1B17] dark:hover:text-[#EEF3F1] hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Message Canvas */}
      <div
        data-testid="message-list"
        className={`flex-1 overflow-y-auto ark-scroll px-4 sm:px-8 py-5 ${
          wallpaper === 'subtle' ? 'ark-chat-wallpaper' : 'bg-[#F4F6F5] dark:bg-[#0B141A]'
        }`}
      >
        <div className="max-w-3xl mx-auto">
          {/* Quiet WhatsApp-style 48h auto-delete retention notice */}
          {!threadSearch.trim() && (
            <div className="flex justify-center mb-4">
              <p className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/85 dark:bg-[#17232A]/90 border border-[#E5EAE7] dark:border-[#24343E] text-[11px] text-[#5A6B64] dark:text-[#8FA3AD] text-center">
                <Clock className="w-3.5 h-3.5 text-[#0D7A5F] dark:text-[#34D399] shrink-0" aria-hidden="true" />
                <span>Messages and uploaded files auto-delete from the local database and server after 48 hours.</span>
              </p>
            </div>
          )}

          {messages.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm font-medium text-[#0F1B17] dark:text-[#EEF3F1] mb-1">
                Start the conversation with {activeChat.displayName}
              </p>
              <p className="text-xs text-[#5A6B64] dark:text-[#8FA3AD]">
                Messages and files sync live on your local server and auto-delete after 48 hours.
              </p>
            </div>
          ) : visibleMessages.length === 0 && threadSearch.trim() ? (
            <div className="py-16 text-center flex flex-col items-center">
              <div className="w-11 h-11 rounded-xl bg-white dark:bg-[#17232A] border border-[#E5EAE7] dark:border-[#24343E] text-[#5A6B64] dark:text-[#8FA3AD] flex items-center justify-center mb-3">
                <Search className="w-5 h-5" aria-hidden="true" />
              </div>
              <p className="text-sm font-medium text-[#0F1B17] dark:text-[#EEF3F1] mb-1">
                No messages match &ldquo;{threadSearch.trim()}&rdquo;
              </p>
              <p className="text-xs text-[#5A6B64] dark:text-[#8FA3AD] mb-4">
                Try another keyword or return to the full conversation.
              </p>
              <button
                type="button"
                onClick={() => setThreadSearch('')}
                className="px-3.5 py-2 rounded-xl bg-white dark:bg-[#17232A] border border-[#D8E1DD] dark:border-[#24343E] text-xs font-medium text-[#0F1B17] dark:text-[#EEF3F1] hover:bg-[#F8FAF9] dark:hover:bg-[#1E2E37] transition-colors cursor-pointer"
              >
                Clear search
              </button>
            </div>
          ) : (
            dateGroups.map((group) => (
              <section key={group.dateKey} aria-label={group.label} className="mb-4">
                <div className="flex justify-center my-4">
                  <span className="text-xs font-medium text-[#5A6B64] dark:text-[#90A4AE] bg-white/90 dark:bg-[#17232A]/95 border border-[#E5EAE7] dark:border-[#24343E] px-3 py-1 rounded-lg">
                    {group.label}
                  </span>
                </div>

                {group.messages.map((msg, idx) => {
                  const prev = idx > 0 ? group.messages[idx - 1] : null;
                  const showSenderName = !prev || prev.senderId !== msg.senderId;
                  const msgReactions = aggregateReactions(
                    reactionsByMessageId[msg.id] ?? [],
                    currentUser.uid,
                  );

                  return (
                    <MessageBubble
                      key={msg.id}
                      message={msg}
                      isOwn={msg.senderId === currentUser.uid}
                      isGroup={activeChat.chat.type === 'group'}
                      showSenderName={showSenderName}
                      isStarred={starredIds.has(msg.id)}
                      reactions={msgReactions}
                      profilesById={profiles}
                      highlightQuery={threadSearch}
                      isActiveSearchMatch={Boolean(threadSearch.trim()) && msg.id === activeMatchId}
                      onReply={(target) => {
                        setEditingMessage(null);
                        setReplyTarget({
                          messageId: target.id,
                          senderName: target.senderName,
                          text:
                            target.text ||
                            (target.type === 'image'
                              ? 'Photo'
                              : target.type === 'file'
                                ? `File: ${target.fileName || 'Attachment'}`
                                : 'Voice note'),
                        });
                        textareaRef.current?.focus();
                      }}
                      onReact={(id, emoji) => {
                        void onToggleReaction(id, emoji);
                      }}
                      onStar={(target) => {
                        void onToggleStar(target);
                      }}
                      onEdit={(target) => {
                        setReplyTarget(null);
                        setPendingAttachment(null);
                        setEditingMessage(target);
                        setDraft(target.text);
                        textareaRef.current?.focus();
                      }}
                      onDelete={(id) => {
                        void onDeleteMessage(id);
                      }}
                      onOpenImage={onOpenImage}
                    />
                  );
                })}
              </section>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Composer Footer */}
      <footer className="bg-white dark:bg-[#17232A] border-t border-[#E5E9E7] dark:border-[#223039] px-3 sm:px-5 py-3 shrink-0">
        <div className="max-w-3xl mx-auto">
          {/* Quoted Reply or Edit Banner */}
          {(replyTarget || editingMessage) && (
            <div className="mb-2.5 px-3.5 py-2 rounded-xl bg-[#F2F5F3] dark:bg-[#1E2D36] flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[#0D7A5F] dark:text-[#34D399]">
                  {editingMessage
                    ? 'Editing message'
                    : `Replying to ${replyTarget?.senderName}`}
                </p>
                <p className="text-xs text-[#5A6B64] dark:text-[#8FA3AD] truncate">
                  {editingMessage ? editingMessage.text : replyTarget?.text}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setReplyTarget(null);
                  setEditingMessage(null);
                  if (editingMessage) setDraft('');
                }}
                aria-label="Cancel reply or edit"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[#5A6B64] hover:bg-black/5 dark:text-[#8FA3AD] dark:hover:bg-white/10 shrink-0 cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          )}

          {/* Pending Photo or File Attachment Preview */}
          {pendingAttachment && (
            <div className="mb-2.5 p-2.5 rounded-xl bg-[#F2F5F3] dark:bg-[#1E2D36] inline-flex items-center gap-3 max-w-full">
              {pendingAttachment.kind === 'image' && pendingAttachment.previewUrl ? (
                <img
                  src={pendingAttachment.previewUrl}
                  alt="Selected image attachment preview"
                  className="w-16 h-16 rounded-lg object-cover shrink-0"
                />
              ) : (
                <div className="w-11 h-11 rounded-lg bg-[#0D7A5F]/12 text-[#0D7A5F] dark:bg-[#10B981]/20 dark:text-[#34D399] flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5" aria-hidden="true" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[#0F1B17] dark:text-[#EEF3F1] truncate max-w-[220px]">
                  {pendingAttachment.file.name}
                </p>
                <p className="text-[11px] text-[#5A6B64] dark:text-[#8FA3AD] tabular-nums">
                  {formatFileSize(pendingAttachment.file.size)} · Auto-deletes in 48h
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPendingAttachment(null)}
                aria-label="Remove attached file"
                className="w-7 h-7 rounded-lg bg-white/80 dark:bg-[#17232A] flex items-center justify-center text-[#5A6B64] hover:text-[#0F1B17] dark:text-[#8FA3AD] shrink-0 cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          )}

          {composerError && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400 mb-2">
              {composerError}
            </p>
          )}

          {/* Emoji Picker Popover */}
          {showEmojiMenu && (
            <div
              role="dialog"
              aria-label="Emoji picker"
              className="mb-2.5 p-2.5 rounded-xl bg-[#F8FAF9] dark:bg-[#1D2B33] border border-[#E5E9E7] dark:border-[#2A3B45] grid grid-cols-8 gap-1"
            >
              {PICKER_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    setDraft((d) => `${d}${emoji}`);
                    textareaRef.current?.focus();
                  }}
                  aria-label={`Insert ${emoji}`}
                  className="h-9 rounded-lg hover:bg-white dark:hover:bg-[#263842] flex items-center justify-center text-lg cursor-pointer"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}

          {/* Recording Bar OR Standard Composer Form */}
          {isRecording ? (
            <div className="flex items-center justify-between gap-3 h-11 px-3 rounded-xl bg-[#F2F5F3] dark:bg-[#1E2D36]">
              <div className="flex items-center gap-2.5 text-sm font-medium text-red-600 dark:text-red-400">
                <span className="w-2.5 h-2.5 rounded-full bg-red-600" aria-hidden="true" />
                <span>Recording voice note</span>
                <span className="tabular-nums text-[#0F1B17] dark:text-[#EEF3F1]">
                  {formatVoiceDuration(recordSeconds)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void stopVoiceRecording(true)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-[#5A6B64] dark:text-[#8FA3AD] hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void stopVoiceRecording(false)}
                  aria-label="Send voice note"
                  className="h-9 px-3.5 rounded-lg bg-[#0D7A5F] hover:bg-[#0A644E] text-white text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                  <span>Send clip</span>
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={(e) => void handleSubmit(e)} className="flex items-end gap-2">
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowEmojiMenu((v) => !v)}
                  aria-label="Toggle emoji picker"
                  aria-expanded={showEmojiMenu}
                  className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
                    showEmojiMenu
                      ? 'bg-[#DDF5EC] text-[#0D7A5F] dark:bg-[#123D33] dark:text-[#34D399]'
                      : 'text-[#5A6B64] dark:text-[#8FA3AD] hover:bg-[#F2F5F3] dark:hover:bg-[#22323B]'
                  }`}
                >
                  <Smile className="w-5 h-5" aria-hidden="true" />
                </button>

                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => void handlePhotoChange(e)}
                  className="hidden"
                  aria-hidden="true"
                />
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  aria-label="Attach photo"
                  title="Attach photo"
                  className="w-11 h-11 rounded-xl flex items-center justify-center text-[#5A6B64] dark:text-[#8FA3AD] hover:bg-[#F2F5F3] dark:hover:bg-[#22323B] transition-colors cursor-pointer"
                >
                  <ImagePlus className="w-5 h-5" aria-hidden="true" />
                </button>

                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleGenericFileChange}
                  className="hidden"
                  aria-hidden="true"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Attach file"
                  title="Attach file (auto-deletes in 48h)"
                  className="w-11 h-11 rounded-xl flex items-center justify-center text-[#5A6B64] dark:text-[#8FA3AD] hover:bg-[#F2F5F3] dark:hover:bg-[#22323B] transition-colors cursor-pointer"
                >
                  <Paperclip className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>

              <textarea
                ref={textareaRef}
                rows={1}
                value={draft}
                onChange={(e) => handleDraftChange(e.target.value)}
                onKeyDown={handleKeyDown}
                maxLength={LIMITS.MESSAGE_TEXT_MAX}
                placeholder={
                  uploading
                    ? 'Uploading to local server…'
                    : pendingAttachment
                      ? 'Add a caption (optional)…'
                      : 'Type a message'
                }
                aria-label="Message input"
                className="flex-1 min-h-[44px] max-h-32 resize-none px-4 py-2.5 rounded-xl bg-[#F2F5F3] dark:bg-[#1E2D36] text-[14.5px] text-[#0F1B17] dark:text-[#EEF3F1] placeholder:text-[#6B7C75] dark:placeholder:text-[#7D919B] border border-transparent focus:border-[#0D7A5F] dark:focus:border-[#10B981] focus:bg-white dark:focus:bg-[#142027] focus:outline-none transition-colors"
              />

              {draft.trim().length > 0 || pendingAttachment || editingMessage ? (
                <button
                  type="submit"
                  disabled={uploading}
                  aria-label={editingMessage ? 'Save edited message' : 'Send message'}
                  className="w-11 h-11 rounded-xl bg-[#0D7A5F] hover:bg-[#0A644E] disabled:opacity-60 text-white flex items-center justify-center shrink-0 transition-colors cursor-pointer disabled:cursor-not-allowed"
                >
                  <SendHorizontal className="w-5 h-5" aria-hidden="true" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void startVoiceRecording()}
                  aria-label="Record voice note"
                  title="Record voice note"
                  className="w-11 h-11 rounded-xl bg-[#F2F5F3] dark:bg-[#1E2D36] hover:bg-[#E5ECE8] dark:hover:bg-[#263842] text-[#0F1B17] dark:text-[#EEF3F1] flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                >
                  <Mic className="w-5 h-5" aria-hidden="true" />
                </button>
              )}
            </form>
          )}
        </div>
      </footer>
    </main>
  );
}
