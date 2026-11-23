/**
 * Phase 0 Payload-First Security Test Suite Specification for CareerJogger
 * Verifies the "Dirty Dozen" adversarial payloads against firestore.rules.
 */

export interface AdversarialPayloadCase {
  id: string;
  targetPath: string;
  operation: "get" | "list" | "create" | "update" | "delete";
  auth: { uid: string; email: string; emailVerified: boolean } | null;
  payload?: Record<string, unknown>;
  expected: "PERMISSION_DENIED";
}

export const DIRTY_DOZEN_CASES: AdversarialPayloadCase[] = [
  {
    id: "dd-01-shadow-ghost-field",
    targetPath: "/users/userA",
    operation: "create",
    auth: { uid: "userA", email: "a@example.com", emailVerified: true },
    payload: {
      uid: "userA",
      email: "a@example.com",
      displayName: "User A",
      profile: {},
      isAdmin: true,
    },
    expected: "PERMISSION_DENIED",
  },
  {
    id: "dd-02-cross-tenant-user-get",
    targetPath: "/users/userA",
    operation: "get",
    auth: { uid: "userB", email: "b@example.com", emailVerified: true },
    expected: "PERMISSION_DENIED",
  },
  {
    id: "dd-03-cross-tenant-fact-create",
    targetPath: "/users/userA/facts/fact1",
    operation: "create",
    auth: { uid: "userB", email: "b@example.com", emailVerified: true },
    payload: { id: "fact1", ownerId: "userB", title: "Hijack", detail: "x" },
    expected: "PERMISSION_DENIED",
  },
  {
    id: "dd-04-unverified-admin-email-spoof",
    targetPath: "/userStats",
    operation: "list",
    auth: {
      uid: "attacker",
      email: "munene2050gitonga@gmail.com",
      emailVerified: false,
    },
    expected: "PERMISSION_DENIED",
  },
  {
    id: "dd-05-non-admin-userstats-scrape",
    targetPath: "/userStats",
    operation: "list",
    auth: { uid: "userB", email: "b@example.com", emailVerified: true },
    expected: "PERMISSION_DENIED",
  },
  {
    id: "dd-06-poisoned-long-id",
    targetPath: `/users/userA/facts/${"x".repeat(200)}`,
    operation: "create",
    auth: { uid: "userA", email: "a@example.com", emailVerified: true },
    payload: { id: "x".repeat(200), ownerId: "userA", title: "Bad ID" },
    expected: "PERMISSION_DENIED",
  },
  {
    id: "dd-07-spoofed-client-timestamp",
    targetPath: "/users/userA/facts/fact2",
    operation: "create",
    auth: { uid: "userA", email: "a@example.com", emailVerified: true },
    payload: {
      id: "fact2",
      ownerId: "userA",
      category: "Projects",
      title: "Valid",
      detail: "Detail",
      verified: true,
      createdAt: "1999-01-01T00:00:00Z",
      updatedAt: "1999-01-01T00:00:00Z",
    },
    expected: "PERMISSION_DENIED",
  },
  {
    id: "dd-08-immutable-owner-swap",
    targetPath: "/users/userA/applications/app1",
    operation: "update",
    auth: { uid: "userA", email: "a@example.com", emailVerified: true },
    payload: { ownerId: "userB" },
    expected: "PERMISSION_DENIED",
  },
  {
    id: "dd-09-array-bomb-saved-qas",
    targetPath: "/users/userA/applications/app2",
    operation: "create",
    auth: { uid: "userA", email: "a@example.com", emailVerified: true },
    payload: {
      id: "app2",
      ownerId: "userA",
      company: "Acme",
      role: "Eng",
      status: "Submitted",
      savedQAs: Array.from({ length: 45 }, (_, i) => ({
        id: `q${i}`,
        question: "Q",
        answer: "A",
        updatedAt: "2026-01-01",
      })),
    },
    expected: "PERMISSION_DENIED",
  },
  {
    id: "dd-10-invalid-doctype-enum",
    targetPath: "/users/userA/generatedDocs/doc1",
    operation: "create",
    auth: { uid: "userA", email: "a@example.com", emailVerified: true },
    payload: {
      id: "doc1",
      ownerId: "userA",
      docType: "executable",
      company: "Acme",
      role: "Eng",
      title: "Bad",
      pdfFileName: "bad.exe",
    },
    expected: "PERMISSION_DENIED",
  },
  {
    id: "dd-11-negative-token-stats",
    targetPath: "/userStats/userA",
    operation: "update",
    auth: { uid: "userA", email: "a@example.com", emailVerified: true },
    payload: {
      uid: "userA",
      totalTokensUsed: -500,
    },
    expected: "PERMISSION_DENIED",
  },
  {
    id: "dd-12-admin-roster-escalation",
    targetPath: "/admins/userB",
    operation: "create",
    auth: { uid: "userB", email: "b@example.com", emailVerified: true },
    payload: { uid: "userB", email: "b@example.com" },
    expected: "PERMISSION_DENIED",
  },
];
