import dotenv from "dotenv";

import {
  existsSync
} from "node:fs";

import {
  dirname,
  isAbsolute,
  resolve
} from "node:path";

import {
  fileURLToPath
} from "node:url";


/* ==================================================
   PROJECT PATHS
================================================== */

const CURRENT_FILE = fileURLToPath(import.meta.url);

const CURRENT_DIRECTORY = dirname(CURRENT_FILE);

export const PROJECT_ROOT = resolve(
  CURRENT_DIRECTORY,
  ".."
);

export const ENV_FILE_PATH = resolve(
  PROJECT_ROOT,
  ".env"
);


/* ==================================================
   ENVIRONMENT FILE
   Existing process environment values take priority.
================================================== */

if (existsSync(ENV_FILE_PATH)) {
  const result = dotenv.config({
    path: ENV_FILE_PATH,
    override: false
  });

  if (result.error) {
    throw new Error(
      "TITAN could not read the local .env file. " +
      "Check its location and file permissions."
    );
  }
}


/* ==================================================
   CONFIGURATION ERRORS AND WARNINGS
   Never include credential values in messages.
================================================== */

const configurationErrors = [];

const warningMessages = [];


export class ConfigurationError extends Error {
  constructor(messages) {
    super(
      [
        "TITAN configuration is invalid:",
        ...messages.map(
          message => `- ${message}`
        )
      ].join("
")
    );

    this.name = "ConfigurationError";

    this.issues = Object.freeze([
      ...messages
    ]);
  }
}


function addError(message) {
  configurationErrors.push(message);
}


function addWarning(message) {
  warningMessages.push(message);
}


/* ==================================================
   ENVIRONMENT READERS
================================================== */

function readText(
  name,
  defaultValue = ""
) {
  const value = process.env[name];

  if (
    value === undefined ||
    value.trim() === ""
  ) {
    return defaultValue;
  }

  return value.trim();
}


function readEnum(
  name,
  allowedValues,
  defaultValue
) {
  const value = readText(
    name,
    defaultValue
  );

  if (!allowedValues.includes(value)) {
    addError(
      `${name} must be one of: ` +
      allowedValues.join(", ") +
      "."
    );

    return defaultValue;
  }

  return value;
}


function readInteger(
  name,
  {
    defaultValue,
    minimum,
    maximum
  }
) {
  const rawValue = readText(name);

  if (rawValue === "") {
    return defaultValue;
  }

  if (!/^d+$/.test(rawValue)) {
    addError(
      `${name} must be a whole non-negative number.`
    );

    return defaultValue;
  }

  const value = Number(rawValue);

  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    addError(
      `${name} must be between ` +
      `${minimum} and ${maximum}.`
    );

    return defaultValue;
  }

  return value;
}


function readBoolean(
  name,
  defaultValue
) {
  const rawValue = readText(name);

  if (rawValue === "") {
    return defaultValue;
  }

  const value = rawValue.toLowerCase();

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  addError(
    `${name} must be either true or false.`
  );

  return defaultValue;
}


function readOrigin(
  name,
  {
    defaultValue,
    allowedOrigins = null,
    requireHttps = false
  }
) {
  const value = readText(
    name,
    defaultValue
  );

  try {
    const parsed = new URL(value);

    const supportedProtocol = (
      parsed.protocol === "http:" ||
      parsed.protocol === "https:"
    );

    if (!supportedProtocol) {
      throw new Error("Unsupported protocol.");
    }

    if (
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== "/"
    ) {
      throw new Error(
        "An origin cannot contain credentials, " +
        "a path, a query or a fragment."
      );
    }

    if (
      requireHttps &&
      parsed.protocol !== "https:"
    ) {
      throw new Error("HTTPS is required.");
    }

    const origin = parsed.origin;

    if (
      Array.isArray(allowedOrigins) &&
      !allowedOrigins.includes(origin)
    ) {
      throw new Error(
        "The origin is not approved."
      );
    }

    return origin;
  } catch {
    addError(
      `${name} must contain a valid ` +
      (
        requireHttps
          ? "HTTPS origin"
          : "HTTP or HTTPS origin"
      ) +
      (
        allowedOrigins
          ? " from the approved provider configuration."
          : " without a path, query, fragment or credentials."
      )
    );

    return new URL(defaultValue).origin;
  }
}


function readCredential(name) {
  const value = readText(name);

  if (!value) {
    return "";
  }

  if (
    value.length > 8192 ||
    /s/.test(value)
  ) {
    addError(
      `${name} contains whitespace or exceeds ` +
      "the supported credential length."
    );

    return "";
  }

  return value;
}


