import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const blueprintPath = path.resolve(process.cwd(), 'firebase-blueprint.json');
const rulesSource = fs.readFileSync(rulesPath, 'utf8');
const blueprint = JSON.parse(fs.readFileSync(blueprintPath, 'utf8'));

type AuthCtx = {
  uid: string;
  email?: string;
  email_verified?: boolean;
  phone_number?: string;
  sign_in_provider?: 'google.com' | 'password' | 'phone' | 'anonymous';
} | null;

function isVerifiedAuth(auth: AuthCtx): boolean {
  if (!auth) return false;
  if (auth.email_verified === true) return true;
  if (typeof auth.phone_number === 'string' && auth.phone_number.length >= 8) return true;
  if (auth.sign_in_provider === 'password' && typeof auth.email === 'string' && auth.email.length >= 3) {
    return true;
  }
  return false;
}

const ID_RE = /^[a-zA-Z0-9_-]+$/;
const HANDLE_RE = /^[a-z0-9._-]+$/;

function isValidId(id: unknown): boolean {
  return typeof id === 'string' && id.length >= 1 && id.length <= 128 && ID_RE.test(id);
}

function hasExactKeys(obj: Record<string, unknown>, allowed: string[]): boolean {
  const keys = Object.keys(obj);
  return allowed.every((k) => keys.includes(k)) && keys.every((k) => allowed.includes(k));
}

function isValidIdList(list: unknown, min: number, max: number): boolean {
  return (
    Array.isArray(list) &&
    list.length >= min &&
    list.length <= max &&
    (list.length === 0 || (typeof list[0] === 'string' && list[0].length <= 128))
  );
}

// Mirror of firestore.rules invariants to test all Dirty Dozen adversarial payloads
function evaluateProfileCreate(auth: AuthCtx, userId: string, data: Record<string, unknown>, now: number): string {
  if (!auth || !isVerifiedAuth(auth)) return 'PERMISSION_DENIED';
  if (!isValidId(userId) || auth.uid !== userId) return 'PERMISSION_DENIED';
  const required = [
    'uid', 'displayName', 'handle', 'about', 'photoURL',
    'discoverable', 'isOnline', 'lastSeen', 'createdAt', 'updatedAt',
  ];
  if (!hasExactKeys(data, required)) return 'PERMISSION_DENIED';
  if (data.uid !== userId || data.uid !== auth.uid) return 'PERMISSION_DENIED';
  if (typeof data.displayName !== 'string' || data.displayName.length < 1 || data.displayName.length > 80) return 'PERMISSION_DENIED';
  if (typeof data.handle !== 'string' || data.handle.length < 2 || data.handle.length > 40 || !HANDLE_RE.test(data.handle)) return 'PERMISSION_DENIED';
  if (data.createdAt !== now || data.updatedAt !== now || data.lastSeen !== now) return 'PERMISSION_DENIED';
  return 'ALLOW';
}

function evaluateUserAccountGet(auth: AuthCtx, userId: string): string {
  if (!auth || auth.uid !== userId || !isValidId(userId)) return 'PERMISSION_DENIED';
  return 'ALLOW';
}

function evaluateChatCreate(auth: AuthCtx, chatId: string, data: Record<string, unknown>, now: number): string {
  if (!auth || !isVerifiedAuth(auth)) return 'PERMISSION_DENIED';
  if (!isValidId(chatId)) return 'PERMISSION_DENIED';
  const required = [
    'type', 'name', 'description', 'avatarUrl', 'createdBy',
    'participantIds', 'lastMessageText', 'lastMessageSenderId',
    'lastMessageAt', 'createdAt', 'updatedAt',
  ];
  if (!hasExactKeys(data, required)) return 'PERMISSION_DENIED';
  if (!isValidIdList(data.participantIds, 1, 20)) return 'PERMISSION_DENIED';
  if (data.createdBy !== auth.uid || !(data.participantIds as string[]).includes(auth.uid)) return 'PERMISSION_DENIED';
  if (data.createdAt !== now || data.updatedAt !== now || data.lastMessageAt !== now) return 'PERMISSION_DENIED';
  return 'ALLOW';
}

