import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import multer from 'multer';
import { WebSocket, WebSocketServer } from 'ws';
import {
  createSessionToken,
  DEFAULT_DB_PATH,
  DEFAULT_UPLOADS_DIR,
  generateId,
  hashPassword,
  openDatabase,
  seedTeamDirectory,
  seedWelcomeChatForUser,
  verifyPassword,
} from './server/db.ts';
import {
  computeExpiresAt,
  deleteFileFromServer,
  getUserRetentionStats,
  purgeExpiredData,
  RETENTION_HOURS,
  RETENTION_MS,
  wipeUserMessagesAndFiles,
} from './server/retention.ts';

const PORT = Number(process.env.PORT) || 3000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB
const COMPANY_DOMAIN = 'company.arkdm.app';

const SIMPLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COMPANY_ID_RE = /^[a-zA-Z0-9._-]{3,40}$/;
const E164_PHONE_RE = /^\+[1-9]\d{7,14}$/;
const HANDLE_RE = /^[a-z0-9._-]+$/;

interface UserRow {
  uid: string;
  company_id: string | null;
  email: string | null;
  phone_number: string | null;
  password_hash: string;
  display_name: string;
  handle: string;
  about: string;
  photo_url: string;
  discoverable: number;
  is_online: number;
  last_seen_ms: number;
  theme: 'light' | 'dark';
  wallpaper: 'subtle' | 'solid';
  enter_to_send: number;
  created_at_ms: number;
  updated_at_ms: number;
}

interface AuthedRequest extends Request {
  authUser?: UserRow;
  authToken?: string;
}

function sanitizeHandle(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 40);
  return cleaned.length >= 2 ? cleaned : `user_${cleaned || 'ark'}`;
}

function resolveCompanyIdentifier(
  rawInput: string,
): { email: string; companyId: string } | { error: string } {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) {
    return { error: 'Enter your Company ID or work email.' };
  }
  if (trimmed.includes('@')) {
    const lower = trimmed.toLowerCase();
    if (lower.length > 254 || !SIMPLE_EMAIL_RE.test(lower)) {
      return { error: 'Enter a valid work email address (for example, name@company.com).' };
    }
    return { email: lower, companyId: lower };
  }
  if (!COMPANY_ID_RE.test(trimmed)) {
    return {
      error: 'Company ID must be 3–40 characters using letters, numbers, dots, hyphens, or underscores.',
    };
  }
  return {
    email: `${trimmed.toLowerCase()}@${COMPANY_DOMAIN}`,
    companyId: trimmed.toUpperCase(),
  };
}

function normalizePhone(rawInput: string): { e164: string } | { error: string } {
  const cleaned = String(rawInput || '')
    .trim()
    .replace(/[\s\-().]/g, '');
  if (!cleaned) {
    return { error: 'Enter your phone number with country code.' };
  }
  if (!cleaned.startsWith('+')) {
    return { error: 'Include your country code starting with + (for example, +91 98765 43210).' };
  }
  if (!E164_PHONE_RE.test(cleaned)) {
    return { error: 'Enter a valid international phone number (8–15 digits after +, no leading 0).' };
  }
  return { e164: cleaned };
}

function toProfileDto(row: UserRow) {
  return {
    uid: row.uid,
    displayName: row.display_name,
    handle: row.handle,
    about: row.about,
    photoURL: row.photo_url,
    discoverable: Boolean(row.discoverable),
    isOnline: Boolean(row.is_online),
    lastSeenMs: row.last_seen_ms,
  };
}

function toSettingsDto(row: UserRow) {
  return {
    uid: row.uid,
    email: row.email || '',
    phoneNumber: row.phone_number || '',
    companyId: row.company_id || '',
    theme: row.theme === 'dark' ? 'dark' : 'light',
    wallpaper: row.wallpaper === 'solid' ? 'solid' : 'subtle',
    enterToSend: Boolean(row.enter_to_send),
  };
}

function parseJsonStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function toChatDto(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    type: row.type === 'group' ? 'group' : 'direct',
    name: String(row.name || ''),
    description: String(row.description || ''),
    avatarUrl: String(row.avatar_url || ''),
    createdBy: String(row.created_by),
    participantIds: parseJsonStringArray(String(row.participant_ids_json || '[]')),
    lastMessageText: String(row.last_message_text || ''),
    lastMessageSenderId: String(row.last_message_sender_id || ''),
    lastMessageAtMs: Number(row.last_message_at_ms || 0),
    createdAtMs: Number(row.created_at_ms || 0),
    updatedAtMs: Number(row.updated_at_ms || 0),
    expiresAtMs: Number(row.expires_at || 0),
  };
}

function toMemberDto(row: Record<string, unknown>) {
  return {
    chatId: String(row.chat_id),
    userId: String(row.user_id),
    role: row.role === 'admin' ? 'admin' : 'member',
    pinned: Boolean(row.pinned),
    muted: Boolean(row.muted),
    archived: Boolean(row.archived),
    unreadCount: Number(row.unread_count || 0),
    isTyping: Boolean(row.is_typing),
    lastReadAtMs: Number(row.last_read_at_ms || 0),
  };
}

function toMessageDto(row: Record<string, unknown>, participantIds: string[]) {
  return {
    id: String(row.id),
    chatId: String(row.chat_id),
    senderId: String(row.sender_id),
    senderName: String(row.sender_name),
    participantIds,
    type: row.type as 'text' | 'image' | 'voice' | 'file',
    text: String(row.text || ''),
    mediaUrl: String(row.media_url || ''),
    fileId: String(row.file_id || ''),
    fileName: String(row.file_name || ''),
    fileMime: String(row.file_mime || ''),
    fileSize: Number(row.file_size || 0),
    voiceDurationSec: Number(row.voice_duration_sec || 0),
    replyToId: String(row.reply_to_id || ''),
    replyToSender: String(row.reply_to_sender || ''),
    replyToText: String(row.reply_to_text || ''),
    edited: Boolean(row.edited),
    deleted: Boolean(row.deleted),
    readBy: parseJsonStringArray(String(row.read_by_json || '[]')),
    createdAtMs: Number(row.created_at_ms || 0),
    updatedAtMs: Number(row.updated_at_ms || 0),
    expiresAtMs: Number(row.expires_at || 0),
  };
}

function toReactionDto(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    chatId: String(row.chat_id),
    messageId: String(row.message_id),
    userId: String(row.user_id),
    emoji: String(row.emoji),
    createdAtMs: Number(row.created_at_ms || 0),
  };
}

