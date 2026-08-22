-- better-auth core schema + admin plugin fields, for better-auth 1.7.
--
-- Source of truth: node_modules/@better-auth/core/dist/db/get-tables.mjs
-- (the CLI's output was verified against it — the standalone CLI lags the
-- runtime, and 1.7 added account.issuer + its unique index over what the CLI
-- emits). If better-auth is upgraded, re-verify against that file.
--
-- Note: with secondaryStorage (KV) configured, better-auth keeps live
-- sessions and verification values in KV, not here. The session and
-- verification tables exist anyway: they cost nothing empty, and flipping
-- session.storeSessionInDatabase on (e.g. for the admin plugin's
-- list-sessions) must not require a migration.

create table "user" (
  "id" text not null primary key,
  "name" text not null,
  "email" text not null unique,
  "emailVerified" integer not null,
  "image" text,
  "createdAt" date not null,
  "updatedAt" date not null,
  -- admin plugin
  "role" text,
  "banned" integer,
  "banReason" text,
  "banExpires" date
);

create table "session" (
  "id" text not null primary key,
  "expiresAt" date not null,
  "token" text not null unique,
  "createdAt" date not null,
  "updatedAt" date not null,
  "ipAddress" text,
  "userAgent" text,
  "userId" text not null references "user" ("id") on delete cascade,
  -- admin plugin
  "impersonatedBy" text
);

create table "account" (
  "id" text not null primary key,
  "issuer" text not null,
  "accountId" text not null,
  "providerId" text not null,
  "userId" text not null references "user" ("id") on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" date,
  "refreshTokenExpiresAt" date,
  "scope" text,
  "password" text,
  "createdAt" date not null,
  "updatedAt" date not null
);

create table "verification" (
  "id" text not null primary key,
  "identifier" text not null,
  "value" text not null,
  "expiresAt" date not null,
  "createdAt" date not null,
  "updatedAt" date not null
);

create index "session_userId_idx" on "session" ("userId");
create unique index "account_issuer_accountId_idx" on "account" ("issuer", "accountId");
create index "account_userId_idx" on "account" ("userId");
create index "verification_identifier_idx" on "verification" ("identifier");
