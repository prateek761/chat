import { useEffect, useRef, useState } from 'react';
import {
  Check,
  CheckCheck,
  Download,
  FileText,
  Pause,
  Pencil,
  Play,
  Reply,
  SmilePlus,
  Star,
  Trash2,
} from 'lucide-react';
import { buildAuthedFileUrl } from '../lib/localApi';
import type { AggregatedReaction, ChatMessage, UserProfile } from '../types/chat';
import {
  formatFileSize,
  formatMessageTime,
  formatTimeRemaining,
  formatVoiceDuration,
  getMessageReadStatus,
  QUICK_REACTION_EMOJIS,
} from '../utils/chatLogic';

interface MessageBubbleProps {
  message: ChatMessage;
  isOwn: boolean;
  isGroup: boolean;
  showSenderName: boolean;
  isStarred: boolean;
  reactions: AggregatedReaction[];
  profilesById?: Record<string, UserProfile>;
  highlightQuery?: string;
  isActiveSearchMatch?: boolean;
  onReply: (message: ChatMessage) => void;
  onReact: (messageId: string, emoji: string) => void;
  onStar: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  onDelete: (messageId: string) => void;
  onOpenImage: (src: string, caption: string, senderName: string) => void;
}

const SENDER_COLORS = [
  'text-[#0D7A5F] dark:text-[#34D399]',
  'text-[#2563EB] dark:text-[#60A5FA]',
  'text-[#B45309] dark:text-[#FBBF24]',
  'text-[#7C3AED] dark:text-[#A78BFA]',
  'text-[#BE185D] dark:text-[#F472B6]',
];

const WAVEFORM_BARS = [35, 65, 48, 82, 58, 92, 40, 72, 85, 50, 66, 95, 44, 70, 56, 78, 42, 60];

function getSenderColor(senderId: string): string {
  let hash = 0;
  for (let i = 0; i < senderId.length; i += 1) {
    hash = (hash * 31 + senderId.charCodeAt(i)) % SENDER_COLORS.length;
  }
  return SENDER_COLORS[Math.abs(hash) % SENDER_COLORS.length];
}

