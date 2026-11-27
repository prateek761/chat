import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateReactions,
  extractCompanyIdFromEmail,
  filterAndSortChats,
  filterMessagesByQuery,
  formatAuthError,
  formatChatListTime,
  formatFileSize,
  formatLastSeen,
  formatTimeRemaining,
  formatVoiceDuration,
  getDirectChatId,
  getInitials,
  getMessageReadStatus,
  getUnreadMessagesForUser,
  groupMessagesByDate,
  LIMITS,
  markMessagesReadByUser,
  normalizePhoneNumber,
  resolveCompanyIdLogin,
  sanitizeHandle,
  searchMessagesInThread,
  validateCompanyAuthForm,
  validateGroupForm,
  validateMessageInput,
  validatePhoneOtp,
  validateProfileForm,
} from './chatLogic';
import type { ChatMessage, EnrichedChatItem, MessageReaction } from '../types/chat';

test('getDirectChatId produces identical deterministic ID regardless of argument order', () => {
  assert.equal(getDirectChatId('uid_maya', 'uid_alex'), getDirectChatId('uid_alex', 'uid_maya'));
  assert.equal(getDirectChatId('uid_maya', 'uid_alex'), 'dm_uid_alex_uid_maya');
});

test('validation helpers enforce blueprint limits and reject empty/oversized inputs', () => {
  assert.equal(validateMessageInput('   ', false), 'Enter a message before sending.');
  assert.equal(validateMessageInput('', true), null);
  assert.equal(validateMessageInput('Hello ARK DM', false), null);
  assert.ok(validateMessageInput('x'.repeat(LIMITS.MESSAGE_TEXT_MAX + 1), false));

  assert.equal(validateGroupForm('', '', ['u2']), 'Enter a group name.');
  assert.equal(validateGroupForm('Launch Crew', '', []), 'Select at least one participant to create a group.');
  assert.equal(validateGroupForm('Launch Crew', 'Shipping v1', ['u2', 'u3']), null);
  assert.ok(
    validateGroupForm(
      'Huge',
      '',
      Array.from({ length: LIMITS.MAX_PARTICIPANTS }, (_, i) => `u_${i}`),
    ),
  );

  assert.equal(validateProfileForm('', 'alex', ''), 'Display name is required.');
  assert.equal(validateProfileForm('Alex', 'bad handle!', ''), 'Handle may only use lowercase letters, numbers, dots, underscores, or hyphens.');
  assert.equal(validateProfileForm('Alex', 'alex.rivera', 'Available'), null);
});

test('sanitizeHandle normalizes arbitrary user names into blueprint-valid handles', () => {
  assert.equal(sanitizeHandle('Maya Lin! '), 'maya_lin_');
  assert.equal(sanitizeHandle('A'), 'user_a');
});

test('filterAndSortChats pins first, orders by recency, and separates archived from active', () => {
  const makeItem = (overrides: Partial<EnrichedChatItem> & { id: string; lastMessageAtMs: number }): EnrichedChatItem => ({
    chat: {
      id: overrides.id,
      type: overrides.chat?.type ?? 'direct',
      name: overrides.displayName ?? overrides.id,
      description: '',
      avatarUrl: '',
      createdBy: 'me',
      participantIds: ['me', 'other'],
      lastMessageText: overrides.chat?.lastMessageText ?? 'Hello',
      lastMessageSenderId: 'other',
      lastMessageAtMs: overrides.lastMessageAtMs,
      createdAtMs: 1000,
      updatedAtMs: overrides.lastMessageAtMs,
    },
    displayName: overrides.displayName ?? overrides.id,
    subtitle: '',
    avatarUrl: '',
    isOnline: false,
    lastSeenMs: 1000,
    pinned: overrides.pinned ?? false,
    muted: overrides.muted ?? false,
    archived: overrides.archived ?? false,
    unreadCount: overrides.unreadCount ?? 0,
    lastMessageRead: overrides.lastMessageRead ?? false,
    typingNames: [],
  });

  const chats: EnrichedChatItem[] = [
    makeItem({ id: 'old_pinned', displayName: 'Maya', pinned: true, lastMessageAtMs: 100 }),
    makeItem({ id: 'newest', displayName: 'Marcus', unreadCount: 2, lastMessageAtMs: 500 }),
    makeItem({
      id: 'group_chat',
      displayName: 'ARK Core',
      chat: {
        id: 'group_chat', type: 'group', name: 'ARK Core', description: '', avatarUrl: '',
        createdBy: 'me', participantIds: ['me', 'u2', 'u3'], lastMessageText: 'Ship ready',
        lastMessageSenderId: 'u2', lastMessageAtMs: 300, createdAtMs: 100, updatedAtMs: 300,
      },
      lastMessageAtMs: 300,
    }),
    makeItem({ id: 'arch', displayName: 'Old Archive', archived: true, lastMessageAtMs: 900 }),
  ];

  const all = filterAndSortChats(chats, 'all', '');
  assert.deepEqual(all.map((c) => c.chat.id), ['old_pinned', 'newest', 'group_chat']);

  const unread = filterAndSortChats(chats, 'unread', '');
  assert.deepEqual(unread.map((c) => c.chat.id), ['newest']);

  const groups = filterAndSortChats(chats, 'groups', '');
  assert.deepEqual(groups.map((c) => c.chat.id), ['group_chat']);

  const archived = filterAndSortChats(chats, 'archived', '');
  assert.deepEqual(archived.map((c) => c.chat.id), ['arch']);

  const searched = filterAndSortChats(chats, 'all', 'ship');
  assert.deepEqual(searched.map((c) => c.chat.id), ['group_chat']);
});

