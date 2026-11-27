import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

export const RETENTION_HOURS = 48;
export const RETENTION_MS = RETENTION_HOURS * 60 * 60 * 1000;

export interface PurgeResult {
  purgedChatIds: string[];
  purgedMessageIds: string[];
  purgedFileIds: string[];
  deletedDiskFiles: string[];
  updatedChatIds: string[];
  purgedAtMs: number;
}

export interface RetentionStats {
  retentionHours: number;
  activeChats: number;
  activeMessages: number;
  activeFiles: number;
  totalFileBytes: number;
  nextExpiryMs: number | null;
}

export function computeExpiresAt(createdAtMs: number, retentionMs: number = RETENTION_MS): number {
  return createdAtMs + retentionMs;
}

export function isExpiredAt(expiresAtMs: number, nowMs: number = Date.now()): boolean {
  return expiresAtMs <= nowMs;
}

function safeUnlinkInDir(uploadsDir: string, storageName: string): boolean {
  if (!storageName || storageName.includes('/') || storageName.includes('\\') || storageName.includes('..')) {
    return false;
  }
  const resolvedRoot = path.resolve(uploadsDir);
  const targetPath = path.resolve(resolvedRoot, storageName);
  if (!targetPath.startsWith(resolvedRoot + path.sep)) {
    return false;
  }
  try {
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
      return true;
    }
  } catch {
    // Ignore file-system race if already unlinked
  }
  return false;
}

export function deleteFileFromServer(
  db: DatabaseSync,
  uploadsDir: string,
  fileId: string,
): boolean {
  if (!fileId) return false;
  const row = db
    .prepare('SELECT id, storage_name FROM files WHERE id = ?')
    .get(fileId) as { id: string; storage_name: string } | undefined;

  if (!row) return false;

  db.prepare('DELETE FROM files WHERE id = ?').run(fileId);
  safeUnlinkInDir(uploadsDir, row.storage_name);
  return true;
}

/**
 * Permanently purges all chats, messages, reactions, starred pointers, sessions,
 * OTP codes, and uploaded server files that have exceeded the 48-hour retention window.
 * Deletes both SQLite database records and physical files in `uploadsDir`.
 */
