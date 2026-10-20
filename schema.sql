-- ==================================================
-- TITAN DATABASE SCHEMA
-- SQLite
--
-- Schema version: 1
--
-- Timestamp convention:
-- Unix timestamps expressed in milliseconds.
--
-- Content identity:
-- media_type + tmdb_id
--
-- Passwords:
-- Store a server-generated password hash only.
-- Never store plaintext passwords.
--
-- Session configuration:
-- The application must enable foreign_keys before
-- executing this schema or serving requests.
--
-- Transaction handling:
-- src/db.js will execute this schema transactionally.
-- Do not add BEGIN/COMMIT here.
-- ==================================================


-- ==================================================
-- SCHEMA MIGRATION HISTORY
-- ==================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,

    applied_at INTEGER NOT NULL
        DEFAULT (unixepoch() * 1000),

    CONSTRAINT schema_migrations_version_positive
        CHECK (version >= 1),

    CONSTRAINT schema_migrations_timestamp_valid
        CHECK (applied_at >= 0)
) STRICT;


-- ==================================================
-- USERS
--
-- email:
-- Application validation must normalize and validate
-- addresses before insertion.
--
-- password_hash:
-- Encoded hash containing the algorithm parameters,
-- salt and derived hash.
--
-- password_changed_at:
-- Used by the application to invalidate sessions
-- created before a password change.
--
-- is_active:
-- Disabled accounts must not authenticate or use
-- protected routes.
-- ==================================================

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,

    email TEXT NOT NULL COLLATE NOCASE,

    display_name TEXT NOT NULL,

    password_hash TEXT NOT NULL,

    is_active INTEGER NOT NULL
        DEFAULT 1,

    password_changed_at INTEGER NOT NULL
        DEFAULT (unixepoch() * 1000),

    last_login_at INTEGER,

    created_at INTEGER NOT NULL
        DEFAULT (unixepoch() * 1000),

    updated_at INTEGER NOT NULL
        DEFAULT (unixepoch() * 1000),

    CONSTRAINT users_email_unique
        UNIQUE (email),

    CONSTRAINT users_email_length
        CHECK (
            length(email) BETWEEN 3 AND 254
        ),

    CONSTRAINT users_email_trimmed
        CHECK (
            email = trim(email)
        ),

    CONSTRAINT users_email_lowercase
        CHECK (
            email = lower(email)
        ),

    CONSTRAINT users_email_no_null_character
        CHECK (
            instr(email, char(0)) = 0
        ),

    CONSTRAINT users_display_name_length
        CHECK (
            length(display_name) BETWEEN 1 AND 80
        ),

    CONSTRAINT users_display_name_trimmed
        CHECK (
            display_name = trim(display_name)
        ),

    CONSTRAINT users_display_name_no_null_character
        CHECK (
            instr(display_name, char(0)) = 0
        ),

    CONSTRAINT users_password_hash_length
        CHECK (
            length(password_hash) BETWEEN 32 AND 2048
        ),

    CONSTRAINT users_password_hash_no_null_character
        CHECK (
            instr(password_hash, char(0)) = 0
        ),

    CONSTRAINT users_active_boolean
        CHECK (
            is_active IN (0, 1)
        ),

    CONSTRAINT users_password_changed_timestamp
        CHECK (
            password_changed_at >= 0
        ),

    CONSTRAINT users_last_login_timestamp
        CHECK (
            last_login_at IS NULL
            OR last_login_at >= 0
        ),

    CONSTRAINT users_created_timestamp
        CHECK (
            created_at >= 0
        ),

    CONSTRAINT users_updated_timestamp
        CHECK (
            updated_at >= created_at
        )
) STRICT;


-- ==================================================
-- SERVER-SIDE SESSIONS
--
-- sid:
-- Session identifier managed by express-session.
--
-- data:
-- Serialized session object.
-- It may contain a user ID, CSRF token and session
-- authentication timestamps.
--
-- Do not store passwords, password hashes or provider
-- credentials inside session data.
--
-- expires_at:
-- Absolute expiry time in milliseconds.
--
-- The SQLite session store will implement:
-- get, set, destroy, touch and expired-session cleanup.
-- ==================================================

CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY NOT NULL,

    data TEXT NOT NULL,

    expires_at INTEGER NOT NULL,

    created_at INTEGER NOT NULL
        DEFAULT (unixepoch() * 1000),

    updated_at INTEGER NOT NULL
        DEFAULT (unixepoch() * 1000),

    CONSTRAINT sessions_sid_length
        CHECK (
            length(sid) BETWEEN 16 AND 256
        ),

    CONSTRAINT sessions_sid_no_null_character
        CHECK (
            instr(sid, char(0)) = 0
        ),

    CONSTRAINT sessions_data_size
        CHECK (
            length(CAST(data AS BLOB)) <= 65536
        ),

    CONSTRAINT sessions_data_json_object
        CHECK (
            CASE
                WHEN json_valid(data)
                THEN json_type(data) = 'object'
                ELSE 0
            END
        ),

    CONSTRAINT sessions_expiry_valid
        CHECK (
            expires_at >= 0
        ),

    CONSTRAINT sessions_created_timestamp
        CHECK (
            created_at >= 0
        ),

    CONSTRAINT sessions_updated_timestamp
        CHECK (
            updated_at >= created_at
        )
) STRICT;


CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
    ON sessions (expires_at);


-- ==================================================
-- PERSONAL WATCHLIST
--
-- Canonical identity:
-- user_id + media_type + tmdb_id
--
-- Snapshot fields help render a saved list if the
-- metadata provider is temporarily unavailable.
--
-- Snapshots are not proof of playback availability
-- and must come from validated metadata.
-- ==================================================

CREATE TABLE IF NOT EXISTS watchlist (
    user_id INTEGER NOT NULL,

    media_type TEXT NOT NULL,

    tmdb_id INTEGER NOT NULL,

    imdb_id TEXT,

    title TEXT NOT NULL,

    poster_path TEXT,

    backdrop_path TEXT,

    release_year INTEGER,

    added_at INTEGER NOT NULL
        DEFAULT (unixepoch() * 1000),

    PRIMARY KEY (
        user_id,
        media_type,
        tmdb_id
    ),

    FOREIGN KEY (user_id)
        REFERENCES users (id)
        ON DELETE CASCADE,

    CONSTRAINT watchlist_media_type
        CHECK (
            media_type IN ('movie', 'tv')
        ),

    CONSTRAINT watchlist_tmdb_id_valid
        CHECK (
            tmdb_id BETWEEN 1 AND 9007199254740991
        ),

    CONSTRAINT watchlist_imdb_id_valid
        CHECK (
            imdb_id IS NULL
            OR (
                length(imdb_id) BETWEEN 7 AND 14
                AND substr(imdb_id, 1, 2) = 'tt'
                AND substr(imdb_id, 3) NOT GLOB '*[^0-9]*'
            )
        ),

    CONSTRAINT watchlist_title_length
        CHECK (
            length(title) BETWEEN 1 AND 500
        ),

    CONSTRAINT watchlist_title_trimmed
        CHECK (
            title = trim(title)
        ),

    CONSTRAINT watchlist_title_no_null_character
        CHECK (
            instr(title, char(0)) = 0
        ),

    CONSTRAINT watchlist_poster_path_length
        CHECK (
            poster_path IS NULL
            OR length(poster_path) BETWEEN 1 AND 1024
        ),

    CONSTRAINT watchlist_backdrop_path_length
        CHECK (
            backdrop_path IS NULL
            OR length(backdrop_path) BETWEEN 1 AND 1024
        ),

    CONSTRAINT watchlist_release_year_valid
        CHECK (
            release_year IS NULL
            OR release_year BETWEEN 1800 AND 9999
        ),

    CONSTRAINT watchlist_added_timestamp
        CHECK (
            added_at >= 0
        )
) STRICT;


CREATE INDEX IF NOT EXISTS idx_watchlist_user_added
    ON watchlist (
        user_id,
        added_at DESC
    );


-- ==================================================
-- PLAYBACK PROGRESS
--
-- One latest progress record per movie or TV series
-- for each user.
--
-- TV:
-- season_number and episode_number identify the
-- most recently reported episode.
--
-- Movie:
-- season_number and episode_number must be NULL.
--
-- The browser must validate the active iframe,
-- event.origin and event payload before submission.
--
-- The server must separately validate every request.
-- Browser-supplied progress is not trusted merely
-- because this table accepts numeric values.
-- ==================================================

CREATE TABLE IF NOT EXISTS playback_progress (
    user_id INTEGER NOT NULL,

    media_type TEXT NOT NULL,

    tmdb_id INTEGER NOT NULL,

    imdb_id TEXT,

    title TEXT NOT NULL,

    poster_path TEXT,

    season_number INTEGER,

    episode_number INTEGER,

    position_seconds REAL NOT NULL,

    duration_seconds REAL NOT NULL,

    completed INTEGER NOT NULL
        DEFAULT 0,

    last_event TEXT NOT NULL,

    created_at INTEGER NOT NULL
        DEFAULT (unixepoch() * 1000),

    updated_at INTEGER NOT NULL
        DEFAULT (unixepoch() * 1000),

    PRIMARY KEY (
        user_id,
        media_type,
        tmdb_id
    ),

    FOREIGN KEY (user_id)
        REFERENCES users (id)
        ON DELETE CASCADE,

    CONSTRAINT progress_media_type
        CHECK (
            media_type IN ('movie', 'tv')
        ),

    CONSTRAINT progress_tmdb_id_valid
        CHECK (
            tmdb_id BETWEEN 1 AND 9007199254740991
        ),

    CONSTRAINT progress_imdb_id_valid
        CHECK (
            imdb_id IS NULL
            OR (
                length(imdb_id) BETWEEN 7 AND 14
                AND substr(imdb_id, 1, 2) = 'tt'
                AND substr(imdb_id, 3) NOT GLOB '*[^0-9]*'
            )
        ),

    CONSTRAINT progress_title_length
        CHECK (
            length(title) BETWEEN 1 AND 500
        ),

    CONSTRAINT progress_title_trimmed
        CHECK (
            title = trim(title)
        ),

    CONSTRAINT progress_title_no_null_character
        CHECK (
            instr(title, char(0)) = 0
        ),

    CONSTRAINT progress_poster_path_length
        CHECK (
            poster_path IS NULL
            OR length(poster_path) BETWEEN 1 AND 1024
        ),

    CONSTRAINT progress_episode_selection
        CHECK (
            (
                media_type = 'movie'
                AND season_number IS NULL
                AND episode_number IS NULL
            )
            OR
            (
                media_type = 'tv'
                AND season_number IS NOT NULL
                AND episode_number IS NOT NULL
                AND season_number BETWEEN 0 AND 10000
                AND episode_number BETWEEN 1 AND 100000
            )
        ),

    CONSTRAINT progress_position_valid
        CHECK (
            position_seconds >= 0
            AND position_seconds < 1000000000
        ),

    CONSTRAINT progress_duration_valid
        CHECK (
            duration_seconds > 0
            AND duration_seconds < 1000000000
        ),

    CONSTRAINT progress_position_within_duration
        CHECK (
            position_seconds <= duration_seconds
        ),

    CONSTRAINT progress_completed_boolean
        CHECK (
            completed IN (0, 1)
        ),

    CONSTRAINT progress_last_event_valid
        CHECK (
            last_event IN (
                'playing',
                'paused',
                'completed',
                'seeked'
            )
        ),

    CONSTRAINT progress_created_timestamp
        CHECK (
            created_at >= 0
        ),

    CONSTRAINT progress_updated_timestamp
        CHECK (
            updated_at >= created_at
        )
) STRICT;


