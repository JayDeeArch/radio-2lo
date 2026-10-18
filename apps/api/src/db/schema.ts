import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const admins = pgTable('admins', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** `id` z GET /me */
  spotifyId: text('spotify_id').notNull().unique(),
  /** `account_id` - stabilny identyfikator konta (dodany w maju 2026). */
  accountId: text('account_id'),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
});

export const sessions = pgTable(
  'sessions',
  {
    /** sha256 tokenu z ciasteczka - surowy token nigdy nie trafia do bazy. */
    tokenHash: text('token_hash').primaryKey(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => admins.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('sessions_admin_idx').on(t.adminId), index('sessions_expires_idx').on(t.expiresAt)],
);

export const requests = pgTable(
  'requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // --- snapshot metadanych w chwili zgłoszenia ---
    spotifyTrackId: text('spotify_track_id').notNull(),
    uri: text('uri').notNull(),
    trackName: text('track_name').notNull(),
    artistName: text('artist_name').notNull(),
    albumName: text('album_name'),
    albumImageUrl: text('album_image_url'),
    durationMs: integer('duration_ms'),
    releaseYear: integer('release_year'),
    isExplicit: boolean('is_explicit').notNull().default(false),
    /** Tytuł + artyści + album, znormalizowany (bez polskich znaków) - pod pg_trgm. */
    searchBlob: text('search_blob').notNull(),

    // --- zgłoszenie ---
    class: text('class').notNull(),
    note: text('note'),

    // --- decyzja ---
    status: text('status').notNull().default('OCZEKUJACE'),
    rejectReason: text('reject_reason'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: uuid('decided_by').references(() => admins.id, { onDelete: 'set null' }),

    // --- synchronizacja ze Spotify ---
    spotifySync: text('spotify_sync').notNull().default('NOT_REQUIRED'),
    spotifyError: text('spotify_error'),
    spotifyAddedAt: timestamp('spotify_added_at', { withTimezone: true }),
    spotifyPosition: integer('spotify_position'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Jeden aktywny (nieodrzucony) wiersz na utwór - blokuje duplikaty zgłoszeń.
    uniqueIndex('requests_active_track_uniq')
      .on(t.spotifyTrackId)
      .where(sql`${t.status} <> 'ODRZUCONE'`),
    index('requests_status_created_idx').on(t.status, t.createdAt),
    index('requests_class_idx').on(t.class),
    index('requests_track_idx').on(t.spotifyTrackId),
  ],
);

/**
 * Lokalna kopia zawartości playlisty szkolnego radia.
 *
 * Wypełniana przez harmonogram synchronizacji, która i tak musi pobrać
 * całą playlistę. Publiczny endpoint `/api/playlist` czyta stąd, dzięki
 * czemu wyświetlenie strony nie zużywa limitu zapytań Spotify.
 */
export const playlistItems = pgTable(
  'playlist_items',
  {
    /** Pozycja na playliscie (0-based). Ten sam utwór może wystąpić wielokrotnie. */
    position: integer('position').primaryKey(),
    spotifyTrackId: text('spotify_track_id').notNull(),
    trackName: text('track_name').notNull(),
    artistName: text('artist_name').notNull(),
    albumName: text('album_name'),
    albumImageUrl: text('album_image_url'),
    durationMs: integer('duration_ms'),
    releaseYear: integer('release_year'),
    isExplicit: boolean('is_explicit').notNull().default(false),
    externalUrl: text('external_url').notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }),
    searchBlob: text('search_blob').notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('playlist_items_track_idx').on(t.spotifyTrackId)],
);

export const requestEvents = pgTable(
  'request_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => requests.id, { onDelete: 'cascade' }),
    adminId: uuid('admin_id').references(() => admins.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    detail: text('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('request_events_request_idx').on(t.requestId, t.createdAt)],
);

/**
 * Głos na utwór. Jeden wiersz = jedna osoba (identyfikowana klasą) zgłaszająca
 * prośbę o dany utwór. Wiele osób może głosować na ten sam utwór, a
 * `requests` (jeden wiersz na utwór) pozostaje bez zmian.
 */
export const requestVotes = pgTable(
  'request_votes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => requests.id, { onDelete: 'cascade' }),
    class: text('class').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('request_votes_request_idx').on(t.requestId, t.createdAt)],
);

/** Ustawienia i sekrety: tokeny Spotify administratora, statystyki synchronizacji. */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const adminAllowlist = pgTable('admin_allowlist', {
  id: uuid('id').primaryKey().defaultRandom(),
  spotifyId: text('spotify_id').notNull().unique(),
  addedBy: uuid('added_by').references(() => admins.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const dedications = pgTable('dedications', {
  id: uuid('id').primaryKey().defaultRandom(),
  spotifyTrackId: text('spotify_track_id').notNull(),
  uri: text('uri').notNull(),
  trackName: text('track_name').notNull(),
  artistName: text('artist_name').notNull(),
  albumName: text('album_name'),
  albumImageUrl: text('album_image_url'),
  durationMs: integer('duration_ms'),
  releaseYear: integer('release_year'),
  isExplicit: boolean('is_explicit').notNull().default(false),
  searchBlob: text('search_blob').notNull(),
  recipientName: text('recipient_name').notNull(),
  senderName: text('sender_name'),
  isAnonymous: boolean('is_anonymous').notNull().default(false),
  message: text('message'),
  targetDate: text('target_date').notNull(),
  hidden: boolean('hidden').notNull().default(false),
  requestId: uuid('request_id').references(() => requests.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('OCZEKUJACE'),
  rejectReason: text('reject_reason'),
  decidedBy: uuid('decided_by').references(() => admins.id, { onDelete: 'set null' }),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Admin = typeof admins.$inferSelect;
export type Dedication = typeof dedications.$inferSelect;
export type AdminAllowlistEntry = typeof adminAllowlist.$inferSelect;
export type Request = typeof requests.$inferSelect;
export type NewRequest = typeof requests.$inferInsert;
export type RequestEvent = typeof requestEvents.$inferSelect;
export type RequestVote = typeof requestVotes.$inferSelect;
export type Session = typeof sessions.$inferSelect;