/* ==================================================
   APPLICATION
================================================== */

const nodeEnvironment = readEnum(
  "NODE_ENV",
  [
    "development",
    "test",
    "production"
  ],
  "development"
);

const isProduction = (
  nodeEnvironment === "production"
);

const isTest = (
  nodeEnvironment === "test"
);

const host = readText(
  "HOST",
  "127.0.0.1"
);

if (
  host.length > 253 ||
  /s|[/\\?#@]/.test(host)
) {
  addError(
    "HOST must be a hostname or bind address, " +
    "not a URL or path."
  );
}

const port = readInteger(
  "PORT",
  {
    defaultValue: 3000,
    minimum: 1,
    maximum: 65535
  }
);

const defaultAppOrigin = (
  `http://localhost:${port}`
);

const appOrigin = readOrigin(
  "APP_ORIGIN",
  {
    defaultValue: defaultAppOrigin,
    requireHttps: isProduction
  }
);

const trustProxyHops = readInteger(
  "TRUST_PROXY_HOPS",
  {
    defaultValue: 0,
    minimum: 0,
    maximum: 10
  }
);

if (isProduction) {
  const hostname = new URL(
    appOrigin
  ).hostname;

  const localHostnames = new Set([
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "[::1]",
    "[::]"
  ]);

  if (localHostnames.has(hostname)) {
    addError(
      "APP_ORIGIN must use the actual public " +
      "HTTPS origin in production."
    );
  }
}

if (trustProxyHops > 0) {
  addWarning(
    "Reverse-proxy trust is enabled. Verify that " +
    "TRUST_PROXY_HOPS matches the actual hosting " +
    "network before deploying."
  );
}


/* ==================================================
   DATABASE
================================================== */

const rawDatabasePath = readText(
  "DATABASE_PATH",
  "database/data/titan.sqlite"
);

let databasePath;

if (rawDatabasePath === ":memory:") {
  databasePath = ":memory:";

  if (!isTest) {
    addError(
      "DATABASE_PATH=:memory: is permitted only " +
      "when NODE_ENV=test."
    );
  }
} else {
  if (
    rawDatabasePath.includes("") ||
    rawDatabasePath.startsWith("file:") ||
    rawDatabasePath.includes("://")
  ) {
    addError(
      "DATABASE_PATH must be a local filesystem " +
      "path, not a URL or SQLite URI."
    );
  }

  databasePath = isAbsolute(
    rawDatabasePath
  )
    ? resolve(rawDatabasePath)
    : resolve(
        PROJECT_ROOT,
        rawDatabasePath
      );
}

const databaseSchemaPath = resolve(
  PROJECT_ROOT,
  "database",
  "schema.sql"
);


/* ==================================================
   SESSION CONFIGURATION
   A real secret is required in every environment.
================================================== */

const sessionSecret = readText(
  "SESSION_SECRET"
);

if (!sessionSecret) {
  addError(
    "SESSION_SECRET is required. Generate an " +
    "independent random secret and store it in .env."
  );
} else {
  const secretByteLength = Buffer.byteLength(
    sessionSecret,
    "utf8"
  );

  if (
    secretByteLength < 32 ||
    secretByteLength > 4096
  ) {
    addError(
      "SESSION_SECRET must contain between " +
      "32 and 4096 bytes."
    );
  }

  if (/[
]/.test(sessionSecret)) {
    addError(
      "SESSION_SECRET must not contain line breaks " +
      "or null characters."
    );
  }

  const obviousPlaceholders = [
    /^(change[-_ ]?me)/i,
    /^(replace[-_ ]?me)/i,
    /^(your[-_ ]?(secret|session))/i,
    /^(example[-_ ]?secret)/i
  ];

  if (
    obviousPlaceholders.some(
      pattern => pattern.test(sessionSecret)
    )
  ) {
    addError(
      "SESSION_SECRET must not use an example " +
      "or placeholder value."
    );
  }
}

const sessionCookieName = readText(
  "SESSION_COOKIE_NAME",
  "titan.sid"
);

if (
  !/^[A-Za-z0-9_.-]{1,80}$/.test(
    sessionCookieName
  )
) {
  addError(
    "SESSION_COOKIE_NAME must contain 1–80 " +
    "letters, numbers, dots, underscores or hyphens."
  );
}

const sessionTtlSeconds = readInteger(
  "SESSION_TTL_SECONDS",
  {
    defaultValue: 60 * 60 * 24 * 7,
    minimum: 60 * 5,
    maximum: 60 * 60 * 24 * 30
  }
);

const sessionCookieSecure = readBoolean(
  "SESSION_COOKIE_SECURE",
  isProduction
);

if (
  isProduction &&
  !sessionCookieSecure
) {
  addError(
    "SESSION_COOKIE_SECURE must be true " +
    "in production."
  );
}

if (
  sessionCookieSecure &&
  new URL(appOrigin).protocol !== "https:"
) {
  addError(
    "APP_ORIGIN must use HTTPS when " +
    "SESSION_COOKIE_SECURE=true."
  );
}

if (
  (
    sessionCookieName.startsWith("__Host-") ||
    sessionCookieName.startsWith("__Secure-")
  ) &&
  !sessionCookieSecure
) {
  addError(
    "Prefixed secure cookie names require " +
    "SESSION_COOKIE_SECURE=true."
  );
}


/* ==================================================
   TMDB
   Fixed approved API base; no browser-side secrets.
================================================== */

const tmdbApiBaseUrl = readOrigin(
  "TMDB_API_BASE_URL",
  {
    defaultValue: "https://api.themoviedb.org",

    allowedOrigins: [
      "https://api.themoviedb.org"
    ],

    requireHttps: true
  }
);

const tmdbReadAccessToken = readCredential(
  "TMDB_READ_ACCESS_TOKEN"
);

const tmdbApiKey = readCredential(
  "TMDB_API_KEY"
);

if (
  tmdbReadAccessToken &&
  tmdbApiKey
) {
  addError(
    "Configure only one TMDB authentication method: " +
    "TMDB_READ_ACCESS_TOKEN or TMDB_API_KEY."
  );
}

if (
  tmdbReadAccessToken &&
  /^Bearer/i.test(tmdbReadAccessToken)
) {
  addError(
    "TMDB_READ_ACCESS_TOKEN must contain the token " +
    "only, without a Bearer prefix."
  );
}

const tmdbEnabled = Boolean(
  tmdbReadAccessToken ||
  tmdbApiKey
);

if (!tmdbEnabled) {
  addWarning(
    "TMDB credentials are not configured. " +
    "TMDB-backed discovery and search will remain " +
    "unavailable until credentials are supplied."
  );
}

const tmdbLanguage = readText(
  "TMDB_LANGUAGE",
  "en-US"
);

if (
  !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(
    tmdbLanguage
  )
) {
  addError(
    "TMDB_LANGUAGE must use a language code " +
    "such as en or en-US."
  );
}

const tmdbRegion = readText(
  "TMDB_REGION"
);

if (
  tmdbRegion &&
  !/^[A-Z]{2}$/.test(tmdbRegion)
) {
  addError(
    "TMDB_REGION must be empty or a two-letter " +
    "uppercase country code."
  );
}

if (
  sessionSecret &&
  (
    sessionSecret === tmdbReadAccessToken ||
    sessionSecret === tmdbApiKey
  )
) {
  addError(
    "SESSION_SECRET must not reuse a TMDB credential."
  );
}


/* ==================================================
   VIDSRC
   This version accepts the supplied official origin.
   Unverified mirrors and custom domains are rejected.
================================================== */

const vidsrcApiOrigin = readOrigin(
  "VIDSRC_API_ORIGIN",
  {
    defaultValue: "https://vidsrc.sh",

    allowedOrigins: [
      "https://vidsrc.sh"
    ],

    requireHttps: true
  }
);

const vidsrcPlayerOrigin = readOrigin(
  "VIDSRC_PLAYER_ORIGIN",
  {
    defaultValue: "https://vidsrc.sh",

    allowedOrigins: [
      "https://vidsrc.sh"
    ],

    requireHttps: true
  }
);

const vidsrcPlaybackEnabled = readBoolean(
  "VIDSRC_PLAYBACK_ENABLED",
  false
);

if (vidsrcPlaybackEnabled) {
  addWarning(
    "External playback is enabled in configuration. " +
    "This setting does not establish content rights " +
    "or confirm provider availability."
  );
}


/* ==================================================
   PROVIDER REQUEST LIMITS AND CACHE
================================================== */

const providerRequestTimeoutMs = readInteger(
  "PROVIDER_REQUEST_TIMEOUT_MS",
  {
    defaultValue: 12000,
    minimum: 1000,
    maximum: 60000
  }
);

const tmdbCacheTtlMs = readInteger(
  "TMDB_CACHE_TTL_MS",
  {
    defaultValue: 5 * 60 * 1000,
    minimum: 0,
    maximum: 24 * 60 * 60 * 1000
  }
);

const vidsrcCacheTtlMs = readInteger(
  "VIDSRC_CACHE_TTL_MS",
  {
    defaultValue: 5 * 60 * 1000,
    minimum: 0,
    maximum: 24 * 60 * 60 * 1000
  }
);


/* ==================================================
   REQUEST RATE LIMITS
================================================== */

const apiRateLimitWindowMs = readInteger(
  "API_RATE_LIMIT_WINDOW_MS",
  {
    defaultValue: 15 * 60 * 1000,
    minimum: 1000,
    maximum: 24 * 60 * 60 * 1000
  }
);

const apiRateLimitMax = readInteger(
  "API_RATE_LIMIT_MAX",
  {
    defaultValue: 300,
    minimum: 1,
    maximum: 100000
  }
);

const authRateLimitWindowMs = readInteger(
  "AUTH_RATE_LIMIT_WINDOW_MS",
  {
    defaultValue: 15 * 60 * 1000,
    minimum: 1000,
    maximum: 24 * 60 * 60 * 1000
  }
);

const authRateLimitMax = readInteger(
  "AUTH_RATE_LIMIT_MAX",
  {
    defaultValue: 20,
    minimum: 1,
    maximum: 10000
  }
);


/* ==================================================
   FAIL BEFORE STARTUP ON INVALID CONFIGURATION
================================================== */

if (configurationErrors.length > 0) {
  throw new ConfigurationError(
    configurationErrors
  );
}


/* ==================================================
   IMMUTABLE SERVER CONFIGURATION
   Do not serialize this object to the frontend.
================================================== */

function deepFreeze(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Object.isFrozen(value)
  ) {
    return value;
  }

  Object.values(value).forEach(
    nested => deepFreeze(nested)
  );

  return Object.freeze(value);
}