test('groupMessagesByDate splits messages chronologically into Today / Yesterday buckets', () => {
  const now = new Date(2026, 10, 17, 15, 0, 0).getTime();
  const yesterday = new Date(2026, 10, 16, 11, 30, 0).getTime();
  const todayEarly = new Date(2026, 10, 17, 9, 0, 0).getTime();
  const todayLate = new Date(2026, 10, 17, 14, 15, 0).getTime();

  const makeMsg = (id: string, createdAtMs: number): ChatMessage => ({
    id, chatId: 'c1', senderId: 'u1', senderName: 'Maya', participantIds: ['u1', 'u2'],
    type: 'text', text: id, mediaUrl: '', voiceDurationSec: 0,
    replyToId: '', replyToSender: '', replyToText: '',
    edited: false, deleted: false, readBy: ['u1'], createdAtMs, updatedAtMs: createdAtMs,
  });

  const grouped = groupMessagesByDate([makeMsg('m3', todayLate), makeMsg('m1', yesterday), makeMsg('m2', todayEarly)], now);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].label, 'Yesterday');
  assert.deepEqual(grouped[0].messages.map((m) => m.id), ['m1']);
  assert.equal(grouped[1].label, 'Today');
  assert.deepEqual(grouped[1].messages.map((m) => m.id), ['m2', 'm3']);
});

test('aggregateReactions counts reactions accurately and marks current user', () => {
  const reactions: MessageReaction[] = [
    { id: 'm1_u1', chatId: 'c1', messageId: 'm1', userId: 'u1', emoji: '👍', createdAtMs: 1 },
    { id: 'm1_u2', chatId: 'c1', messageId: 'm1', userId: 'u2', emoji: '👍', createdAtMs: 2 },
    { id: 'm1_u3', chatId: 'c1', messageId: 'm1', userId: 'u3', emoji: '🔥', createdAtMs: 3 },
  ];
  const agg = aggregateReactions(reactions, 'u1');
  assert.equal(agg.length, 2);
  assert.deepEqual(agg[0], { emoji: '👍', count: 2, reactedByMe: true, userIds: ['u1', 'u2'] });
  assert.deepEqual(agg[1], { emoji: '🔥', count: 1, reactedByMe: false, userIds: ['u3'] });
});

