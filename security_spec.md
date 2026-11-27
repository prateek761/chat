# ARK DM Security Specification (Phase 0 TDD)

## 1. Data Invariants

1. **PII Isolation**: Email addresses and account settings live exclusively in `/users/{userId}` and are readable/writable only by the owner (`request.auth.uid == userId`). Public directory profiles in `/profiles/{userId}` contain zero PII.
2. **Verified Identity**: All writes require an authenticated user with `request.auth.token.email_verified == true`.
3. **Master Gate Membership**: Every sub-resource under `/chats/{chatId}` (`members`, `messages`, `reactions`) enforces parent membership by fetching `/chats/{chatId}` via `get()` on single-doc operations, and validates `request.auth.uid in resource.data.participantIds` on `list` queries without `get()` fan-out.
4. **Bounded Arrays & Volumetric Limits**: `participantIds` and `readBy` are strictly bounded to `[1..20]` elements with element-type checks (`[0] is string`). Every string field enforces explicit `.size()` bounds matching `firebase-blueprint.json`.
5. **Path ID Hardening**: All single-document operations enforce `isValidId(id)` (`^[a-zA-Z0-9_\-]+$`, max 128 chars).
6. **Temporal & Immutability Integrity**: `createdAt` and `updatedAt` must equal `request.time`. Immutable fields (`uid`, `createdBy`, `senderId`, `chatId`, `createdAt`) cannot be altered after creation.
7. **Atomicity Guarantee**: Creating a message in `/chats/{chatId}/messages/{messageId}` requires the parent `/chats/{chatId}` document's `lastMessageAt` to be updated to `request.time` in the same batch (`getAfter()`).
8. **Tiered Identity Updates**: Only a message's original `senderId` may edit (`text`, `edited`) or soft-delete (`deleted`, `text`) it; other chat participants may only update `readBy` and `updatedAt`.

## 2. The "Dirty Dozen" Adversarial Payloads

| # | Attack Vector | Target Path | Malicious Payload / Action | Expected Rule Result |
|---|---|---|---|---|
| 1 | Shadow Field Injection | `/profiles/u1` (create) | Valid profile + `{ "isAdmin": true }` | `PERMISSION_DENIED` (`hasOnly` rejects ghost key) |
| 2 | Identity Spoofing | `/chats/c1/messages/m1` (create) | `{ "senderId": "victim_uid", ... }` by `attacker_uid` | `PERMISSION_DENIED` (`senderId == request.auth.uid`) |
| 3 | Unverified Email Write | `/profiles/u1` (create) | Valid payload with `email_verified: false` | `PERMISSION_DENIED` (`isVerifiedUser()`) |
| 4 | Cross-User PII Read | `/users/victim_uid` (get) | Read by `attacker_uid` | `PERMISSION_DENIED` (`isOwner(userId)`) |
| 5 | Path ID Poisoning | `/chats/bad$id..1500chars` (create) | Oversized/invalid regex chatId | `PERMISSION_DENIED` (`isValidId(chatId)`) |
| 6 | Message Text Tampering by Non-Sender | `/chats/c1/messages/m1` (update) | Participant B updates `{ "text": "forged", "edited": true }` on A's message | `PERMISSION_DENIED` (Tier 2 only allows `readBy`, `updatedAt`) |
| 7 | Forged Client Timestamp | `/chats/c1/messages/m1` (create) | `{ "createdAt": "2020-01-01T00:00:00Z" }` | `PERMISSION_DENIED` (`createdAt == request.time`) |
| 8 | Unbounded Array DoS | `/chats/c1` (create) | `participantIds` with 25 entries | `PERMISSION_DENIED` (`size() <= 20`) |
| 9 | Immutable Owner Mutation | `/chats/c1` (update) | Change `createdBy` to another UID | `PERMISSION_DENIED` (`createdBy == existing().createdBy` + `affectedKeys`) |
| 10 | Non-Member Message Injection | `/chats/c1/messages/m9` (create) | Outsider writes message into private chat `c1` | `PERMISSION_DENIED` (Master Gate parent `get()`) |
| 11 | Orphaned Message Write (Desync) | `/chats/c1/messages/m9` (create) | Write message without updating parent `/chats/c1.lastMessageAt` | `PERMISSION_DENIED` (`getAfter()` atomicity check) |
| 12 | Value Poisoning on Allowed Key | `/chats/c1/messages/m1` (update) | Sender updates `text` to a 5000-char string or integer `12345` | `PERMISSION_DENIED` (`isValidMessage(incoming())` enforces type & `size() <= 2000`) |