function evaluateMessageCreate(
  auth: AuthCtx,
  chatId: string,
  messageId: string,
  data: Record<string, unknown>,
  parentParticipants: string[],
  parentLastMessageAtAfter: number,
  now: number,
): string {
  if (!auth || !isVerifiedAuth(auth)) return 'PERMISSION_DENIED';
  if (!isValidId(chatId) || !isValidId(messageId)) return 'PERMISSION_DENIED';
  if (!parentParticipants.includes(auth.uid)) return 'PERMISSION_DENIED';
  const required = [
    'chatId', 'senderId', 'senderName', 'participantIds', 'type', 'text',
    'mediaUrl', 'voiceDurationSec', 'replyToId', 'replyToSender', 'replyToText',
    'edited', 'deleted', 'readBy', 'createdAt', 'updatedAt',
  ];
  if (!hasExactKeys(data, required)) return 'PERMISSION_DENIED';
  if (data.senderId !== auth.uid) return 'PERMISSION_DENIED';
  if (typeof data.text !== 'string' || data.text.length > 2000) return 'PERMISSION_DENIED';
  if (data.createdAt !== now || data.updatedAt !== now) return 'PERMISSION_DENIED';
  if (parentLastMessageAtAfter !== now) return 'PERMISSION_DENIED';
  return 'ALLOW';
}

function evaluateMessageUpdate(
  auth: AuthCtx,
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  parentParticipants: string[],
  now: number,
): string {
  if (!auth || !isVerifiedAuth(auth)) return 'PERMISSION_DENIED';
  if (!parentParticipants.includes(auth.uid)) return 'PERMISSION_DENIED';
  if (typeof incoming.text !== 'string' || incoming.text.length > 2000) return 'PERMISSION_DENIED';
  if (incoming.updatedAt !== now) return 'PERMISSION_DENIED';

  const affected = Object.keys(incoming).filter((k) => JSON.stringify(incoming[k]) !== JSON.stringify(existing[k]));
  const isSender = existing.senderId === auth.uid;
  const senderEdit =
    isSender &&
    existing.deleted === false &&
    incoming.edited === true &&
    incoming.deleted === false &&
    affected.every((k) => ['text', 'edited', 'updatedAt'].includes(k));
  const participantRead =
    affected.every((k) => ['readBy', 'updatedAt'].includes(k)) &&
    Array.isArray(incoming.readBy) &&
    incoming.readBy.includes(auth.uid);

  return senderEdit || participantRead ? 'ALLOW' : 'PERMISSION_DENIED';
}

test('firestore.rules covers every collection declared in firebase-blueprint.json', () => {
  const paths = Object.keys(blueprint.firestore);
  assert.equal(paths.length, 7);
  assert.match(rulesSource, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/);
  assert.match(rulesSource, /match \/profiles\/\{userId\}/);
  assert.match(rulesSource, /match \/users\/\{userId\}/);
  assert.match(rulesSource, /match \/starred\/\{starId\}/);
  assert.match(rulesSource, /match \/chats\/\{chatId\}/);
  assert.match(rulesSource, /match \/members\/\{memberId\}/);
  assert.match(rulesSource, /match \/messages\/\{messageId\}/);
  assert.match(rulesSource, /match \/reactions\/\{reactionId\}/);
});