CREATE INDEX IF NOT EXISTS idx_progress_user_updated
    ON playback_progress (
        user_id,
        updated_at DESC
    );


CREATE INDEX IF NOT EXISTS idx_progress_user_completed_updated
    ON playback_progress (
        user_id,
        completed,
        updated_at DESC
    );


-- ==================================================
-- PERSONAL TITLE NOTES
--
-- Separate from provider metadata.
-- Notes are private to the authenticated account.
--
-- The server must enforce ownership using the
-- authenticated user ID, not a client-supplied ID.
-- ==================================================

CREATE TABLE IF NOT EXISTS title_notes (
    user_id INTEGER NOT NULL,

    media_type TEXT NOT NULL,

    tmdb_id INTEGER NOT NULL,

    note TEXT NOT NULL,

    created_at INTEGER NOT NULL
        DEFAULT (unixepoch() * 1000),

    updated_at INTEGER NOT NULL
        DEFAULT (unixepoch() * 1000),

    PRIMARY KEY (
        user_id,
        media_type,
        tmdb_id
    ),

    FOREIGN KEY (user_id)
        REFERENCES users (id)
        ON DELETE CASCADE,

    CONSTRAINT notes_media_type
        CHECK (
            media_type IN ('movie', 'tv')
        ),

    CONSTRAINT notes_tmdb_id_valid
        CHECK (
            tmdb_id BETWEEN 1 AND 9007199254740991
        ),

    CONSTRAINT notes_length
        CHECK (
            length(note) <= 2000
        ),

    CONSTRAINT notes_no_null_character
        CHECK (
            instr(note, char(0)) = 0
        ),

    CONSTRAINT notes_created_timestamp
        CHECK (
            created_at >= 0
        ),

    CONSTRAINT notes_updated_timestamp
        CHECK (
            updated_at >= created_at
        )
) STRICT;


-- ==================================================
-- ACCOUNT PREFERENCES
--
-- The database validates JSON structure and size.
-- The application must allowlist preference names
-- and validate each value before saving.
--
-- Do not store API credentials, session secrets,
-- passwords or authorization claims here.
-- ==================================================

CREATE TABLE IF NOT EXISTS user_preferences (
    user_id INTEGER PRIMARY KEY,

    preferences_json TEXT NOT NULL
        DEFAULT '{}',

    created_at INTEGER NOT NULL
        DEFAULT (unixepoch() * 1000),

    updated_at INTEGER NOT NULL
        DEFAULT (unixepoch() * 1000),

    FOREIGN KEY (user_id)
        REFERENCES users (id)
        ON DELETE CASCADE,

    CONSTRAINT preferences_size
        CHECK (
            length(
                CAST(preferences_json AS BLOB)
            ) <= 16384
        ),

    CONSTRAINT preferences_json_object
        CHECK (
            CASE
                WHEN json_valid(preferences_json)
                THEN json_type(preferences_json) = 'object'
                ELSE 0
            END
        ),

    CONSTRAINT preferences_created_timestamp
        CHECK (
            created_at >= 0
        ),

    CONSTRAINT preferences_updated_timestamp
        CHECK (
            updated_at >= created_at
        )
) STRICT;


-- ==================================================
-- RECORD THIS INITIAL SCHEMA VERSION
--
-- Running this schema again must not overwrite the
-- original migration timestamp.
--
-- This statement does not replace a migration system
-- for future changes to existing table structures.
-- ==================================================

INSERT INTO schema_migrations (
    version
)
VALUES (
    1
)
ON CONFLICT (version) DO NOTHING;  
