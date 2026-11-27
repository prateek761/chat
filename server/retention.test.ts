import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDatabase, hashPassword, verifyPassword } from './db.ts';
import {
  computeExpiresAt,
  deleteFileFromServer,
  getUserRetentionStats,
  isExpiredAt,
  purgeExpiredData,
  RETENTION_MS,
  wipeUserMessagesAndFiles,
} from './retention.ts';

function makeTempDbEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ark-dm-retention-'));
  const dbPath = path.join(root, 'ark-dm.db');
  const uploadsDir = path.join(root, 'uploads');
  const ctx = openDatabase(dbPath, uploadsDir);
  return {
    ...ctx,
    cleanup: () => {
      try {
        ctx.db.close();
      } catch {
        // ignore
      }
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test('computeExpiresAt and isExpiredAt enforce exact 48-hour retention boundary', () => {
  const created = 1_700_000_000_000;
  const expires = computeExpiresAt(created);
  assert.equal(expires - created, 48 * 60 * 60 * 1000);
  assert.equal(isExpiredAt(expires, expires - 1), false);
  assert.equal(isExpiredAt(expires, expires), true);
  assert.equal(isExpiredAt(expires, expires + 1000), true);
});

test('password hashing verifies matching credentials and rejects wrong passwords', () => {
  const hashed = hashPassword('super-secret-2026');
  assert.equal(verifyPassword('super-secret-2026', hashed), true);
  assert.equal(verifyPassword('wrong-password', hashed), false);
});

test('purgeExpiredData deletes >48h chats, messages, reactions, starred, and disk files while preserving fresh data', () => {
  const env = makeTempDbEnv();
  try {
    const { db, uploadsDir } = env;
    const now = 1_800_000_000_000;
    const expiredAt = now - 60_000; // 1 minute past 48h expiry
    const freshAt = now + 24 * 60 * 60 * 1000; // 24h remaining

    // Seed two users
    db.prepare(`
      INSERT INTO users (uid, company_id, email, password_hash, display_name, handle, about, photo_url, discoverable, is_online, last_seen_ms, theme, wallpaper, enter_to_send, created_at_ms, updated_at_ms)
      VALUES ('u1', 'ARK-1', 'ark-1@company.arkdm.app', 'h', 'User One', 'user1', '', '', 1, 1, ?, 'light', 'subtle', 1, ?, ?),
             ('u2', 'ARK-2', 'ark-2@company.arkdm.app', 'h', 'User Two', 'user2', '', '', 1, 1, ?, 'light', 'subtle', 1, ?, ?)
    `).run(now, now, now, now, now, now);

    // 1. Expired chat with an expired message and physical file on disk
    db.prepare(`
      INSERT INTO chats (id, type, name, description, avatar_url, created_by, participant_ids_json, last_message_text, last_message_sender_id, last_message_at_ms, created_at_ms, updated_at_ms, expires_at)
      VALUES ('chat_old', 'direct', '', '', '', 'u1', '["u1","u2"]', 'Old file', 'u1', ?, ?, ?, ?)
    `).run(expiredAt - RETENTION_MS, expiredAt - RETENTION_MS, expiredAt - RETENTION_MS, expiredAt);

    db.prepare(`
      INSERT INTO chat_members (chat_id, user_id, role, pinned, muted, archived, unread_count, is_typing, last_read_at_ms, joined_at_ms, updated_at_ms)
      VALUES ('chat_old', 'u1', 'admin', 0, 0, 0, 0, 0, ?, ?, ?)
    `).run(now, now, now);

    const oldFileName = 'expired-report.pdf';
    const oldDiskPath = path.join(uploadsDir, oldFileName);
    fs.writeFileSync(oldDiskPath, 'expired-pdf-bytes');

    db.prepare(`
      INSERT INTO files (id, storage_name, original_name, mime_type, size_bytes, uploaded_by, chat_id, message_id, created_at_ms, expires_at)
      VALUES ('file_old', ?, 'Q1.pdf', 'application/pdf', 17, 'u1', 'chat_old', 'msg_old', ?, ?)
    `).run(oldFileName, expiredAt - RETENTION_MS, expiredAt);

    db.prepare(`
      INSERT INTO messages (id, chat_id, sender_id, sender_name, type, text, media_url, file_id, file_name, file_mime, file_size, voice_duration_sec, reply_to_id, reply_to_sender, reply_to_text, edited, deleted, read_by_json, created_at_ms, updated_at_ms, expires_at)
      VALUES ('msg_old', 'chat_old', 'u1', 'User One', 'file', 'Old file', '/api/files/file_old', 'file_old', 'Q1.pdf', 'application/pdf', 17, 0, '', '', '', 0, 0, '["u1"]', ?, ?, ?)
    `).run(expiredAt - RETENTION_MS, expiredAt - RETENTION_MS, expiredAt);

    db.prepare(`
      INSERT INTO reactions (id, chat_id, message_id, user_id, emoji, created_at_ms)
      VALUES ('msg_old_u2', 'chat_old', 'msg_old', 'u2', '👍', ?)
    `).run(expiredAt - RETENTION_MS);

    db.prepare(`
      INSERT INTO starred (id, user_id, chat_id, message_id, chat_name, sender_name, text, created_at_ms)
      VALUES ('u1_msg_old', 'u1', 'chat_old', 'msg_old', 'User Two', 'User One', 'Old file', ?)
    `).run(expiredAt - RETENTION_MS);

    // 2. Active chat with BOTH an expired older message (+ file) AND a fresh message (+ file)
    db.prepare(`
      INSERT INTO chats (id, type, name, description, avatar_url, created_by, participant_ids_json, last_message_text, last_message_sender_id, last_message_at_ms, created_at_ms, updated_at_ms, expires_at)
      VALUES ('chat_active', 'direct', '', '', '', 'u1', '["u1","u2"]', 'Fresh msg', 'u1', ?, ?, ?, ?)
    `).run(now - 1000, now - RETENTION_MS - 5000, now - 1000, freshAt);

    db.prepare(`
      INSERT INTO chat_members (chat_id, user_id, role, pinned, muted, archived, unread_count, is_typing, last_read_at_ms, joined_at_ms, updated_at_ms)
      VALUES ('chat_active', 'u1', 'admin', 0, 0, 0, 0, 0, ?, ?, ?)
    `).run(now, now, now);

    const agedFileName = 'aged-photo.jpg';
    const agedDiskPath = path.join(uploadsDir, agedFileName);
    fs.writeFileSync(agedDiskPath, 'aged-jpg');

    const freshFileName = 'fresh-spec.txt';
    const freshDiskPath = path.join(uploadsDir, freshFileName);
    fs.writeFileSync(freshDiskPath, 'fresh-spec-content');

    const orphanFileName = 'orphan-stray.bin';
    const orphanDiskPath = path.join(uploadsDir, orphanFileName);
    fs.writeFileSync(orphanDiskPath, 'stray');

    db.prepare(`
      INSERT INTO files (id, storage_name, original_name, mime_type, size_bytes, uploaded_by, chat_id, message_id, created_at_ms, expires_at)
      VALUES ('file_aged', ?, 'aged.jpg', 'image/jpeg', 8, 'u1', 'chat_active', 'msg_aged', ?, ?),
             ('file_fresh', ?, 'spec.txt', 'text/plain', 18, 'u1', 'chat_active', 'msg_fresh', ?, ?)
    `).run(agedFileName, expiredAt - RETENTION_MS, expiredAt, freshFileName, now - 1000, freshAt);

    db.prepare(`
      INSERT INTO messages (id, chat_id, sender_id, sender_name, type, text, media_url, file_id, file_name, file_mime, file_size, voice_duration_sec, reply_to_id, reply_to_sender, reply_to_text, edited, deleted, read_by_json, created_at_ms, updated_at_ms, expires_at)
      VALUES ('msg_aged', 'chat_active', 'u1', 'User One', 'image', 'Aged pic', '/api/files/file_aged', 'file_aged', 'aged.jpg', 'image/jpeg', 8, 0, '', '', '', 0, 0, '["u1"]', ?, ?, ?),
             ('msg_fresh', 'chat_active', 'u1', 'User One', 'file', 'Fresh msg', '/api/files/file_fresh', 'file_fresh', 'spec.txt', 'text/plain', 18, 0, '', '', '', 0, 0, '["u1"]', ?, ?, ?)
    `).run(expiredAt - RETENTION_MS, expiredAt - RETENTION_MS, expiredAt, now - 1000, now - 1000, freshAt);

    // Run 48h auto-delete purge
    const result = purgeExpiredData(db, uploadsDir, now, { sweepOrphansOlderThanMs: 0 });

    const countOf = (sql: string, ...params: (string | number)[]) =>
      (db.prepare(sql).get(...params) as { c: number }).c;

    // Assert expired chat, messages, files, reactions, starred deleted from SQLite
    assert.deepEqual(result.purgedChatIds, ['chat_old']);
    assert.deepEqual(new Set(result.purgedMessageIds), new Set(['msg_old', 'msg_aged']));
    assert.deepEqual(new Set(result.purgedFileIds), new Set(['file_old', 'file_aged']));
    assert.equal(countOf('SELECT COUNT(*) as c FROM chats WHERE id = ?', 'chat_old'), 0);
    assert.equal(countOf('SELECT COUNT(*) as c FROM messages WHERE id = ?', 'msg_old'), 0);
    assert.equal(countOf('SELECT COUNT(*) as c FROM messages WHERE id = ?', 'msg_aged'), 0);
    assert.equal(countOf('SELECT COUNT(*) as c FROM reactions WHERE message_id = ?', 'msg_old'), 0);
    assert.equal(countOf('SELECT COUNT(*) as c FROM starred WHERE message_id = ?', 'msg_old'), 0);

    // Assert physical files unlinked from server disk (expired + orphan)
    assert.equal(fs.existsSync(oldDiskPath), false);
    assert.equal(fs.existsSync(agedDiskPath), false);
    assert.equal(fs.existsSync(orphanDiskPath), false);

    // Assert fresh (<48h) chat, message, and disk file remain intact
    assert.equal(countOf('SELECT COUNT(*) as c FROM chats WHERE id = ?', 'chat_active'), 1);
    assert.equal(countOf('SELECT COUNT(*) as c FROM messages WHERE id = ?', 'msg_fresh'), 1);
    assert.equal(fs.existsSync(freshDiskPath), true);

    // Verify retention stats reflect only surviving data
    const stats = getUserRetentionStats(db, 'u1');
    assert.equal(stats.activeChats, 1);
    assert.equal(stats.activeMessages, 1);
    assert.equal(stats.activeFiles, 1);
    assert.equal(stats.totalFileBytes, 18);

    // Verify deleteFileFromServer immediately deletes both DB record and disk file
    assert.equal(deleteFileFromServer(db, uploadsDir, 'file_fresh'), true);
    assert.equal(fs.existsSync(freshDiskPath), false);
    assert.equal(countOf('SELECT COUNT(*) as c FROM files WHERE id = ?', 'file_fresh'), 0);

    // Verify wipeUserMessagesAndFiles erases remaining user chats
    const wipe = wipeUserMessagesAndFiles(db, uploadsDir, 'u1', now);
    assert.deepEqual(wipe.purgedChatIds, ['chat_active']);
    assert.equal(countOf('SELECT COUNT(*) as c FROM chats'), 0);
  } finally {
    env.cleanup();
  }
});
