import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { computeExpiresAt } from './retention.ts';

export const DEFAULT_DATA_DIR = path.resolve(process.cwd(), 'data');
export const DEFAULT_DB_PATH = path.join(DEFAULT_DATA_DIR, 'ark-dm.db');
export const DEFAULT_UPLOADS_DIR = path.join(DEFAULT_DATA_DIR, 'uploads');

export interface DbContext {
  db: DatabaseSync;
  dataDir: string;
  dbPath: string;
  uploadsDir: string;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function createSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function openDatabase(
  dbPath: string = DEFAULT_DB_PATH,
  uploadsDir: string = DEFAULT_UPLOADS_DIR,
): DbContext {
  const dataDir = path.dirname(dbPath);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadsDir, { recursive: true });

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      uid TEXT PRIMARY KEY,
      company_id TEXT UNIQUE,
      email TEXT UNIQUE,
      phone_number TEXT UNIQUE,
      password_hash TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL,
      handle TEXT NOT NULL,
      about TEXT NOT NULL DEFAULT 'Available on ARK DM',
      photo_url TEXT NOT NULL DEFAULT '',
      discoverable INTEGER NOT NULL DEFAULT 1,
      is_online INTEGER NOT NULL DEFAULT 0,
      last_seen_ms INTEGER NOT NULL,
      theme TEXT NOT NULL DEFAULT 'light',
      wallpaper TEXT NOT NULL DEFAULT 'subtle',
      enter_to_send INTEGER NOT NULL DEFAULT 1,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      expires_at_ms INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(uid) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS phone_otps (
      phone_number TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      expires_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('direct', 'group')),
      name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      avatar_url TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      participant_ids_json TEXT NOT NULL,
      last_message_text TEXT NOT NULL DEFAULT '',
      last_message_sender_id TEXT NOT NULL DEFAULT '',
      last_message_at_ms INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_members (
      chat_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      pinned INTEGER NOT NULL DEFAULT 0,
      muted INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      unread_count INTEGER NOT NULL DEFAULT 0,
      is_typing INTEGER NOT NULL DEFAULT 0,
      last_read_at_ms INTEGER NOT NULL,
      joined_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      PRIMARY KEY (chat_id, user_id),
      FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('text', 'image', 'voice', 'file')),
      text TEXT NOT NULL DEFAULT '',
      media_url TEXT NOT NULL DEFAULT '',
      file_id TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL DEFAULT '',
      file_mime TEXT NOT NULL DEFAULT '',
      file_size INTEGER NOT NULL DEFAULT 0,
      voice_duration_sec INTEGER NOT NULL DEFAULT 0,
      reply_to_id TEXT NOT NULL DEFAULT '',
      reply_to_sender TEXT NOT NULL DEFAULT '',
      reply_to_text TEXT NOT NULL DEFAULT '',
      edited INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0,
      read_by_json TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      storage_name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      uploaded_by TEXT NOT NULL,
      chat_id TEXT NOT NULL DEFAULT '',
      message_id TEXT NOT NULL DEFAULT '',
      created_at_ms INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reactions (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE,
      FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS starred (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      chat_name TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(uid) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chats_expires_at ON chats(expires_at);
    CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON messages(chat_id, created_at_ms);
    CREATE INDEX IF NOT EXISTS idx_messages_expires_at ON messages(expires_at);
    CREATE INDEX IF NOT EXISTS idx_files_expires_at ON files(expires_at);
    CREATE INDEX IF NOT EXISTS idx_files_chat_id ON files(chat_id);
    CREATE INDEX IF NOT EXISTS idx_files_message_id ON files(message_id);
    CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id);
  `);

  return { db, dataDir, dbPath, uploadsDir };
}

/**
 * Seeds default company teammates into the local directory if not already present,
 * so any newly registered Company ID or Phone user immediately has discoverable contacts.
 */
export function seedTeamDirectory(db: DatabaseSync, nowMs: number = Date.now()): void {
  const existingCount = (
    db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number }
  ).cnt;
  if (existingCount > 0) return;

  const teamMembers = [
    {
      uid: 'u_maya',
      companyId: 'ARK-1001',
      email: 'ark-1001@company.arkdm.app',
      displayName: 'Maya Lin',
      handle: 'maya.lin',
      about: 'Product design & typography — ARK Studio',
      photoUrl: '/src/assets/images/avatar_maya_1794929138959.jpg',
      isOnline: 1,
      lastSeenMs: nowMs,
    },
    {
      uid: 'u_marcus',
      companyId: 'ARK-1002',
      email: 'ark-1002@company.arkdm.app',
      displayName: 'Marcus Vance',
      handle: 'marcus.v',
      about: 'Local infrastructure & real-time messaging',
      photoUrl: '/src/assets/images/avatar_marcus_1794929140612.jpg',
      isOnline: 1,
      lastSeenMs: nowMs - 120_000,
    },
    {
      uid: 'u_elena',
      companyId: 'ARK-1003',
      email: 'ark-1003@company.arkdm.app',
      displayName: 'Elena Rostova',
      handle: 'elena.rostova',
      about: 'Architecture & spatial operations',
      photoUrl: '/src/assets/images/avatar_elena_1794929140760.jpg',
      isOnline: 0,
      lastSeenMs: nowMs - 22 * 60_000,
    },
    {
      uid: 'u_devon',
      companyId: 'ARK-1004',
      email: 'ark-1004@company.arkdm.app',
      displayName: 'Devon Brooks',
      handle: 'devon.b',
      about: 'Sound design & internal comms',
      photoUrl: '/src/assets/images/avatar_devon_1794929140464.jpg',
      isOnline: 0,
      lastSeenMs: nowMs - 2 * 3_600_000,
    },
  ];

  const defaultPassHash = hashPassword('arkteam123');
  const insert = db.prepare(`
    INSERT OR IGNORE INTO users (
      uid, company_id, email, phone_number, password_hash, display_name, handle, about,
      photo_url, discoverable, is_online, last_seen_ms, theme, wallpaper, enter_to_send,
      created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, 1, ?, ?, 'light', 'subtle', 1, ?, ?)
  `);

  for (const m of teamMembers) {
    insert.run(
      m.uid,
      m.companyId,
      m.email,
      defaultPassHash,
      m.displayName,
      m.handle,
      m.about,
      m.photoUrl,
      m.isOnline,
      m.lastSeenMs,
      nowMs,
      nowMs,
    );
  }
}

/**
 * Seeds a welcome direct conversation with Maya Lin for a newly registered local account,
 * using the real 48-hour auto-delete expiration window.
 */
export function seedWelcomeChatForUser(
  db: DatabaseSync,
  userUid: string,
  nowMs: number = Date.now(),
): void {
  const maya = db.prepare('SELECT uid, display_name FROM users WHERE uid = ?').get('u_maya') as
    | { uid: string; display_name: string }
    | undefined;
  if (!maya || userUid === 'u_maya') return;

  const sorted = [userUid, maya.uid].sort();
  const chatId = `dm_${sorted[0]}_${sorted[1]}`.slice(0, 128);
  const exists = db.prepare('SELECT id FROM chats WHERE id = ?').get(chatId);
  if (exists) return;

  const expiresAt = computeExpiresAt(nowMs);
  const welcomeText =
    'Welcome to ARK DM local server. Messages and uploaded files automatically delete from the database and server after 48 hours.';
  const msgId = generateId('msg');

  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO chats (
        id, type, name, description, avatar_url, created_by, participant_ids_json,
        last_message_text, last_message_sender_id, last_message_at_ms, created_at_ms,
        updated_at_ms, expires_at
      ) VALUES (?, 'direct', '', '', '', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      chatId,
      maya.uid,
      JSON.stringify([userUid, maya.uid]),
      welcomeText,
      maya.uid,
      nowMs,
      nowMs,
      nowMs,
      expiresAt,
    );

    const insertMember = db.prepare(`
      INSERT INTO chat_members (
        chat_id, user_id, role, pinned, muted, archived, unread_count, is_typing,
        last_read_at_ms, joined_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, 0, 0, ?, 0, ?, ?, ?)
    `);

    insertMember.run(chatId, userUid, 'member', 1, 1, nowMs - 1000, nowMs, nowMs);
    insertMember.run(chatId, maya.uid, 'admin', 0, 0, nowMs, nowMs, nowMs);

    db.prepare(`
      INSERT INTO messages (
        id, chat_id, sender_id, sender_name, type, text, media_url, file_id, file_name,
        file_mime, file_size, voice_duration_sec, reply_to_id, reply_to_sender,
        reply_to_text, edited, deleted, read_by_json, created_at_ms, updated_at_ms, expires_at
      ) VALUES (?, ?, ?, ?, 'text', ?, '', '', '', '', 0, 0, '', '', '', 0, 0, ?, ?, ?, ?)
    `).run(
      msgId,
      chatId,
      maya.uid,
      maya.display_name,
      welcomeText,
      JSON.stringify([maya.uid]),
      nowMs,
      nowMs,
      expiresAt,
    );

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