test('formatting and in-thread search utilities behave cleanly', () => {
  const now = new Date(2026, 10, 17, 15, 0, 0).getTime();
  assert.equal(formatVoiceDuration(75), '1:15');
  assert.equal(formatVoiceDuration(5), '0:05');
  assert.equal(formatLastSeen(now - 120_000, true, now), 'Online');
  assert.equal(formatLastSeen(now - 300_000, false, now), 'Last seen 5m ago');
  assert.equal(formatChatListTime(new Date(2026, 10, 16, 10, 0, 0).getTime(), now), 'Yesterday');
  assert.equal(getInitials('Maya Lin'), 'ML');
  assert.equal(getInitials('ARK'), 'AR');

  assert.equal(formatFileSize(0), '0 B');
  assert.equal(formatFileSize(512), '512 B');
  assert.equal(formatFileSize(1536), '1.5 KB');
  assert.equal(formatFileSize(2 * 1024 * 1024), '2.0 MB');
  assert.equal(formatTimeRemaining(now + 90 * 60_000, now), '1h 30m left');
  assert.equal(formatTimeRemaining(now + 25 * 60_000, now), '25m left');
  assert.equal(formatTimeRemaining(now - 1000, now), 'Expiring now');

  const msgs: ChatMessage[] = [
    {
      id: '1', chatId: 'c1', senderId: 'u1', senderName: 'Maya', participantIds: ['u1'],
      type: 'text', text: 'Send the architecture deck', mediaUrl: '', voiceDurationSec: 0,
      replyToId: '', replyToSender: '', replyToText: '', edited: false, deleted: false,
      readBy: ['u1'], createdAtMs: now, updatedAtMs: now,
    },
    {
      id: '2', chatId: 'c1', senderId: 'u1', senderName: 'Maya', participantIds: ['u1'],
      type: 'text', text: 'Deleted deck', mediaUrl: '', voiceDurationSec: 0,
      replyToId: '', replyToSender: '', replyToText: '', edited: false, deleted: true,
      readBy: ['u1'], createdAtMs: now, updatedAtMs: now,
    },
    {
      id: '3', chatId: 'c1', senderId: 'u1', senderName: 'Maya', participantIds: ['u1'],
      type: 'file', text: '', mediaUrl: '/api/files/f1', fileId: 'f1', fileName: 'Q4-budget-deck.pdf',
      fileMime: 'application/pdf', fileSize: 2048, voiceDurationSec: 0,
      replyToId: '', replyToSender: '', replyToText: '', edited: false, deleted: false,
      readBy: ['u1'], createdAtMs: now, updatedAtMs: now,
    },
  ];
  assert.deepEqual(searchMessagesInThread(msgs, 'deck').map((m) => m.id), ['1', '3']);
  assert.deepEqual(searchMessagesInThread(msgs, 'budget').map((m) => m.id), ['3']);
});

test('filterMessagesByQuery filters matching messages and preserves context mode', () => {
  const now = 1_700_000_000_000;
  const makeMsg = (id: string, text: string, deleted = false): ChatMessage => ({
    id, chatId: 'c1', senderId: 'u1', senderName: 'Maya', participantIds: ['u1', 'u2'],
    type: 'text', text, mediaUrl: '', voiceDurationSec: 0,
    replyToId: '', replyToSender: '', replyToText: '',
    edited: false, deleted, readBy: ['u1'], createdAtMs: now, updatedAtMs: now,
  });

  const msgs = [
    makeMsg('m1', 'Reviewing the contrast tokens'),
    makeMsg('m2', 'Coffee break at 3 PM'),
    makeMsg('m3', 'Deleted contrast note', true),
    makeMsg('m4', 'Final contrast check passed'),
  ];

  const filtered = filterMessagesByQuery(msgs, 'contrast', 'filter');
  assert.deepEqual(filtered.matchIds, ['m1', 'm4']);
  assert.deepEqual(filtered.visibleMessages.map((m) => m.id), ['m1', 'm4']);

  const context = filterMessagesByQuery(msgs, 'contrast', 'context');
  assert.deepEqual(context.matchIds, ['m1', 'm4']);
  assert.equal(context.visibleMessages.length, 4);

  const empty = filterMessagesByQuery(msgs, '', 'filter');
  assert.equal(empty.visibleMessages.length, 4);
  assert.deepEqual(empty.matchIds, []);
});