export const config = deepFreeze({
  app: {
    name: "TITAN",
    environment: nodeEnvironment,
    isProduction,
    isTest,
    host,
    port,
    origin: appOrigin,
    trustProxyHops,

    publicDirectory: resolve(
      PROJECT_ROOT,
      "public"
    )
  },

  database: {
    path: databasePath,
    schemaPath: databaseSchemaPath
  },

  session: {
    secret: sessionSecret,
    cookieName: sessionCookieName,

    ttlSeconds: sessionTtlSeconds,
    ttlMs: sessionTtlSeconds * 1000,

    cookie: {
      httpOnly: true,
      secure: sessionCookieSecure,
      sameSite: "lax",
      path: "/",
      maxAge: sessionTtlSeconds * 1000
    }
  },

  providers: {
    timeoutMs: providerRequestTimeoutMs,

    tmdb: {
      enabled: tmdbEnabled,

      apiBaseUrl: tmdbApiBaseUrl,

      apiVersion: "3",

      readAccessToken: tmdbReadAccessToken,
      apiKey: tmdbApiKey,

      language: tmdbLanguage,
      region: tmdbRegion,

      cacheTtlMs: tmdbCacheTtlMs
    },

    vidsrc: {
      apiOrigin: vidsrcApiOrigin,
      playerOrigin: vidsrcPlayerOrigin,

      playbackEnabled: vidsrcPlaybackEnabled,

      cacheTtlMs: vidsrcCacheTtlMs
    }
  },

  rateLimits: {
    api: {
      windowMs: apiRateLimitWindowMs,
      max: apiRateLimitMax
    },

    auth: {
      windowMs: authRateLimitWindowMs,
      max: authRateLimitMax
    }
  }
});


/* ==================================================
   SAFE STARTUP WARNINGS
   Contains no credential values.
================================================== */

export const configurationWarnings = Object.freeze([
  ...warningMessages
]);


/* ==================================================
   EXPLICIT PUBLIC CONFIGURATION
   Only this safe subset may be returned to the browser.
================================================== */

export function getPublicConfig() {
  return {
    appName: config.app.name,

    metadata: {
      provider: "TMDB",
      configured: config.providers.tmdb.enabled,
      language: config.providers.tmdb.language,
      region: config.providers.tmdb.region
    },

    playback: {
      provider: "VidSrc",

      enabled:
        config.providers.vidsrc.playbackEnabled,

      origin:
        config.providers.vidsrc.playerOrigin
    }
  };
  }