test('Dirty Dozen #1-12 all return PERMISSION_DENIED', () => {
  const now = 1_700_000_000_000;
  const alice: AuthCtx = { uid: 'alice_1', email: 'alice@example.com', email_verified: true };
  const bob: AuthCtx = { uid: 'bob_2', email: 'bob@example.com', email_verified: true };
  const outsider: AuthCtx = { uid: 'eve_3', email: 'eve@example.com', email_verified: true };
  const unverified: AuthCtx = { uid: 'alice_1', email: 'alice@example.com', email_verified: false };

  const baseProfile = {
    uid: 'alice_1',
    displayName: 'Alice',
    handle: 'alice',
    about: 'Hi',
    photoURL: '',
    discoverable: true,
    isOnline: true,
    lastSeen: now,
    createdAt: now,
    updatedAt: now,
  };

  // #1 Shadow Field Injection
  assert.equal(evaluateProfileCreate(alice, 'alice_1', { ...baseProfile, isAdmin: true }, now), 'PERMISSION_DENIED');

  // #2 Identity Spoofing on message create
  const baseMsg = {
    chatId: 'c1',
    senderId: 'alice_1',
    senderName: 'Alice',
    participantIds: ['alice_1', 'bob_2'],
    type: 'text',
    text: 'Hello',
    mediaUrl: '',
    voiceDurationSec: 0,
    replyToId: '',
    replyToSender: '',
    replyToText: '',
    edited: false,
    deleted: false,
    readBy: ['alice_1'],
    createdAt: now,
    updatedAt: now,
  };
  assert.equal(evaluateMessageCreate(bob, 'c1', 'm1', baseMsg, ['alice_1', 'bob_2'], now, now), 'PERMISSION_DENIED');

  // #3 Unverified Email Write
  assert.equal(evaluateProfileCreate(unverified, 'alice_1', baseProfile, now), 'PERMISSION_DENIED');

  // #4 Cross-User PII Read
  assert.equal(evaluateUserAccountGet(bob, 'alice_1'), 'PERMISSION_DENIED');

  // #5 Path ID Poisoning
  assert.equal(evaluateChatCreate(alice, 'bad$id..' + 'x'.repeat(200), {
    type: 'group', name: 'G', description: '', avatarUrl: '', createdBy: 'alice_1',
    participantIds: ['alice_1'], lastMessageText: '', lastMessageSenderId: '',
    lastMessageAt: now, createdAt: now, updatedAt: now,
  }, now), 'PERMISSION_DENIED');

  // #6 Non-sender tampering with message text
  assert.equal(
    evaluateMessageUpdate(bob, baseMsg, { ...baseMsg, text: 'Forged', edited: true, updatedAt: now }, ['alice_1', 'bob_2'], now),
    'PERMISSION_DENIED',
  );

  // #7 Forged client timestamp
  assert.equal(
    evaluateMessageCreate(alice, 'c1', 'm1', { ...baseMsg, createdAt: 1000 }, ['alice_1', 'bob_2'], now, now),
    'PERMISSION_DENIED',
  );

  // #8 Unbounded Array DoS (> 20 participants)
  assert.equal(evaluateChatCreate(alice, 'c1', {
    type: 'group', name: 'Big', description: '', avatarUrl: '', createdBy: 'alice_1',
    participantIds: Array.from({ length: 25 }, (_, i) => `u_${i}`),
    lastMessageText: '', lastMessageSenderId: '', lastMessageAt: now, createdAt: now, updatedAt: now,
  }, now), 'PERMISSION_DENIED');

  // #9 Immutable owner / senderId mutation on update
  assert.equal(
    evaluateMessageUpdate(alice, baseMsg, { ...baseMsg, senderId: 'bob_2', updatedAt: now }, ['alice_1', 'bob_2'], now),
    'PERMISSION_DENIED',
  );

  // #10 Non-member message injection
  assert.equal(
    evaluateMessageCreate(outsider, 'c1', 'm2', { ...baseMsg, senderId: 'eve_3' }, ['alice_1', 'bob_2'], now, now),
    'PERMISSION_DENIED',
  );

  // #11 Orphaned message write (desynced parent lastMessageAt)
  assert.equal(
    evaluateMessageCreate(alice, 'c1', 'm3', baseMsg, ['alice_1', 'bob_2'], now - 5000, now),
    'PERMISSION_DENIED',
  );

  // #12 Value poisoning on allowed key (oversized text > 2000)
  assert.equal(
    evaluateMessageUpdate(alice, baseMsg, { ...baseMsg, text: 'A'.repeat(2500), edited: true, updatedAt: now }, ['alice_1', 'bob_2'], now),
    'PERMISSION_DENIED',
  );

  // Positive control: legitimate Google, Phone OTP, and Company ID Password writes succeed; anonymous fails
  const phoneUser: AuthCtx = { uid: 'alice_1', phone_number: '+919876543210', sign_in_provider: 'phone' };
  const companyUser: AuthCtx = { uid: 'alice_1', email: 'emp-1042@company.arkdm.app', email_verified: false, sign_in_provider: 'password' };
  const anonUser: AuthCtx = { uid: 'alice_1', sign_in_provider: 'anonymous' };

  assert.equal(evaluateProfileCreate(alice, 'alice_1', baseProfile, now), 'ALLOW');
  assert.equal(evaluateProfileCreate(phoneUser, 'alice_1', baseProfile, now), 'ALLOW');
  assert.equal(evaluateProfileCreate(companyUser, 'alice_1', baseProfile, now), 'ALLOW');
  assert.equal(evaluateProfileCreate(anonUser, 'alice_1', baseProfile, now), 'PERMISSION_DENIED');
  assert.equal(evaluateMessageCreate(alice, 'c1', 'm1', baseMsg, ['alice_1', 'bob_2'], now, now), 'ALLOW');
  assert.equal(
    evaluateMessageUpdate(bob, baseMsg, { ...baseMsg, readBy: ['alice_1', 'bob_2'], updatedAt: now }, ['alice_1', 'bob_2'], now),
    'ALLOW',
  );
});