function renderHighlightedText(text: string, query?: string) {
  if (!query || !query.trim()) return text;
  const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return parts.map((part, idx) =>
    part.toLowerCase() === query.trim().toLowerCase() ? (
      <mark
        key={idx}
        className="bg-amber-200/80 dark:bg-amber-500/40 text-inherit rounded px-0.5"
      >
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

export function MessageBubble({
  message,
  isOwn,
  isGroup,
  showSenderName,
  isStarred,
  reactions,
  profilesById,
  highlightQuery,
  isActiveSearchMatch = false,
  onReply,
  onReact,
  onStar,
  onEdit,
  onDelete,
  onOpenImage,
}: MessageBubbleProps) {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isPlayingVoice, setIsPlayingVoice] = useState(false);
  const [voiceProgress, setVoiceProgress] = useState(0);
  const voiceTimerRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (voiceTimerRef.current) window.clearInterval(voiceTimerRef.current);
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  const toggleVoicePlayback = () => {
    if (isPlayingVoice) {
      setIsPlayingVoice(false);
      if (voiceTimerRef.current) {
        window.clearInterval(voiceTimerRef.current);
        voiceTimerRef.current = null;
      }
      if (audioRef.current) {
        audioRef.current.pause();
      }
      return;
    }

    const resolvedAudioUrl = buildAuthedFileUrl(message.mediaUrl);
    if (
      resolvedAudioUrl &&
      (resolvedAudioUrl.startsWith('data:audio') || resolvedAudioUrl.startsWith('/api/files/'))
    ) {
      const audio = audioRef.current ?? new Audio(resolvedAudioUrl);
      audioRef.current = audio;
      audio.onended = () => {
        setIsPlayingVoice(false);
        setVoiceProgress(0);
      };
      audio.ontimeupdate = () => {
        if (audio.duration > 0) {
          setVoiceProgress(audio.currentTime / audio.duration);
        }
      };
      void audio.play().catch(() => {
        setIsPlayingVoice(false);
      });
      setIsPlayingVoice(true);
      return;
    }

    // Playable timeline fallback for seeded voice notes without raw binary audio
    const totalMs = Math.max(2000, (message.voiceDurationSec || 8) * 1000);
    const startAt = Date.now() - voiceProgress * totalMs;
    setIsPlayingVoice(true);
    voiceTimerRef.current = window.setInterval(() => {
      const elapsed = Date.now() - startAt;
      if (elapsed >= totalMs) {
        if (voiceTimerRef.current) window.clearInterval(voiceTimerRef.current);
        voiceTimerRef.current = null;
        setVoiceProgress(0);
        setIsPlayingVoice(false);
      } else {
        setVoiceProgress(elapsed / totalMs);
      }
    }, 100);
  };

  const receipt = getMessageReadStatus(message, profilesById);

  const [showMobileActions, setShowMobileActions] = useState(false);

  return (
    <div
      id={`msg-${message.id}`}
      data-testid={`message-${message.id}`}
      className={`group flex flex-col ${isOwn ? 'items-end' : 'items-start'} mb-2`}
    >
      <div
        className={`relative flex items-end gap-1.5 w-full ${
          isOwn ? 'justify-end' : 'justify-start'
        }`}
      >
        {/* Main Message Bubble — owns max-width directly so action buttons never squeeze it */}
        <div
          onClick={() => {
            if (!message.deleted) setShowMobileActions((v) => !v);
          }}
          className={`relative max-w-[84%] sm:max-w-[72%] lg:max-w-[64%] rounded-2xl px-3.5 py-2 text-[14.5px] leading-[1.45] break-words transition-all ${
            isOwn
              ? 'order-2 bg-[#DDF5EC] dark:bg-[#0C4E3E] text-[#0B2A21] dark:text-[#ECFDF5] rounded-tr-sm'
              : 'order-1 bg-white dark:bg-[#1C2A32] text-[#0F1B17] dark:text-[#EEF3F1] border border-[#E5EAE7] dark:border-[#24343E] rounded-tl-sm'
          } ${
            isActiveSearchMatch
              ? 'ring-2 ring-amber-500 dark:ring-amber-400 ring-offset-2 ring-offset-[#F0F3F1] dark:ring-offset-[#0B141A]'
              : ''
          }`}
        >
          {isGroup && !isOwn && showSenderName && (
            <p className={`text-xs font-semibold mb-1 ${getSenderColor(message.senderId)}`}>
              {message.senderName}
            </p>
          )}

          {/* Quoted Reply Preview (clean tinted surface, no thick left stripe) */}
          {message.replyToId && !message.deleted && (
            <div
              className={`mb-2 px-2.5 py-1.5 rounded-lg text-xs ${
                isOwn
                  ? 'bg-[#0D7A5F]/10 dark:bg-black/25 text-[#0F3D30] dark:text-[#C4F0DF]'
                  : 'bg-[#F2F5F3] dark:bg-[#142027] text-[#45564F] dark:text-[#9BB0BA]'
              }`}
            >
              <p className="font-semibold text-[11px] mb-0.5 truncate">
                {message.replyToSender || 'Message'}
              </p>
              <p className="line-clamp-2 opacity-85">{message.replyToText}</p>
            </div>
          )}

          {message.deleted ? (
            <p className="italic text-xs opacity-70 py-0.5">This message was deleted</p>
          ) : (
            <>
              {/* Image attachment */}
              {message.type === 'image' && message.mediaUrl && (() => {
                const resolvedImgUrl = buildAuthedFileUrl(message.mediaUrl);
                return (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenImage(resolvedImgUrl, message.text, message.senderName);
                    }}
                    aria-label={`View photo from ${message.senderName}`}
                    className="block w-full mb-1.5 rounded-xl overflow-hidden focus-visible:outline-2 focus-visible:outline-[#0D7A5F] cursor-pointer"
                  >
                    <img
                      src={resolvedImgUrl}
                      alt={message.text || `Photo shared by ${message.senderName}`}
                      referrerPolicy="no-referrer"
                      className="w-full max-w-[320px] max-h-64 object-cover hover:opacity-95 transition-opacity"
                    />
                  </button>
                );
              })()}

              {/* Generic File attachment stored on local server */}
              {message.type === 'file' && (() => {
                const downloadUrl = buildAuthedFileUrl(
                  message.mediaUrl
                    ? `${message.mediaUrl}${message.mediaUrl.includes('?') ? '&' : '?'}download=1`
                    : '',
                );
                return (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className={`mb-1.5 flex items-center gap-3 p-2.5 rounded-xl min-w-[220px] sm:min-w-[260px] ${
                      isOwn
                        ? 'bg-[#0D7A5F]/12 dark:bg-black/25'
                        : 'bg-[#F2F5F3] dark:bg-[#142027]'
                    }`}
                  >
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                        isOwn
                          ? 'bg-[#0D7A5F] text-white'
                          : 'bg-[#0D7A5F]/12 text-[#0D7A5F] dark:bg-[#10B981]/20 dark:text-[#34D399]'
                      }`}
                    >
                      <FileText className="w-5 h-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold truncate">
                        {renderHighlightedText(message.fileName || 'Attachment', highlightQuery)}
                      </p>
                      <p className="text-[11px] opacity-75 tabular-nums truncate">
                        {formatFileSize(message.fileSize || 0)}
                        {message.expiresAtMs ? ` · ${formatTimeRemaining(message.expiresAtMs)}` : ''}
                      </p>
                    </div>
                    {downloadUrl && (
                      <a
                        href={downloadUrl}
                        download={message.fileName || 'attachment'}
                        aria-label={`Download ${message.fileName || 'file'}`}
                        title="Download file"
                        className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                          isOwn
                            ? 'text-[#0B2A21] dark:text-[#CCF3E6] hover:bg-black/10 dark:hover:bg-white/10'
                            : 'text-[#394A43] dark:text-[#B4C5CE] hover:bg-black/5 dark:hover:bg-white/10'
                        }`}
                      >
                        <Download className="w-4 h-4" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                );
              })()}

              {/* Voice note player */}
              {message.type === 'voice' && (
                <div
                  className="flex items-center gap-3 py-1 min-w-[205px] sm:min-w-[240px]"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={toggleVoicePlayback}
                    aria-label={isPlayingVoice ? 'Pause voice note' : 'Play voice note'}
                    className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                      isOwn
                        ? 'bg-[#0D7A5F] text-white hover:bg-[#0A644E]'
                        : 'bg-[#0D7A5F]/12 text-[#0D7A5F] dark:bg-[#10B981]/20 dark:text-[#34D399]'
                    }`}
                  >
                    {isPlayingVoice ? (
                      <Pause className="w-4 h-4" aria-hidden="true" />
                    ) : (
                      <Play className="w-4 h-4 ml-0.5" aria-hidden="true" />
                    )}
                  </button>

                  <div className="flex-1 flex flex-col gap-1">
                    <div className="flex items-center gap-[3px] h-6" aria-hidden="true">
                      {WAVEFORM_BARS.map((height, idx) => {
                        const filled = idx / WAVEFORM_BARS.length <= voiceProgress;
                        return (
                          <span
                            key={idx}
                            style={{ height: `${Math.max(24, height)}%` }}
                            className={`flex-1 rounded-full transition-colors ${
                              filled
                                ? 'bg-[#0D7A5F] dark:bg-[#34D399]'
                                : isOwn
                                  ? 'bg-[#0D7A5F]/30 dark:bg-white/25'
                                  : 'bg-[#CBD5D0] dark:bg-[#3A4D58]'
                            }`}
                          />
                        );
                      })}
                    </div>
                    <span className="text-[11px] opacity-75 tabular-nums">
                      {formatVoiceDuration(
                        isPlayingVoice
                          ? Math.round(voiceProgress * (message.voiceDurationSec || 8))
                          : message.voiceDurationSec || 0,
                      )}
                    </span>
                  </div>
                </div>
              )}

              {/* Text content */}
              {message.text && message.type !== 'voice' && (
                <p className="whitespace-pre-wrap">{renderHighlightedText(message.text, highlightQuery)}</p>
              )}
            </>
          )}

          {/* Timestamp, Starred & Read Receipt Footer */}
          <div
            className={`mt-1 flex items-center justify-end gap-1.5 text-[11px] tabular-nums select-none ${
              isOwn
                ? 'text-[#366656] dark:text-[#96DCC5]'
                : 'text-[#6B7C75] dark:text-[#869BA6]'
            }`}
          >
            {isStarred && !message.deleted && (
              <Star className="w-3 h-3 fill-current text-amber-500" aria-label="Starred message" />
            )}
            {message.edited && !message.deleted && <span>Edited</span>}
            <span title={message.expiresAtMs ? `Auto-deletes: ${formatTimeRemaining(message.expiresAtMs)}` : undefined}>
              {formatMessageTime(message.createdAtMs)}
            </span>
            {isOwn && !message.deleted && (
              receipt.status === 'read' ? (
                <span
                  title={receipt.label}
                  className="inline-flex items-center"
                >
                  <CheckCheck
                    className="w-3.5 h-3.5 text-[#0284C7] dark:text-[#38BDF8]"
                    aria-label={receipt.label}
                  />
                </span>
              ) : (
                <span title="Sent" className="inline-flex items-center">
                  <Check className="w-3.5 h-3.5 opacity-75" aria-label="Sent" />
                </span>
              )
            )}
          </div>
        </div>

        {/* Desktop Side Action Toolbar (does not constrain bubble width) */}
        {!message.deleted && (
          <div
            className={`hidden sm:flex relative items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0 ${
              isOwn ? 'order-1' : 'order-2'
            }`}
          >
            <button
              type="button"
              onClick={() => setShowEmojiPicker((v) => !v)}
              aria-label={`React to message from ${message.senderName}`}
              title="React"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[#5A6B64] dark:text-[#8FA3AD] hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
            >
              <SmilePlus className="w-4 h-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onReply(message)}
              aria-label={`Reply to ${message.senderName}`}
              title="Reply"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[#5A6B64] dark:text-[#8FA3AD] hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
            >
              <Reply className="w-4 h-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onStar(message)}
              aria-label={isStarred ? `Unstar message from ${message.senderName}` : `Star message from ${message.senderName}`}
              title={isStarred ? 'Unstar' : 'Star'}
              className={`w-8 h-8 rounded-lg flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer ${
                isStarred ? 'text-amber-500' : 'text-[#5A6B64] dark:text-[#8FA3AD]'
              }`}
            >
              <Star className={`w-4 h-4 ${isStarred ? 'fill-current' : ''}`} aria-hidden="true" />
            </button>
            {isOwn && message.type === 'text' && (
              <button
                type="button"
                onClick={() => onEdit(message)}
                aria-label="Edit message"
                title="Edit"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[#5A6B64] dark:text-[#8FA3AD] hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
              >
                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
            {isOwn && (
              <button
                type="button"
                onClick={() => onDelete(message.id)}
                aria-label="Delete message"
                title="Delete"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[#5A6B64] dark:text-[#8FA3AD] hover:text-red-600 dark:hover:text-red-400 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}

            {/* Quick Reaction Popover */}
            {showEmojiPicker && (
              <div
                role="menu"
                aria-label="Choose a reaction"
                className={`absolute bottom-10 ${isOwn ? 'right-0' : 'left-0'} z-20 flex items-center gap-1 px-2 py-1.5 rounded-full bg-white dark:bg-[#1E2E37] border border-[#DCE4E0] dark:border-[#2C3F4B] shadow-lg`}
              >
                {QUICK_REACTION_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => {
                      onReact(message.id, emoji);
                      setShowEmojiPicker(false);
                    }}
                    aria-label={`React with ${emoji}`}
                    className="w-8 h-8 rounded-full hover:bg-[#F0F4F2] dark:hover:bg-[#2A3D48] flex items-center justify-center text-base transition-transform hover:scale-110 cursor-pointer"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Mobile Tap-to-Reveal Action Strip (full width free, never squeezes bubble) */}
      {!message.deleted && showMobileActions && (
        <div
          className={`sm:hidden mt-1.5 flex items-center gap-1 px-1.5 py-1 rounded-xl bg-white dark:bg-[#1E2E37] border border-[#DCE4E0] dark:border-[#2C3F4B] shadow-sm ${
            isOwn ? 'self-end' : 'self-start'
          }`}
        >
          {QUICK_REACTION_EMOJIS.slice(0, 3).map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                onReact(message.id, emoji);
                setShowMobileActions(false);
              }}
              aria-label={`React with ${emoji}`}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-sm hover:bg-black/5 dark:hover:bg-white/10"
            >
              {emoji}
            </button>
          ))}
          <span className="w-px h-4 bg-[#E5E9E7] dark:bg-[#2C3F4B] mx-0.5" aria-hidden="true" />
          <button
            type="button"
            onClick={() => {
              onReply(message);
              setShowMobileActions(false);
            }}
            aria-label={`Reply to ${message.senderName}`}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#5A6B64] dark:text-[#8FA3AD]"
          >
            <Reply className="w-4 h-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => {
              onStar(message);
              setShowMobileActions(false);
            }}
            aria-label={isStarred ? `Unstar message from ${message.senderName}` : `Star message from ${message.senderName}`}
            className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              isStarred ? 'text-amber-500' : 'text-[#5A6B64] dark:text-[#8FA3AD]'
            }`}
          >
            <Star className={`w-4 h-4 ${isStarred ? 'fill-current' : ''}`} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Interactive Reactions Row */}
      {reactions.length > 0 && !message.deleted && (
        <div className={`flex flex-wrap items-center gap-1 mt-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
          {reactions.map((r) => (
            <button
              key={r.emoji}
              type="button"
              onClick={() => onReact(message.id, r.emoji)}
              aria-label={`Toggle ${r.emoji} reaction (${r.count})`}
              className={`h-6 px-2 rounded-full text-xs inline-flex items-center gap-1 border transition-colors cursor-pointer ${
                r.reactedByMe
                  ? 'bg-[#DDF5EC] dark:bg-[#123D33] border-[#0D7A5F]/40 dark:border-[#10B981]/50 text-[#0B2A21] dark:text-[#ECFDF5]'
                  : 'bg-white dark:bg-[#1C2A32] border-[#E0E7E4] dark:border-[#2A3B45] text-[#45564F] dark:text-[#B4C5CE]'
              }`}
            >
              <span>{r.emoji}</span>
              {r.count > 1 && <span className="tabular-nums font-medium">{r.count}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