export function purgeExpiredData(
  db: DatabaseSync,
  uploadsDir: string,
  nowMs: number = Date.now(),
  options: { sweepOrphansOlderThanMs?: number } = {},
): PurgeResult {
  const orphanGraceMs = options.sweepOrphansOlderThanMs ?? 5 * 60 * 1000;

  const expiredChatRows = db
    .prepare('SELECT id FROM chats WHERE expires_at <= ?')
    .all(nowMs) as { id: string }[];
  const expiredChatIds = expiredChatRows.map((r) => r.id);
  const expiredChatSet = new Set(expiredChatIds);

  const expiredMsgRows = db
    .prepare('SELECT id, chat_id, file_id FROM messages WHERE expires_at <= ?')
    .all(nowMs) as { id: string; chat_id: string; file_id: string }[];

  const msgsInExpiredChats: { id: string; chat_id: string; file_id: string }[] = [];
  if (expiredChatIds.length > 0) {
    const stmt = db.prepare('SELECT id, chat_id, file_id FROM messages WHERE chat_id = ?');
    for (const chatId of expiredChatIds) {
      const rows = stmt.all(chatId) as { id: string; chat_id: string; file_id: string }[];
      msgsInExpiredChats.push(...rows);
    }
  }

  const expiredMessageMap = new Map<string, { id: string; chat_id: string; file_id: string }>();
  for (const row of [...expiredMsgRows, ...msgsInExpiredChats]) {
    expiredMessageMap.set(row.id, row);
  }
  const expiredMessageIds = Array.from(expiredMessageMap.keys());
  const affectedSurvivingChatIds = new Set<string>();
  for (const row of expiredMessageMap.values()) {
    if (!expiredChatSet.has(row.chat_id)) {
      affectedSurvivingChatIds.add(row.chat_id);
    }
  }

  // Collect every file to delete: expired directly, linked to an expired chat, or linked to an expired message
  const fileMap = new Map<string, { id: string; storage_name: string }>();

  const directlyExpiredFiles = db
    .prepare('SELECT id, storage_name FROM files WHERE expires_at <= ?')
    .all(nowMs) as { id: string; storage_name: string }[];
  for (const f of directlyExpiredFiles) {
    fileMap.set(f.id, f);
  }

  if (expiredChatIds.length > 0) {
    const stmt = db.prepare('SELECT id, storage_name FROM files WHERE chat_id = ?');
    for (const chatId of expiredChatIds) {
      const rows = stmt.all(chatId) as { id: string; storage_name: string }[];
      for (const f of rows) fileMap.set(f.id, f);
    }
  }

  if (expiredMessageIds.length > 0) {
    const stmtByMsg = db.prepare('SELECT id, storage_name FROM files WHERE message_id = ?');
    const stmtById = db.prepare('SELECT id, storage_name FROM files WHERE id = ?');
    for (const msg of expiredMessageMap.values()) {
      const rows = stmtByMsg.all(msg.id) as { id: string; storage_name: string }[];
      for (const f of rows) fileMap.set(f.id, f);
      if (msg.file_id) {
        const byId = stmtById.get(msg.file_id) as { id: string; storage_name: string } | undefined;
        if (byId) fileMap.set(byId.id, byId);
      }
    }
  }

  const expiredFiles = Array.from(fileMap.values());
  const updatedChatIds: string[] = [];

  db.exec('BEGIN');
  try {
    const delReactionsByMsg = db.prepare('DELETE FROM reactions WHERE message_id = ?');
    const delStarredByMsg = db.prepare('DELETE FROM starred WHERE message_id = ?');
    const delMsg = db.prepare('DELETE FROM messages WHERE id = ?');
    for (const msgId of expiredMessageIds) {
      delReactionsByMsg.run(msgId);
      delStarredByMsg.run(msgId);
      delMsg.run(msgId);
    }

    const delFile = db.prepare('DELETE FROM files WHERE id = ?');
    for (const f of expiredFiles) {
      delFile.run(f.id);
    }

    const delReactionsByChat = db.prepare('DELETE FROM reactions WHERE chat_id = ?');
    const delStarredByChat = db.prepare('DELETE FROM starred WHERE chat_id = ?');
    const delMembersByChat = db.prepare('DELETE FROM chat_members WHERE chat_id = ?');
    const delChat = db.prepare('DELETE FROM chats WHERE id = ?');
    for (const chatId of expiredChatIds) {
      delReactionsByChat.run(chatId);
      delStarredByChat.run(chatId);
      delMembersByChat.run(chatId);
      delChat.run(chatId);
    }

    // Recompute last message preview for surviving chats that lost aged-out messages
    const selectLatestMsg = db.prepare(
      'SELECT text, type, file_name, voice_duration_sec, sender_id, created_at_ms, deleted FROM messages WHERE chat_id = ? ORDER BY created_at_ms DESC LIMIT 1',
    );
    const updateChatPreview = db.prepare(
      'UPDATE chats SET last_message_text = ?, last_message_sender_id = ?, last_message_at_ms = ?, updated_at_ms = ? WHERE id = ?',
    );

    for (const chatId of affectedSurvivingChatIds) {
      const latest = selectLatestMsg.get(chatId) as
        | {
            text: string;
            type: string;
            file_name: string;
            voice_duration_sec: number;
            sender_id: string;
            created_at_ms: number;
            deleted: number;
          }
        | undefined;

      if (!latest) {
        updateChatPreview.run('', '', nowMs, nowMs, chatId);
      } else {
        const preview = latest.deleted
          ? 'Message deleted'
          : latest.type === 'image'
            ? latest.text || 'Photo'
            : latest.type === 'voice'
              ? `Voice note (${latest.voice_duration_sec}s)`
              : latest.type === 'file'
                ? latest.text || `File: ${latest.file_name || 'Attachment'}`
                : latest.text;
        updateChatPreview.run(preview.slice(0, 500), latest.sender_id, latest.created_at_ms, nowMs, chatId);
      }
      updatedChatIds.push(chatId);
    }

    // Also clean expired auth sessions and expired OTP codes
    db.prepare('DELETE FROM sessions WHERE expires_at_ms <= ?').run(nowMs);
    db.prepare('DELETE FROM phone_otps WHERE expires_at_ms <= ?').run(nowMs);

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  // Physically remove expired files from server disk
  const deletedDiskFiles: string[] = [];
  for (const f of expiredFiles) {
    if (safeUnlinkInDir(uploadsDir, f.storage_name)) {
      deletedDiskFiles.push(f.storage_name);
    }
  }

  // Sweep orphaned files on disk not referenced in SQLite `files` table
  if (fs.existsSync(uploadsDir)) {
    const referencedRows = db.prepare('SELECT storage_name FROM files').all() as {
      storage_name: string;
    }[];
    const referenced = new Set(referencedRows.map((r) => r.storage_name));
    try {
      const entries = fs.readdirSync(uploadsDir);
      for (const name of entries) {
        if (referenced.has(name)) continue;
        const fullPath = path.resolve(uploadsDir, name);
        try {
          const stat = fs.statSync(fullPath);
          if (!stat.isFile()) continue;
          if (nowMs - stat.mtimeMs >= orphanGraceMs) {
            if (safeUnlinkInDir(uploadsDir, name)) {
              deletedDiskFiles.push(name);
            }
          }
        } catch {
          // Skip files that disappeared mid-sweep
        }
      }
    } catch {
      // Ignore directory read failure
    }
  }

  return {
    purgedChatIds: expiredChatIds,
    purgedMessageIds: expiredMessageIds,
    purgedFileIds: expiredFiles.map((f) => f.id),
    deletedDiskFiles,
    updatedChatIds,
    purgedAtMs: nowMs,
  };
}

/**
 * Deletes all messages and uploaded files authored by a user (plus any empty chats
 * or chats created by them with no other active messages) immediately from DB and disk.
 */
export function wipeUserMessagesAndFiles(
  db: DatabaseSync,
  uploadsDir: string,
  userId: string,
  nowMs: number = Date.now(),
): PurgeResult {
  const memberChats = db
    .prepare('SELECT chat_id FROM chat_members WHERE user_id = ?')
    .all(userId) as { chat_id: string }[];
  const chatIds = memberChats.map((r) => r.chat_id);

  const userFiles = db
    .prepare('SELECT id, storage_name FROM files WHERE uploaded_by = ?')
    .all(userId) as { id: string; storage_name: string }[];

  const fileMap = new Map<string, { id: string; storage_name: string }>();
  for (const f of userFiles) fileMap.set(f.id, f);

  const purgedMessageIds: string[] = [];
  const purgedChatIds: string[] = [];

  if (chatIds.length > 0) {
    const selectFilesByChat = db.prepare('SELECT id, storage_name FROM files WHERE chat_id = ?');
    const selectMsgsByChat = db.prepare('SELECT id FROM messages WHERE chat_id = ?');
    for (const chatId of chatIds) {
      const filesInChat = selectFilesByChat.all(chatId) as { id: string; storage_name: string }[];
      for (const f of filesInChat) fileMap.set(f.id, f);
      const msgsInChat = selectMsgsByChat.all(chatId) as { id: string }[];
      for (const m of msgsInChat) purgedMessageIds.push(m.id);
      purgedChatIds.push(chatId);
    }
  }

  const allFiles = Array.from(fileMap.values());

  db.exec('BEGIN');
  try {
    const delReactionsByChat = db.prepare('DELETE FROM reactions WHERE chat_id = ?');
    const delStarredByChat = db.prepare('DELETE FROM starred WHERE chat_id = ?');
    const delMsgsByChat = db.prepare('DELETE FROM messages WHERE chat_id = ?');
    const delMembersByChat = db.prepare('DELETE FROM chat_members WHERE chat_id = ?');
    const delChat = db.prepare('DELETE FROM chats WHERE id = ?');

    for (const chatId of purgedChatIds) {
      delReactionsByChat.run(chatId);
      delStarredByChat.run(chatId);
      delMsgsByChat.run(chatId);
      delMembersByChat.run(chatId);
      delChat.run(chatId);
    }

    db.prepare('DELETE FROM starred WHERE user_id = ?').run(userId);
    const delFile = db.prepare('DELETE FROM files WHERE id = ?');
    for (const f of allFiles) {
      delFile.run(f.id);
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const deletedDiskFiles: string[] = [];
  for (const f of allFiles) {
    if (safeUnlinkInDir(uploadsDir, f.storage_name)) {
      deletedDiskFiles.push(f.storage_name);
    }
  }

  return {
    purgedChatIds,
    purgedMessageIds,
    purgedFileIds: allFiles.map((f) => f.id),
    deletedDiskFiles,
    updatedChatIds: [],
    purgedAtMs: nowMs,
  };
}

export function getUserRetentionStats(db: DatabaseSync, userId: string): RetentionStats {
  const memberChats = db
    .prepare('SELECT chat_id FROM chat_members WHERE user_id = ?')
    .all(userId) as { chat_id: string }[];

  if (memberChats.length === 0) {
    const orphanFiles = db
      .prepare('SELECT COUNT(*) as cnt, COALESCE(SUM(size_bytes), 0) as total, MIN(expires_at) as min_exp FROM files WHERE uploaded_by = ?')
      .get(userId) as { cnt: number; total: number; min_exp: number | null };
    return {
      retentionHours: RETENTION_HOURS,
      activeChats: 0,
      activeMessages: 0,
      activeFiles: orphanFiles.cnt,
      totalFileBytes: orphanFiles.total,
      nextExpiryMs: orphanFiles.min_exp,
    };
  }

  let activeMessages = 0;
  let activeFiles = 0;
  let totalFileBytes = 0;
  let nextExpiryMs: number | null = null;

  const trackExpiry = (val: number | null | undefined) => {
    if (typeof val === 'number' && val > 0) {
      nextExpiryMs = nextExpiryMs === null ? val : Math.min(nextExpiryMs, val);
    }
  };

  const chatExpStmt = db.prepare('SELECT expires_at FROM chats WHERE id = ?');
  const msgStatsStmt = db.prepare(
    'SELECT COUNT(*) as cnt, MIN(expires_at) as min_exp FROM messages WHERE chat_id = ?',
  );
  const fileStatsStmt = db.prepare(
    'SELECT COUNT(*) as cnt, COALESCE(SUM(size_bytes), 0) as total, MIN(expires_at) as min_exp FROM files WHERE chat_id = ?',
  );

  for (const { chat_id } of memberChats) {
    const cRow = chatExpStmt.get(chat_id) as { expires_at: number } | undefined;
    trackExpiry(cRow?.expires_at);

    const mRow = msgStatsStmt.get(chat_id) as { cnt: number; min_exp: number | null };
    activeMessages += mRow.cnt;
    trackExpiry(mRow.min_exp);

    const fRow = fileStatsStmt.get(chat_id) as {
      cnt: number;
      total: number;
      min_exp: number | null;
    };
    activeFiles += fRow.cnt;
    totalFileBytes += fRow.total;
    trackExpiry(fRow.min_exp);
  }

  return {
    retentionHours: RETENTION_HOURS,
    activeChats: memberChats.length,
    activeMessages,
    activeFiles,
    totalFileBytes,
    nextExpiryMs,
  };
}
