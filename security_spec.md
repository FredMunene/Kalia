# CareerJogger Firestore Security Specification (Phase 0)

## 1. Data Invariants
1. **Default Deny**: Every unmatched Firestore path is denied for both read and write.
2. **Strict Owner Isolation**: Every `/users/{userId}` document and subcollection (`/facts`, `/applications`, `/generatedDocs`) is strictly owned by `userId == request.auth.uid` with `request.auth.token.email_verified == true`.
3. **Master Gate Parent Binding**: Any read/write on subcollections (`facts`, `applications`, `generatedDocs`) validates `ownerId == request.auth.uid` and verifies the parent `/users/{userId}` document exists and belongs to `request.auth.uid` (for single-doc operations; `list` enforces `resource.data.ownerId == request.auth.uid` directly without `get()`/`exists()`).
4. **No Self-Assigned Roles**: `/users/{userId}` forbids RBAC fields (`role`, `isAdmin`, `admin`). `/admins/{userId}` is immutable from client SDKs except read-only lookup by owner or bootstrapped verified admin (`munene2050gitonga@gmail.com`).
5. **Strict Key & Size Enforcement**: Every create and update enforces `hasAll` + `hasOnly` allowlisted keys and explicit `.size()` bounds on every string and list.
6. **Temporal & Ownership Immutability**: `uid`, `ownerId`, `id`, and `createdAt` cannot change after creation; `createdAt == request.time` on create and `updatedAt == request.time` on write.
7. **Admin Telemetry Isolation**: Only the verified admin (`request.auth.token.email == 'munene2050gitonga@gmail.com' && request.auth.token.email_verified == true`) can list `/userStats`; standard users can only read/write their own `/userStats/{uid}` record.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Shadow Ghost Field on UserWorkspace Create**: Include `isAdmin: true` in `/users/{uid}` create payload -> `PERMISSION_DENIED` (`hasOnly` rejects).
2. **Cross-Tenant User Read (`get`)**: Authenticated User B attempts `get(/users/{userA})` -> `PERMISSION_DENIED`.
3. **Cross-Tenant Fact Write**: User B attempts `create(/users/{userA}/facts/f1)` with `ownerId: userB` -> `PERMISSION_DENIED`.
4. **Unverified Email Spoof of Admin**: Attacker with `email: "munene2050gitonga@gmail.com"` and `email_verified: false` attempts `list(/userStats)` -> `PERMISSION_DENIED`.
5. **Non-Admin Telemetry Scrape (`list`)**: Regular verified user attempts `list(/userStats)` without `where("uid", "==", auth.uid)` -> `PERMISSION_DENIED`.
6. **1MB Poisoned Document ID**: User attempts `create(/users/{uid}/facts/<200-char-invalid-id>)` -> `PERMISSION_DENIED` (`isValidId` regex + max 128 chars rejects).
7. **Client-Spoofed Timestamp**: User sends `createdAt: Timestamp(1999-01-01)` instead of `serverTimestamp()` -> `PERMISSION_DENIED` (`createdAt == request.time` rejects).
8. **Immutable Owner Swap on Update**: User updates `/users/{uid}/applications/app1` trying to change `ownerId` -> `PERMISSION_DENIED`.
9. **Unbounded Array Bomb on `savedQAs`**: User writes 50 items into `savedQAs` array -> `PERMISSION_DENIED` (`size() <= 30` rejects).
10. **Invalid Enum on `docType`**: User writes `docType: "executable"` on `/users/{uid}/generatedDocs/d1` -> `PERMISSION_DENIED`.
11. **Negative / Non-Numeric Token Telemetry**: User writes `totalTokensUsed: -500` or `applicationCount: "999"` in `/userStats/{uid}` -> `PERMISSION_DENIED`.
12. **Privilege Escalation via `/admins/{uid}`**: Authenticated non-admin attempts `setDoc(/admins/{uid}, { uid, email })` -> `PERMISSION_DENIED`.