function toStarredDto(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    chatId: String(row.chat_id),
    messageId: String(row.message_id),
    chatName: String(row.chat_name),
    senderName: String(row.sender_name),
    text: String(row.text),
    createdAtMs: Number(row.created_at_ms || 0),
  };
}

async function startServer() {
  const { db, uploadsDir } = openDatabase(DEFAULT_DB_PATH, DEFAULT_UPLOADS_DIR);
  seedTeamDirectory(db);

  // Run initial 48h auto-delete cleanup on server startup
  const startupPurge = purgeExpiredData(db, uploadsDir);
  if (
    startupPurge.purgedChatIds.length > 0 ||
    startupPurge.purgedMessageIds.length > 0 ||
    startupPurge.purgedFileIds.length > 0
  ) {
    console.log(
      `[ARK DM Retention] Startup 48h cleanup removed ${startupPurge.purgedChatIds.length} chats, ${startupPurge.purgedMessageIds.length} messages, ${startupPurge.purgedFileIds.length} files (${startupPurge.deletedDiskFiles.length} disk files).`,
    );
  }

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const socketsByUser = new Map<string, Set<WebSocket>>();

  function sendWs(ws: WebSocket, payload: unknown) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  function broadcastToUsers(userIds: string[], event: Record<string, unknown>) {
    const unique = new Set(userIds);
    for (const uid of unique) {
      const set = socketsByUser.get(uid);
      if (!set) continue;
      for (const ws of set) {
        sendWs(ws, event);
      }
    }
  }

  function broadcastToAll(event: Record<string, unknown>) {
    for (const set of socketsByUser.values()) {
      for (const ws of set) {
        sendWs(ws, event);
      }
    }
  }

  function extractToken(req: Request): string | null {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7).trim();
    }
    if (typeof req.query.token === 'string' && req.query.token.trim()) {
      return req.query.token.trim();
    }
    return null;
  }

  function lookupSessionUser(token: string | null): UserRow | null {
    if (!token) return null;
    const now = Date.now();
    const row = db
      .prepare(
        `SELECT u.* FROM sessions s
         JOIN users u ON u.uid = s.user_id
         WHERE s.token = ? AND s.expires_at_ms > ?`,
      )
      .get(token, now) as UserRow | undefined;
    return row ?? null;
  }

  function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
    const token = extractToken(req);
    const user = lookupSessionUser(token);
    if (!user || !token) {
      res.status(401).json({ error: 'Session expired or unauthorized. Please sign in again.' });
      return;
    }
    req.authUser = user;
    req.authToken = token;
    next();
  }

  function createSession(userId: string): string {
    const token = createSessionToken();
    const now = Date.now();
    db.prepare(
      'INSERT INTO sessions (token, user_id, created_at_ms, expires_at_ms) VALUES (?, ?, ?, ?)',
    ).run(token, userId, now, now + SESSION_TTL_MS);
    return token;
  }

  function getChatParticipantIds(chatId: string): string[] | null {
    const row = db
      .prepare('SELECT participant_ids_json FROM chats WHERE id = ?')
      .get(chatId) as { participant_ids_json: string } | undefined;
    if (!row) return null;
    return parseJsonStringArray(row.participant_ids_json);
  }

  function ensureChatParticipant(chatId: string, userId: string): string[] | null {
    const participants = getChatParticipantIds(chatId);
    if (!participants || !participants.includes(userId)) {
      return null;
    }
    return participants;
  }

  // Multer disk storage for local server uploads
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(uploadsDir, { recursive: true });
      cb(null, uploadsDir);
    },
    filename: (_req, file, cb) => {
      const rawExt = path.extname(file.originalname || '').toLowerCase();
      const safeExt = /^\.[a-z0-9]{1,10}$/.test(rawExt) ? rawExt : '';
      cb(null, `${crypto.randomUUID()}${safeExt}`);
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: MAX_UPLOAD_BYTES },
  });

  // =========================================================================
  // Health & Auth Routes
  // =========================================================================

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, server: 'local', retentionHours: RETENTION_HOURS });
  });

  app.post('/api/auth/company/signup', (req, res) => {
    const { identifier, password, displayName } = req.body ?? {};
    const resolved = resolveCompanyIdentifier(String(identifier || ''));
    if ('error' in resolved) {
      res.status(400).json({ error: resolved.error });
      return;
    }
    const cleanName = String(displayName || '').trim().slice(0, 80);
    if (!cleanName) {
      res.status(400).json({ error: 'Enter your display name to create an account.' });
      return;
    }
    const pass = String(password || '');
    if (pass.length < 6 || pass.length > 128) {
      res.status(400).json({ error: 'Password must be between 6 and 128 characters.' });
      return;
    }

    const existing = db
      .prepare('SELECT uid FROM users WHERE lower(email) = ? OR lower(company_id) = ?')
      .get(resolved.email.toLowerCase(), resolved.companyId.toLowerCase());
    if (existing) {
      res.status(409).json({
        error: 'An account already exists for this Company ID or work email. Switch to Sign in instead.',
      });
      return;
    }

    const now = Date.now();
    const uid = generateId('u');
    const handle = sanitizeHandle(resolved.companyId.split('@')[0] || cleanName);
    const passHash = hashPassword(pass);

    db.prepare(`
      INSERT INTO users (
        uid, company_id, email, phone_number, password_hash, display_name, handle, about,
        photo_url, discoverable, is_online, last_seen_ms, theme, wallpaper, enter_to_send,
        created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, NULL, ?, ?, ?, 'Available on ARK DM', '', 1, 1, ?, 'light', 'subtle', 1, ?, ?)
    `).run(uid, resolved.companyId, resolved.email, passHash, cleanName, handle, now, now, now);

    seedWelcomeChatForUser(db, uid, now);

    const userRow = db.prepare('SELECT * FROM users WHERE uid = ?').get(uid) as unknown as UserRow;
    const token = createSession(uid);

    broadcastToAll({ type: 'profile:updated', profile: toProfileDto(userRow) });

    res.status(201).json({
      token,
      user: toProfileDto(userRow),
      settings: toSettingsDto(userRow),
    });
  });

  app.post('/api/auth/company/signin', (req, res) => {
    const { identifier, password } = req.body ?? {};
    const resolved = resolveCompanyIdentifier(String(identifier || ''));
    if ('error' in resolved) {
      res.status(400).json({ error: resolved.error });
      return;
    }
    const pass = String(password || '');
    if (pass.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters.' });
      return;
    }

    const userRow = db
      .prepare('SELECT * FROM users WHERE lower(email) = ? OR lower(company_id) = ?')
      .get(resolved.email.toLowerCase(), resolved.companyId.toLowerCase()) as UserRow | undefined;

    if (!userRow || !verifyPassword(pass, userRow.password_hash)) {
      res.status(401).json({
        error: 'Incorrect Company ID/email or password. Double-check your details or switch to Create account.',
      });
      return;
    }

    const now = Date.now();
    db.prepare('UPDATE users SET is_online = 1, last_seen_ms = ?, updated_at_ms = ? WHERE uid = ?').run(
      now,
      now,
      userRow.uid,
    );
    const freshRow = db.prepare('SELECT * FROM users WHERE uid = ?').get(userRow.uid) as unknown as UserRow;
    const token = createSession(userRow.uid);

    broadcastToAll({ type: 'presence:updated', uid: userRow.uid, isOnline: true, lastSeenMs: now });

    res.json({
      token,
      user: toProfileDto(freshRow),
      settings: toSettingsDto(freshRow),
    });
  });

  app.post('/api/auth/phone/request-otp', (req, res) => {
    const normalized = normalizePhone(String(req.body?.phoneNumber || ''));
    if ('error' in normalized) {
      res.status(400).json({ error: normalized.error });
      return;
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const now = Date.now();
    const expiresAt = now + OTP_TTL_MS;

    db.prepare(`
      INSERT INTO phone_otps (phone_number, code, created_at_ms, expires_at_ms)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(phone_number) DO UPDATE SET
        code = excluded.code,
        created_at_ms = excluded.created_at_ms,
        expires_at_ms = excluded.expires_at_ms
    `).run(normalized.e164, code, now, expiresAt);

    console.log(`[ARK DM Local Auth] Verification OTP for ${normalized.e164}: ${code}`);

    res.json({
      phoneNumber: normalized.e164,
      expiresInSec: Math.round(OTP_TTL_MS / 1000),
      localOtpCode: code,
    });
  });

  app.post('/api/auth/phone/verify-otp', (req, res) => {
    const normalized = normalizePhone(String(req.body?.phoneNumber || ''));
    if ('error' in normalized) {
      res.status(400).json({ error: normalized.error });
      return;
    }
    const code = String(req.body?.code || '').trim();
    if (!/^\d{6}$/.test(code)) {
      res.status(400).json({ error: 'Enter the 6-digit verification code.' });
      return;
    }

    const now = Date.now();
    const otpRow = db
      .prepare('SELECT phone_number, code, expires_at_ms FROM phone_otps WHERE phone_number = ?')
      .get(normalized.e164) as
      | { phone_number: string; code: string; expires_at_ms: number }
      | undefined;

    if (!otpRow) {
      res.status(400).json({ error: 'Request a verification code first.' });
      return;
    }
    if (otpRow.expires_at_ms <= now) {
      db.prepare('DELETE FROM phone_otps WHERE phone_number = ?').run(normalized.e164);
      res.status(400).json({ error: 'That verification code expired. Request a new code.' });
      return;
    }
    if (otpRow.code !== code) {
      res.status(401).json({ error: 'Incorrect 6-digit verification code. Please check and try again.' });
      return;
    }

    db.prepare('DELETE FROM phone_otps WHERE phone_number = ?').run(normalized.e164);

    let userRow = db
      .prepare('SELECT * FROM users WHERE phone_number = ?')
      .get(normalized.e164) as UserRow | undefined;

    if (!userRow) {
      const uid = generateId('u');
      const cleanName =
        String(req.body?.displayName || '').trim().slice(0, 80) ||
        `Member ${normalized.e164.slice(-4)}`;
      const handle = sanitizeHandle(`user_${normalized.e164.slice(-6)}`);

      db.prepare(`
        INSERT INTO users (
          uid, company_id, email, phone_number, password_hash, display_name, handle, about,
          photo_url, discoverable, is_online, last_seen_ms, theme, wallpaper, enter_to_send,
          created_at_ms, updated_at_ms
        ) VALUES (?, NULL, NULL, ?, '', ?, ?, 'Available on ARK DM', '', 1, 1, ?, 'light', 'subtle', 1, ?, ?)
      `).run(uid, normalized.e164, cleanName, handle, now, now, now);

      seedWelcomeChatForUser(db, uid, now);
      userRow = db.prepare('SELECT * FROM users WHERE uid = ?').get(uid) as unknown as UserRow;
      broadcastToAll({ type: 'profile:updated', profile: toProfileDto(userRow) });
    } else {
      db.prepare('UPDATE users SET is_online = 1, last_seen_ms = ?, updated_at_ms = ? WHERE uid = ?').run(
        now,
        now,
        userRow.uid,
      );
      userRow = db.prepare('SELECT * FROM users WHERE uid = ?').get(userRow.uid) as unknown as UserRow;
      broadcastToAll({
        type: 'presence:updated',
        uid: userRow.uid,
        isOnline: true,
        lastSeenMs: now,
      });
    }

    const token = createSession(userRow.uid);

    res.json({
      token,
      user: toProfileDto(userRow),
      settings: toSettingsDto(userRow),
    });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    res.json({
      user: toProfileDto(user),
      settings: toSettingsDto(user),
    });
  });

  app.post('/api/auth/logout', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const now = Date.now();
    db.prepare('DELETE FROM sessions WHERE token = ?').run(req.authToken!);
    const sockets = socketsByUser.get(user.uid);
    if (!sockets || sockets.size === 0) {
      db.prepare('UPDATE users SET is_online = 0, last_seen_ms = ?, updated_at_ms = ? WHERE uid = ?').run(
        now,
        now,
        user.uid,
      );
      broadcastToAll({ type: 'presence:updated', uid: user.uid, isOnline: false, lastSeenMs: now });
    }
    res.json({ ok: true });
  });

  // =========================================================================
  // Workspace Bootstrap & Profile/Settings Routes
  // =========================================================================

  app.get('/api/workspace', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    // Ensure expired chats/messages/files are never served even between 60s ticks
    purgeExpiredData(db, uploadsDir);

    const profileRows = db
      .prepare('SELECT * FROM users WHERE discoverable = 1 OR uid = ?')
      .all(user.uid) as unknown as UserRow[];
    const profiles: Record<string, ReturnType<typeof toProfileDto>> = {};
    for (const p of profileRows) {
      profiles[p.uid] = toProfileDto(p);
    }

    const chatRows = db
      .prepare(
        `SELECT c.* FROM chats c
         JOIN chat_members m ON m.chat_id = c.id
         WHERE m.user_id = ?
         ORDER BY c.last_message_at_ms DESC`,
      )
      .all(user.uid) as Record<string, unknown>[];

    const chats = chatRows.map(toChatDto);
    const membersByChat: Record<string, Record<string, ReturnType<typeof toMemberDto>>> = {};
    const messagesByChat: Record<string, ReturnType<typeof toMessageDto>[]> = {};
    const reactionsByChat: Record<string, ReturnType<typeof toReactionDto>[]> = {};

    const selectMembers = db.prepare('SELECT * FROM chat_members WHERE chat_id = ?');
    const selectMessages = db.prepare(
      'SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at_ms ASC',
    );
    const selectReactions = db.prepare(
      'SELECT * FROM reactions WHERE chat_id = ? ORDER BY created_at_ms ASC',
    );

    for (const chat of chats) {
      const mRows = selectMembers.all(chat.id) as Record<string, unknown>[];
      const memberMap: Record<string, ReturnType<typeof toMemberDto>> = {};
      for (const m of mRows) {
        const dto = toMemberDto(m);
        memberMap[dto.userId] = dto;
      }
      membersByChat[chat.id] = memberMap;

      const msgRows = selectMessages.all(chat.id) as Record<string, unknown>[];
      messagesByChat[chat.id] = msgRows.map((row) => toMessageDto(row, chat.participantIds));

      const rxRows = selectReactions.all(chat.id) as Record<string, unknown>[];
      reactionsByChat[chat.id] = rxRows.map(toReactionDto);
    }

    const starredRows = db
      .prepare('SELECT * FROM starred WHERE user_id = ? ORDER BY created_at_ms DESC')
      .all(user.uid) as Record<string, unknown>[];

    res.json({
      currentUser: toProfileDto(user),
      settings: toSettingsDto(user),
      profiles,
      chats,
      membersByChat,
      messagesByChat,
      reactionsByChat,
      starred: starredRows.map(toStarredDto),
      retention: getUserRetentionStats(db, user.uid),
    });
  });

  app.patch('/api/profile', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const displayName = String(req.body?.displayName ?? user.display_name).trim();
    const handle = String(req.body?.handle ?? user.handle).trim().toLowerCase();
    const about = String(req.body?.about ?? user.about).trim();

    if (displayName.length < 1 || displayName.length > 80) {
      res.status(400).json({ error: 'Display name must be 1–80 characters.' });
      return;
    }
    if (handle.length < 2 || handle.length > 40 || !HANDLE_RE.test(handle)) {
      res.status(400).json({ error: 'Handle must be 2–40 lowercase letters, numbers, dots, hyphens, or underscores.' });
      return;
    }
    if (about.length > 160) {
      res.status(400).json({ error: 'About cannot exceed 160 characters.' });
      return;
    }

    const now = Date.now();
    db.prepare(
      'UPDATE users SET display_name = ?, handle = ?, about = ?, updated_at_ms = ? WHERE uid = ?',
    ).run(displayName, handle, about, now, user.uid);

    const updated = db.prepare('SELECT * FROM users WHERE uid = ?').get(user.uid) as unknown as UserRow;
    const dto = toProfileDto(updated);
    broadcastToAll({ type: 'profile:updated', profile: dto });
    res.json({ user: dto });
  });

  app.patch('/api/settings', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const theme = req.body?.theme === 'dark' ? 'dark' : req.body?.theme === 'light' ? 'light' : user.theme;
    const wallpaper =
      req.body?.wallpaper === 'solid'
        ? 'solid'
        : req.body?.wallpaper === 'subtle'
          ? 'subtle'
          : user.wallpaper;
    const enterToSend =
      typeof req.body?.enterToSend === 'boolean'
        ? req.body.enterToSend
          ? 1
          : 0
        : user.enter_to_send;

    const now = Date.now();
    db.prepare(
      'UPDATE users SET theme = ?, wallpaper = ?, enter_to_send = ?, updated_at_ms = ? WHERE uid = ?',
    ).run(theme, wallpaper, enterToSend, now, user.uid);

    const updated = db.prepare('SELECT * FROM users WHERE uid = ?').get(user.uid) as unknown as UserRow;
    res.json({ settings: toSettingsDto(updated) });
  });

  // =========================================================================
  // Chat Creation, Member Flags & Read Receipts
  // =========================================================================

  app.post('/api/chats/direct', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const targetUid = String(req.body?.targetUid || '').trim();
    if (!targetUid) {
      res.status(400).json({ error: 'Target user ID is required.' });
      return;
    }

    const target = db.prepare('SELECT uid FROM users WHERE uid = ?').get(targetUid);
    if (!target) {
      res.status(404).json({ error: 'Contact not found.' });
      return;
    }

    const sorted = [user.uid, targetUid].sort();
    const chatId = `dm_${sorted[0]}_${sorted[1]}`.slice(0, 128);
    const existing = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId) as
      | Record<string, unknown>
      | undefined;

    if (existing) {
      const mRows = db
        .prepare('SELECT * FROM chat_members WHERE chat_id = ?')
        .all(chatId) as Record<string, unknown>[];
      const members: Record<string, ReturnType<typeof toMemberDto>> = {};
      for (const m of mRows) {
        const dto = toMemberDto(m);
        members[dto.userId] = dto;
      }
      res.json({ chat: toChatDto(existing), members });
      return;
    }

    const now = Date.now();
    const expiresAt = computeExpiresAt(now);
    const participants = Array.from(new Set([user.uid, targetUid]));

    db.exec('BEGIN');
    try {
      db.prepare(`
        INSERT INTO chats (
          id, type, name, description, avatar_url, created_by, participant_ids_json,
          last_message_text, last_message_sender_id, last_message_at_ms, created_at_ms,
          updated_at_ms, expires_at
        ) VALUES (?, 'direct', '', '', '', ?, ?, '', '', ?, ?, ?, ?)
      `).run(chatId, user.uid, JSON.stringify(participants), now, now, now, expiresAt);

      const insertMember = db.prepare(`
        INSERT INTO chat_members (
          chat_id, user_id, role, pinned, muted, archived, unread_count, is_typing,
          last_read_at_ms, joined_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, 0, 0, 0, 0, 0, ?, ?, ?)
      `);

      for (const pid of participants) {
        insertMember.run(chatId, pid, pid === user.uid ? 'admin' : 'member', now, now, now);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    const chatRow = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId) as Record<
      string,
      unknown
    >;
    const mRows = db
      .prepare('SELECT * FROM chat_members WHERE chat_id = ?')
      .all(chatId) as Record<string, unknown>[];
    const members: Record<string, ReturnType<typeof toMemberDto>> = {};
    for (const m of mRows) {
      const dto = toMemberDto(m);
      members[dto.userId] = dto;
    }

    const chatDto = toChatDto(chatRow);
    broadcastToUsers(participants, { type: 'chat:created', chat: chatDto, members });

    res.status(201).json({ chat: chatDto, members });
  });

  app.post('/api/chats/group', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const name = String(req.body?.name || '').trim();
    const description = String(req.body?.description || '').trim();
    const rawMembers = Array.isArray(req.body?.memberIds) ? req.body.memberIds : [];

    if (name.length < 1 || name.length > 80) {
      res.status(400).json({ error: 'Group name must be 1–80 characters.' });
      return;
    }
    if (description.length > 240) {
      res.status(400).json({ error: 'Description cannot exceed 240 characters.' });
      return;
    }

    const participants = Array.from(
      new Set([
        user.uid,
        ...rawMembers.filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0),
      ]),
    ).slice(0, 20);

    if (participants.length < 2) {
      res.status(400).json({ error: 'Select at least one participant to create a group.' });
      return;
    }

    const now = Date.now();
    const expiresAt = computeExpiresAt(now);
    const chatId = generateId('grp');

    db.exec('BEGIN');
    try {
      db.prepare(`
        INSERT INTO chats (
          id, type, name, description, avatar_url, created_by, participant_ids_json,
          last_message_text, last_message_sender_id, last_message_at_ms, created_at_ms,
          updated_at_ms, expires_at
        ) VALUES (?, 'group', ?, ?, '', ?, ?, 'Group created', ?, ?, ?, ?, ?)
      `).run(
        chatId,
        name,
        description,
        user.uid,
        JSON.stringify(participants),
        user.uid,
        now,
        now,
        now,
        expiresAt,
      );

      const insertMember = db.prepare(`
        INSERT INTO chat_members (
          chat_id, user_id, role, pinned, muted, archived, unread_count, is_typing,
          last_read_at_ms, joined_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, 0, 0, 0, 0, 0, ?, ?, ?)
      `);

      for (const pid of participants) {
        insertMember.run(chatId, pid, pid === user.uid ? 'admin' : 'member', now, now, now);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    const chatRow = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId) as Record<
      string,
      unknown
    >;
    const mRows = db
      .prepare('SELECT * FROM chat_members WHERE chat_id = ?')
      .all(chatId) as Record<string, unknown>[];
    const members: Record<string, ReturnType<typeof toMemberDto>> = {};
    for (const m of mRows) {
      const dto = toMemberDto(m);
      members[dto.userId] = dto;
    }

    const chatDto = toChatDto(chatRow);
    broadcastToUsers(participants, { type: 'chat:created', chat: chatDto, members });

    res.status(201).json({ chat: chatDto, members });
  });

  app.patch('/api/chats/:chatId/member', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const chatId = req.params.chatId;
    const participants = ensureChatParticipant(chatId, user.uid);
    if (!participants) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }

    const current = db
      .prepare('SELECT * FROM chat_members WHERE chat_id = ? AND user_id = ?')
      .get(chatId, user.uid) as Record<string, unknown> | undefined;
    if (!current) {
      res.status(404).json({ error: 'Membership not found.' });
      return;
    }

    const pinned =
      typeof req.body?.pinned === 'boolean' ? (req.body.pinned ? 1 : 0) : Number(current.pinned);
    const muted =
      typeof req.body?.muted === 'boolean' ? (req.body.muted ? 1 : 0) : Number(current.muted);
    const archived =
      typeof req.body?.archived === 'boolean'
        ? req.body.archived
          ? 1
          : 0
        : Number(current.archived);
    const isTyping =
      typeof req.body?.isTyping === 'boolean'
        ? req.body.isTyping
          ? 1
          : 0
        : Number(current.is_typing);
    const now = Date.now();

    db.prepare(`
      UPDATE chat_members
      SET pinned = ?, muted = ?, archived = ?, is_typing = ?, updated_at_ms = ?
      WHERE chat_id = ? AND user_id = ?
    `).run(pinned, muted, archived, isTyping, now, chatId, user.uid);

    const updated = db
      .prepare('SELECT * FROM chat_members WHERE chat_id = ? AND user_id = ?')
      .get(chatId, user.uid) as Record<string, unknown>;
    const memberDto = toMemberDto(updated);

    if (typeof req.body?.isTyping === 'boolean') {
      broadcastToUsers(participants, {
        type: 'member:typing',
        chatId,
        userId: user.uid,
        isTyping: Boolean(isTyping),
      });
    } else {
      broadcastToUsers([user.uid], { type: 'member:updated', member: memberDto });
    }

    res.json({ member: memberDto });
  });

  app.post('/api/chats/:chatId/read', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const chatId = req.params.chatId;
    const participants = ensureChatParticipant(chatId, user.uid);
    if (!participants) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }

    const now = Date.now();
    const unreadRows = db
      .prepare('SELECT id, sender_id, read_by_json, deleted FROM messages WHERE chat_id = ?')
      .all(chatId) as { id: string; sender_id: string; read_by_json: string; deleted: number }[];

    const updatedMessageIds: string[] = [];

    db.exec('BEGIN');
    try {
      const updateMsg = db.prepare(
        'UPDATE messages SET read_by_json = ?, updated_at_ms = ? WHERE id = ?',
      );
      for (const row of unreadRows) {
        if (row.deleted || row.sender_id === user.uid) continue;
        const readBy = parseJsonStringArray(row.read_by_json);
        if (!readBy.includes(user.uid)) {
          readBy.push(user.uid);
          updateMsg.run(JSON.stringify(readBy.slice(0, 20)), now, row.id);
          updatedMessageIds.push(row.id);
        }
      }

      db.prepare(`
        UPDATE chat_members
        SET unread_count = 0, last_read_at_ms = ?, updated_at_ms = ?
        WHERE chat_id = ? AND user_id = ?
      `).run(now, now, chatId, user.uid);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    if (updatedMessageIds.length > 0) {
      broadcastToUsers(participants, {
        type: 'message:read',
        chatId,
        userId: user.uid,
        messageIds: updatedMessageIds,
        readAtMs: now,
      });
    }

    res.json({ ok: true, updatedMessageIds });
  });

  // =========================================================================
  // Local Server File Upload & Authenticated Serving (with 48h Expiry)
  // =========================================================================

  app.post('/api/uploads', requireAuth, (req: AuthedRequest, res) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({ error: 'File exceeds the 15 MB local upload limit.' });
          return;
        }
        res.status(400).json({ error: err instanceof Error ? err.message : 'Upload failed.' });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'No file provided.' });
        return;
      }

      const user = req.authUser!;
      const chatId = typeof req.body?.chatId === 'string' ? req.body.chatId.trim() : '';
      if (chatId && !ensureChatParticipant(chatId, user.uid)) {
        try {
          fs.unlinkSync(file.path);
        } catch {
          // ignore
        }
        res.status(403).json({ error: 'You are not a participant in this conversation.' });
        return;
      }

      const now = Date.now();
      const expiresAt = computeExpiresAt(now);
      const fileId = generateId('file');
      const originalName = path.basename(file.originalname || 'attachment').slice(0, 180);
      const mimeType = (file.mimetype || 'application/octet-stream').slice(0, 120);

      db.prepare(`
        INSERT INTO files (
          id, storage_name, original_name, mime_type, size_bytes,
          uploaded_by, chat_id, message_id, created_at_ms, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?)
      `).run(
        fileId,
        file.filename,
        originalName,
        mimeType,
        file.size,
        user.uid,
        chatId,
        now,
        expiresAt,
      );

      res.status(201).json({
        fileId,
        url: `/api/files/${fileId}`,
        fileName: originalName,
        fileMime: mimeType,
        fileSize: file.size,
        expiresAtMs: expiresAt,
      });
    });
  });

  app.get('/api/files/:fileId', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const fileId = req.params.fileId;
    const row = db
      .prepare('SELECT * FROM files WHERE id = ?')
      .get(fileId) as
      | {
          id: string;
          storage_name: string;
          original_name: string;
          mime_type: string;
          size_bytes: number;
          uploaded_by: string;
          chat_id: string;
          expires_at: number;
        }
      | undefined;

    if (!row) {
      res.status(404).json({ error: 'File not found or already deleted.' });
      return;
    }

    const canAccess =
      row.uploaded_by === user.uid ||
      (row.chat_id && Boolean(ensureChatParticipant(row.chat_id, user.uid)));

    if (!canAccess) {
      res.status(403).json({ error: 'Not authorized to access this file.' });
      return;
    }

    if (row.expires_at <= Date.now()) {
      deleteFileFromServer(db, uploadsDir, row.id);
      res.status(410).json({
        error: 'This file expired after 48 hours and has been permanently removed from the server.',
      });
      return;
    }

    const resolvedRoot = path.resolve(uploadsDir);
    const fullPath = path.resolve(resolvedRoot, row.storage_name);
    if (!fullPath.startsWith(resolvedRoot + path.sep) || !fs.existsSync(fullPath)) {
      deleteFileFromServer(db, uploadsDir, row.id);
      res.status(404).json({ error: 'File no longer exists on server storage.' });
      return;
    }

    const forceDownload = req.query.download === '1';
    const isSafeInline =
      !forceDownload &&
      (row.mime_type.startsWith('image/') ||
        row.mime_type.startsWith('audio/') ||
        row.mime_type === 'application/pdf');

    const safeFilename = row.original_name.replace(/["\\\r\n]/g, '_');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `${isSafeInline ? 'inline' : 'attachment'}; filename="${safeFilename}"`,
    );
    res.sendFile(fullPath);
  });

  // =========================================================================
  // Messages, Reactions & Starred Routes
  // =========================================================================

  app.post('/api/chats/:chatId/messages', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const chatId = req.params.chatId;
    const participants = ensureChatParticipant(chatId, user.uid);
    if (!participants) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }

    const rawType = req.body?.type;
    const msgType: 'text' | 'image' | 'voice' | 'file' =
      rawType === 'image' || rawType === 'voice' || rawType === 'file' ? rawType : 'text';
    const text = String(req.body?.text || '').trim().slice(0, 2000);
    let mediaUrl = String(req.body?.mediaUrl || '').trim().slice(0, 150000);
    const fileId = String(req.body?.fileId || '').trim().slice(0, 128);
    let fileName = String(req.body?.fileName || '').trim().slice(0, 180);
    let fileMime = String(req.body?.fileMime || '').trim().slice(0, 120);
    let fileSize = Math.max(0, Math.floor(Number(req.body?.fileSize || 0)));
    const voiceDurationSec = Math.max(0, Math.min(600, Math.floor(Number(req.body?.voiceDurationSec || 0))));
    const replyToId = String(req.body?.replyTo?.messageId || '').trim().slice(0, 128);
    const replyToSender = String(req.body?.replyTo?.senderName || '').trim().slice(0, 80);
    const replyToText = String(req.body?.replyTo?.text || '').trim().slice(0, 240);

    if (fileId) {
      const fRow = db
        .prepare('SELECT id, original_name, mime_type, size_bytes, uploaded_by FROM files WHERE id = ?')
        .get(fileId) as
        | {
            id: string;
            original_name: string;
            mime_type: string;
            size_bytes: number;
            uploaded_by: string;
          }
        | undefined;
      if (!fRow || fRow.uploaded_by !== user.uid) {
        res.status(400).json({ error: 'Attached file is invalid or expired.' });
        return;
      }
      mediaUrl = `/api/files/${fRow.id}`;
      fileName = fRow.original_name;
      fileMime = fRow.mime_type;
      fileSize = fRow.size_bytes;
    }

    if (msgType === 'text' && !text) {
      res.status(400).json({ error: 'Enter a message before sending.' });
      return;
    }

    const now = Date.now();
    const expiresAt = computeExpiresAt(now);
    const msgId = generateId('msg');

    const preview =
      msgType === 'image'
        ? text || 'Photo'
        : msgType === 'voice'
          ? `Voice note (${voiceDurationSec}s)`
          : msgType === 'file'
            ? text || `File: ${fileName || 'Attachment'}`
            : text;

    db.exec('BEGIN');
    try {
      db.prepare(`
        INSERT INTO messages (
          id, chat_id, sender_id, sender_name, type, text, media_url, file_id, file_name,
          file_mime, file_size, voice_duration_sec, reply_to_id, reply_to_sender,
          reply_to_text, edited, deleted, read_by_json, created_at_ms, updated_at_ms, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)
      `).run(
        msgId,
        chatId,
        user.uid,
        user.display_name,
        msgType,
        text,
        mediaUrl,
        fileId,
        fileName,
        fileMime,
        fileSize,
        voiceDurationSec,
        replyToId,
        replyToSender,
        replyToText,
        JSON.stringify([user.uid]),
        now,
        now,
        expiresAt,
      );

      if (fileId) {
        db.prepare('UPDATE files SET chat_id = ?, message_id = ?, expires_at = ? WHERE id = ?').run(
          chatId,
          msgId,
          expiresAt,
          fileId,
        );
      }

      db.prepare(`
        UPDATE chats
        SET last_message_text = ?, last_message_sender_id = ?, last_message_at_ms = ?,
            updated_at_ms = ?, expires_at = ?
        WHERE id = ?
      `).run(preview.slice(0, 500), user.uid, now, now, expiresAt, chatId);

      db.prepare(`
        UPDATE chat_members
        SET unread_count = unread_count + 1, updated_at_ms = ?
        WHERE chat_id = ? AND user_id != ?
      `).run(now, chatId, user.uid);

      db.prepare(`
        UPDATE chat_members
        SET is_typing = 0, unread_count = 0, last_read_at_ms = ?, updated_at_ms = ?
        WHERE chat_id = ? AND user_id = ?
      `).run(now, now, chatId, user.uid);

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    const msgRow = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId) as Record<
      string,
      unknown
    >;
    const chatRow = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId) as Record<
      string,
      unknown
    >;
    const memberRows = db
      .prepare('SELECT * FROM chat_members WHERE chat_id = ?')
      .all(chatId) as Record<string, unknown>[];
    const members: Record<string, ReturnType<typeof toMemberDto>> = {};
    for (const m of memberRows) {
      const dto = toMemberDto(m);
      members[dto.userId] = dto;
    }

    const messageDto = toMessageDto(msgRow, participants);
    const chatDto = toChatDto(chatRow);

    broadcastToUsers(participants, {
      type: 'message:created',
      message: messageDto,
      chat: chatDto,
      members,
    });

    res.status(201).json({
      message: messageDto,
      chat: chatDto,
      members,
      retention: getUserRetentionStats(db, user.uid),
    });
  });

  app.patch('/api/chats/:chatId/messages/:messageId', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const { chatId, messageId } = req.params;
    const participants = ensureChatParticipant(chatId, user.uid);
    if (!participants) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }

    const existing = db
      .prepare('SELECT * FROM messages WHERE id = ? AND chat_id = ?')
      .get(messageId, chatId) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Message not found.' });
      return;
    }
    if (existing.sender_id !== user.uid) {
      res.status(403).json({ error: 'You can only edit your own messages.' });
      return;
    }
    if (existing.deleted) {
      res.status(400).json({ error: 'Cannot edit a deleted message.' });
      return;
    }

    const text = String(req.body?.text || '').trim().slice(0, 2000);
    if (!text) {
      res.status(400).json({ error: 'Message cannot be empty.' });
      return;
    }

    const now = Date.now();
    db.prepare('UPDATE messages SET text = ?, edited = 1, updated_at_ms = ? WHERE id = ?').run(
      text,
      now,
      messageId,
    );

    const updated = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId) as Record<
      string,
      unknown
    >;
    const messageDto = toMessageDto(updated, participants);
    broadcastToUsers(participants, { type: 'message:updated', message: messageDto });

    res.json({ message: messageDto });
  });

  app.delete('/api/chats/:chatId/messages/:messageId', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const { chatId, messageId } = req.params;
    const participants = ensureChatParticipant(chatId, user.uid);
    if (!participants) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }

    const existing = db
      .prepare('SELECT * FROM messages WHERE id = ? AND chat_id = ?')
      .get(messageId, chatId) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Message not found.' });
      return;
    }
    if (existing.sender_id !== user.uid) {
      res.status(403).json({ error: 'You can only delete your own messages.' });
      return;
    }

    const fileId = String(existing.file_id || '');
    const now = Date.now();

    db.prepare(`
      UPDATE messages
      SET deleted = 1, text = '', media_url = '', file_id = '', file_name = '', file_mime = '', file_size = 0, updated_at_ms = ?
      WHERE id = ?
    `).run(now, messageId);

    // Immediately erase physical file from local server disk + files table
    if (fileId) {
      deleteFileFromServer(db, uploadsDir, fileId);
    }

    const updated = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId) as Record<
      string,
      unknown
    >;
    const messageDto = toMessageDto(updated, participants);
    broadcastToUsers(participants, { type: 'message:deleted', message: messageDto });

    res.json({
      message: messageDto,
      retention: getUserRetentionStats(db, user.uid),
    });
  });

  app.post(
    '/api/chats/:chatId/messages/:messageId/reactions',
    requireAuth,
    (req: AuthedRequest, res) => {
      const user = req.authUser!;
      const { chatId, messageId } = req.params;
      const participants = ensureChatParticipant(chatId, user.uid);
      if (!participants) {
        res.status(404).json({ error: 'Conversation not found.' });
        return;
      }

      const emoji = String(req.body?.emoji || '').trim().slice(0, 16);
      if (!emoji) {
        res.status(400).json({ error: 'Emoji is required.' });
        return;
      }

      const reactionId = `${messageId}_${user.uid}`;
      const existing = db
        .prepare('SELECT * FROM reactions WHERE id = ?')
        .get(reactionId) as { id: string; emoji: string } | undefined;

      const now = Date.now();
      let reactionDto: ReturnType<typeof toReactionDto> | null = null;
      let removed = false;

      if (existing && existing.emoji === emoji) {
        db.prepare('DELETE FROM reactions WHERE id = ?').run(reactionId);
        removed = true;
      } else if (existing) {
        db.prepare('UPDATE reactions SET emoji = ?, created_at_ms = ? WHERE id = ?').run(
          emoji,
          now,
          reactionId,
        );
        const row = db.prepare('SELECT * FROM reactions WHERE id = ?').get(reactionId) as Record<
          string,
          unknown
        >;
        reactionDto = toReactionDto(row);
      } else {
        db.prepare(
          'INSERT INTO reactions (id, chat_id, message_id, user_id, emoji, created_at_ms) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(reactionId, chatId, messageId, user.uid, emoji, now);
        const row = db.prepare('SELECT * FROM reactions WHERE id = ?').get(reactionId) as Record<
          string,
          unknown
        >;
        reactionDto = toReactionDto(row);
      }

      broadcastToUsers(participants, {
        type: 'reaction:toggled',
        chatId,
        messageId,
        reactionId,
        removed,
        reaction: reactionDto,
      });

      res.json({ reactionId, removed, reaction: reactionDto });
    },
  );

  app.post('/api/starred/toggle', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const chatId = String(req.body?.chatId || '').trim();
    const messageId = String(req.body?.messageId || '').trim();
    const chatName = String(req.body?.chatName || '').trim().slice(0, 80);

    if (!ensureChatParticipant(chatId, user.uid)) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }

    const starId = `${user.uid}_${messageId}`;
    const existing = db.prepare('SELECT id FROM starred WHERE id = ?').get(starId);
    if (existing) {
      db.prepare('DELETE FROM starred WHERE id = ?').run(starId);
      res.json({ starred: false, id: starId });
      return;
    }

    const msg = db
      .prepare('SELECT id, sender_name, text, type, file_name FROM messages WHERE id = ? AND chat_id = ?')
      .get(messageId, chatId) as
      | { id: string; sender_name: string; text: string; type: string; file_name: string }
      | undefined;

    if (!msg) {
      res.status(404).json({ error: 'Message not found.' });
      return;
    }

    const now = Date.now();
    const textPreview = (
      msg.text ||
      (msg.type === 'image' ? 'Photo' : msg.type === 'file' ? `File: ${msg.file_name}` : 'Voice note')
    ).slice(0, 500);

    db.prepare(`
      INSERT INTO starred (id, user_id, chat_id, message_id, chat_name, sender_name, text, created_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(starId, user.uid, chatId, messageId, chatName || 'Chat', msg.sender_name, textPreview, now);

    const row = db.prepare('SELECT * FROM starred WHERE id = ?').get(starId) as Record<
      string,
      unknown
    >;
    res.json({ starred: true, item: toStarredDto(row) });
  });

  // =========================================================================
  // 48-Hour Auto-Delete Retention Management Routes
  // =========================================================================

  app.get('/api/retention/stats', requireAuth, (req: AuthedRequest, res) => {
    res.json({ retention: getUserRetentionStats(db, req.authUser!.uid) });
  });

  app.post('/api/retention/sweep', requireAuth, (req: AuthedRequest, res) => {
    const result = purgeExpiredData(db, uploadsDir);
    if (
      result.purgedChatIds.length > 0 ||
      result.purgedMessageIds.length > 0 ||
      result.purgedFileIds.length > 0
    ) {
      broadcastToAll({ type: 'retention:purged', ...result });
    }
    res.json({
      result,
      retention: getUserRetentionStats(db, req.authUser!.uid),
    });
  });

  app.post('/api/retention/wipe-my-data', requireAuth, (req: AuthedRequest, res) => {
    const result = wipeUserMessagesAndFiles(db, uploadsDir, req.authUser!.uid);
    if (
      result.purgedChatIds.length > 0 ||
      result.purgedMessageIds.length > 0 ||
      result.purgedFileIds.length > 0
    ) {
      broadcastToAll({ type: 'retention:purged', ...result });
    }
    res.json({
      result,
      retention: getUserRetentionStats(db, req.authUser!.uid),
    });
  });

  // Return JSON 404 for unknown /api routes rather than falling through to SPA HTML
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  // =========================================================================
  // Frontend Mounting (Vite Middleware in Dev, Static Dist in Prod)
  // =========================================================================

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  // =========================================================================
  // HTTP + WebSocket Server on Port 3000
  // =========================================================================

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    try {
      const reqUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
      if (reqUrl.pathname !== '/ws') {
        return;
      }
      const token = reqUrl.searchParams.get('token');
      const user = lookupSessionUser(token);
      if (!user) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, user);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on('connection', (ws: WebSocket, user: UserRow) => {
    const uid = user.uid;
    let userSockets = socketsByUser.get(uid);
    const wasOffline = !userSockets || userSockets.size === 0;
    if (!userSockets) {
      userSockets = new Set();
      socketsByUser.set(uid, userSockets);
    }
    userSockets.add(ws);

    const now = Date.now();
    if (wasOffline) {
      db.prepare('UPDATE users SET is_online = 1, last_seen_ms = ?, updated_at_ms = ? WHERE uid = ?').run(
        now,
        now,
        uid,
      );
      broadcastToAll({ type: 'presence:updated', uid, isOnline: true, lastSeenMs: now });
    }

    sendWs(ws, { type: 'connected', uid, retentionHours: RETENTION_HOURS, retentionMs: RETENTION_MS });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg?.type === 'typing' && typeof msg.chatId === 'string') {
          const participants = ensureChatParticipant(msg.chatId, uid);
          if (participants) {
            const isTyping = Boolean(msg.isTyping);
            db.prepare(
              'UPDATE chat_members SET is_typing = ?, updated_at_ms = ? WHERE chat_id = ? AND user_id = ?',
            ).run(isTyping ? 1 : 0, Date.now(), msg.chatId, uid);
            broadcastToUsers(participants, {
              type: 'member:typing',
              chatId: msg.chatId,
              userId: uid,
              isTyping,
            });
          }
        }
      } catch {
        // Ignore malformed socket frames
      }
    });

    ws.on('close', () => {
      const set = socketsByUser.get(uid);
      if (set) {
        set.delete(ws);
        if (set.size === 0) {
          socketsByUser.delete(uid);
          const leftAt = Date.now();
          db.prepare(
            'UPDATE users SET is_online = 0, last_seen_ms = ?, updated_at_ms = ? WHERE uid = ?',
          ).run(leftAt, leftAt, uid);
          broadcastToAll({ type: 'presence:updated', uid, isOnline: false, lastSeenMs: leftAt });
        }
      }
    });
  });

  // Periodic 48-hour auto-delete worker (runs every 60 seconds)
  const retentionInterval = setInterval(() => {
    try {
      const res = purgeExpiredData(db, uploadsDir);
      if (
        res.purgedChatIds.length > 0 ||
        res.purgedMessageIds.length > 0 ||
        res.purgedFileIds.length > 0
      ) {
        console.log(
          `[ARK DM Retention] Purged ${res.purgedChatIds.length} chats, ${res.purgedMessageIds.length} messages, ${res.purgedFileIds.length} files (${res.deletedDiskFiles.length} removed from disk).`,
        );
        broadcastToAll({ type: 'retention:purged', ...res });
      }
    } catch (err) {
      console.error('[ARK DM Retention] Sweep error:', err);
    }
  }, 60_000);

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(
      `[ARK DM] Local server running on http://0.0.0.0:${PORT} (SQLite DB + Disk Uploads + ${RETENTION_HOURS}h Auto-Delete)`,
    );
  });

  const shutdown = () => {
    clearInterval(retentionInterval);
    wss.close();
    httpServer.close(() => {
      try {
        db.close();
      } catch {
        // ignore
      }
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void startServer();