test('read receipt helpers detect unread incoming messages, mark read idempotently, and summarize status', () => {
  const now = 1_700_000_000_000;
  const msgFromMaya: ChatMessage = {
    id: 'm1', chatId: 'c1', senderId: 'u_maya', senderName: 'Maya Lin',
    participantIds: ['u_maya', 'u_alex'], type: 'text', text: 'Hey!',
    mediaUrl: '', voiceDurationSec: 0, replyToId: '', replyToSender: '', replyToText: '',
    edited: false, deleted: false, readBy: ['u_maya'], createdAtMs: now, updatedAtMs: now,
  };
  const msgFromAlex: ChatMessage = {
    ...msgFromMaya, id: 'm2', senderId: 'u_alex', senderName: 'Alex', readBy: ['u_alex'],
  };

  // Before Alex opens chat: m1 is unread for Alex, m2 is Alex's own message (sent, not read by Maya)
  assert.deepEqual(getUnreadMessagesForUser([msgFromMaya, msgFromAlex], 'u_alex').map((m) => m.id), ['m1']);
  assert.equal(getMessageReadStatus(msgFromAlex).status, 'sent');
  assert.equal(getMessageReadStatus(msgFromAlex).label, 'Sent');

  // Alex opens chat -> marks incoming m1 as read
  const afterAlexReads = markMessagesReadByUser([msgFromMaya, msgFromAlex], 'u_alex');
  assert.deepEqual(afterAlexReads[0].readBy, ['u_maya', 'u_alex']);
  assert.deepEqual(afterAlexReads[1].readBy, ['u_alex']);
  assert.deepEqual(getUnreadMessagesForUser(afterAlexReads, 'u_alex'), []);

  // Idempotency: calling again returns same array reference without duplicates
  assert.equal(markMessagesReadByUser(afterAlexReads, 'u_alex'), afterAlexReads);

  // Maya opens chat -> Alex's message status flips to 'read' with named tooltip
  const afterMayaReads = markMessagesReadByUser(afterAlexReads, 'u_maya');
  const receipt = getMessageReadStatus(afterMayaReads[1], {
    u_maya: {
      uid: 'u_maya', displayName: 'Maya Lin', handle: 'maya', about: '',
      photoURL: '', discoverable: true, isOnline: true, lastSeenMs: now,
    },
  });
  assert.equal(receipt.status, 'read');
  assert.equal(receipt.label, 'Read by Maya Lin');
});

test('formatAuthError translates local server and network errors cleanly', () => {
  assert.match(
    formatAuthError(new TypeError('Failed to fetch')) || '',
    /local ARK DM server/i,
  );
  assert.match(
    formatAuthError(new Error('Session expired')) || '',
    /session expired/i,
  );
  assert.equal(
    formatAuthError(new Error('Incorrect Company ID/email or password.')),
    'Incorrect Company ID/email or password.',
  );
});

test('Company ID login resolver and phone number normalizer validate and format accurately', () => {
  // Manual Company ID -> synthetic email mapping + reverse extraction
  const manual = resolveCompanyIdLogin('ARK-1042');
  assert.ok(!('error' in manual));
  assert.equal(manual.email, 'ark-1042@company.arkdm.app');
  assert.equal(manual.companyId, 'ARK-1042');
  assert.equal(manual.isCorporateEmail, false);
  assert.equal(extractCompanyIdFromEmail(manual.email), 'ark-1042');

  // Corporate email preserved verbatim
  const corp = resolveCompanyIdLogin('Prateek@Company.io');
  assert.ok(!('error' in corp));
  assert.equal(corp.email, 'prateek@company.io');
  assert.equal(corp.isCorporateEmail, true);
  assert.equal(extractCompanyIdFromEmail(corp.email), 'prateek@company.io');

  // Invalid company IDs rejected
  assert.ok('error' in resolveCompanyIdLogin('ab'));
  assert.ok('error' in resolveCompanyIdLogin('bad id with spaces'));
  assert.ok('error' in resolveCompanyIdLogin('bad@email'));

  // Phone E.164 normalization
  const phoneIn = normalizePhoneNumber('+91 98765-43210');
  assert.ok(!('error' in phoneIn));
  assert.equal(phoneIn.e164, '+919876543210');

  const phoneUs = normalizePhoneNumber('+1 (650) 555-0100');
  assert.ok(!('error' in phoneUs));
  assert.equal(phoneUs.e164, '+16505550100');

  assert.ok('error' in normalizePhoneNumber('9876543210'));
  assert.ok('error' in normalizePhoneNumber('+01234567'));
  assert.ok('error' in normalizePhoneNumber('+1234'));

  // Form and OTP validators
  assert.ok(validateCompanyAuthForm({ identifier: 'ARK-1042', password: '123', mode: 'signin' }));
  assert.equal(validateCompanyAuthForm({ identifier: 'ARK-1042', password: 'secret12', mode: 'signin' }), null);
  assert.ok(validateCompanyAuthForm({ identifier: 'ARK-1042', password: 'secret12', displayName: '', mode: 'signup' }));
  assert.equal(
    validateCompanyAuthForm({ identifier: 'ARK-1042', password: 'secret12', displayName: 'Prateek', mode: 'signup' }),
    null,
  );
  assert.ok(validatePhoneOtp('12345'));
  assert.equal(validatePhoneOtp('123456'), null);
});
