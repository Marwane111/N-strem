import {
  config
} from "../config.js";


/* ==================================================
   VIDSRC SERVICE
   Server-side API access and embed URL construction.

   This module does not:
   - download or proxy video streams;
   - bypass provider restrictions;
   - configure DNS or custom domains;
   - establish content licensing;
   - claim that a generated URL will play successfully.
================================================== */

const settings = config.providers.vidsrc;

const REQUEST_TIMEOUT_MS =
  config.providers.timeoutMs;

const MAX_CACHE_ENTRIES = 300;

const MAX_PENDING_REQUESTS = 60;

const MAX_JSON_BYTES =
  4 * 1024 * 1024;

const MAX_ID_LIST_BYTES =
  32 * 1024 * 1024;

const cache = new Map();

const pendingRequests = new Map();


const ID_LIST_FILES = Object.freeze({
  movie_imdb: "movie_imdb.txt",
  movie_tmdb: "movie_tmdb.txt",

  tv_imdb: "tv_imdb.txt",
  tv_tmdb: "tv_tmdb.txt",

  episodes_imdb: "eps_imdb.txt",
  episodes_tmdb: "eps_tmdb.txt"
});


/* ==================================================
   ERRORS
================================================== */

export class VidsrcServiceError extends Error {
  constructor(
    message,
    {
      code = "VIDSRC_SERVICE_ERROR",
      status = 502,
      upstreamStatus = null,
      retryAfterSeconds = null
    } = {}
  ) {
    super(message);

    this.name = "VidsrcServiceError";

    this.code = code;

    this.status = status;

    this.upstreamStatus = upstreamStatus;

    this.retryAfterSeconds =
      retryAfterSeconds;
  }
}


function invalidInput(message) {
  return new VidsrcServiceError(
    message,
    {
      code: "INVALID_INPUT",
      status: 400
    }
  );
}


function invalidResponse(message) {
  return new VidsrcServiceError(
    message,
    {
      code: "VIDSRC_INVALID_RESPONSE",
      status: 502
    }
  );
}


/* ==================================================
   VALIDATION
================================================== */

function isRecord(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}


function assertOptions(options) {
  if (!isRecord(options)) {
    throw invalidInput(
      "Request options must be an object."
    );
  }

  return options;
}


function readFresh(options) {
  if (
    options.fresh !== undefined &&
    typeof options.fresh !== "boolean"
  ) {
    throw invalidInput(
      "fresh must be a boolean."
    );
  }

  return options.fresh === true;
}


function readBoolean(
  value,
  name,
  defaultValue = false
) {
  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value !== "boolean") {
    throw invalidInput(
      `${name} must be a boolean.`
    );
  }

  return value;
}


function readInteger(
  value,
  name,
  {
    minimum = 1,
    maximum = Number.MAX_SAFE_INTEGER,
    defaultValue
  } = {}
) {
  if (
    value === undefined &&
    defaultValue !== undefined
  ) {
    return defaultValue;
  }

  const validType = (
    typeof value === "number" ||
    (
      typeof value === "string" &&
      /^d+$/.test(value)
    )
  );

  if (!validType) {
    throw invalidInput(
      `${name} must be a whole number.`
    );
  }

  const number = Number(value);

  if (
    !Number.isSafeInteger(number) ||
    number < minimum ||
    number > maximum
  ) {
    throw invalidInput(
      `${name} must be between ` +
      `${minimum} and ${maximum}.`
    );
  }

  return number;
}


function readMediaType(value) {
  if (
    value !== "movie" &&
    value !== "tv"
  ) {
    throw invalidInput(
      'mediaType must be "movie" or "tv".'
    );
  }

  return value;
}


function readIdentifier(value) {
  if (
    typeof value !== "string" &&
    typeof value !== "number"
  ) {
    throw invalidInput(
      "A valid IMDb or TMDB identifier is required."
    );
  }

  if (
    typeof value === "number" &&
    (
      !Number.isSafeInteger(value) ||
      value < 1
    )
  ) {
    throw invalidInput(
      "Numeric TMDB IDs must be positive safe integers."
    );
  }

  const identifier = String(value);

  const imdb = /^ttd{5,12}$/.test(
    identifier
  );

  const tmdb = /^[1-9]d{0,15}$/.test(
    identifier
  );

  if (
    !imdb &&
    !(
      tmdb &&
      Number.isSafeInteger(
        Number(identifier)
      )
    )
  ) {
    throw invalidInput(
      "The identifier must be an IMDb title ID " +
      "or a positive numeric TMDB ID."
    );
  }

  return {
    value: identifier,
    source: imdb ? "imdb" : "tmdb"
  };
}


function optionalIdentifier(
  value,
  source
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  try {
    const identifier = readIdentifier(
      value
    );

    return identifier.source === source
      ? identifier.value
      : null;
  } catch {
    return null;
  }
}


function readEpisodeSelection(options) {
  const hasSeason = (
    options.season !== undefined &&
    options.season !== null
  );

  const hasEpisode = (
    options.episode !== undefined &&
    options.episode !== null
  );

  if (hasSeason !== hasEpisode) {
    throw invalidInput(
      "season and episode must be supplied together."
    );
  }

  if (!hasSeason) {
    return {
      season: null,
      episode: null
    };
  }

  return {
    season: readInteger(
      options.season,
      "season",
      {
        minimum: 0,
        maximum: 10000
      }
    ),

    episode: readInteger(
      options.episode,
      "episode",
      {
        minimum: 1,
        maximum: 100000
      }
    )
  };
}


function readSubtitleLanguages(
  value = "en"
) {
  if (typeof value !== "string") {
    throw invalidInput(
      "subtitleLanguages must be a string."
    );
  }

  const languages = value
    .split(",")
    .map(language => language.trim());

  if (
    languages.length < 1 ||
    languages.length > 3 ||
    !languages.every(
      language =>
        /^[a-z]{2,3}$/.test(language)
    )
  ) {
    throw invalidInput(
      "Provide up to three lowercase subtitle " +
      "language codes, separated by commas."
    );
  }

  return [
    ...new Set(languages)
  ].join(",");
}


function readStartAt(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > Number.MAX_SAFE_INTEGER
  ) {
    throw invalidInput(
      "startAt must be a finite, non-negative " +
      "number of seconds."
    );
  }

  return value;
}


function readCustomSubtitle(options) {
  const suppliedURL = options.subtitleUrl;

  if (
    suppliedURL === undefined ||
    suppliedURL === null ||
    suppliedURL === ""
  ) {
    if (
      options.subtitleLabel !== undefined ||
      options.subtitleLanguage !== undefined
    ) {
      throw invalidInput(
        "subtitleUrl is required when supplying " +
        "a custom subtitle label or language."
      );
    }

    return null;
  }

  if (
    typeof suppliedURL !== "string" ||
    suppliedURL.length > 4096
  ) {
    throw invalidInput(
      "subtitleUrl must be an HTTPS URL " +
      "no longer than 4096 characters."
    );
  }

  let url;

  try {
    url = new URL(suppliedURL);
  } catch {
    throw invalidInput(
      "subtitleUrl must be a valid HTTPS URL."
    );
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw invalidInput(
      "subtitleUrl must use HTTPS without " +
      "credentials or a fragment."
    );
  }

  const label = options.subtitleLabel === undefined
    ? "Custom subtitles"
    : options.subtitleLabel;

  if (
    typeof label !== "string" ||
    label.trim().length < 1 ||
    label.length > 80 ||
    /[-\u001F]/.test(label)
  ) {
    throw invalidInput(
      "subtitleLabel must contain 1–80 " +
      "characters without control characters."
    );
  }

  const language =
    options.subtitleLanguage === undefined
      ? "en"
      : options.subtitleLanguage;

  if (
    typeof language !== "string" ||
    !/^[a-z]{2,3}$/.test(language)
  ) {
    throw invalidInput(
      "subtitleLanguage must be one lowercase " +
      "two- or three-letter language code."
    );
  }

  /*
    This service passes the subtitle URL to the player.
    It never fetches the remote subtitle on the server.
  */

  return {
    url: url.href,
    label: label.trim(),
    language
  };
}


/* ==================================================
   SAFE VALUE NORMALIZATION
================================================== */

function nullableText(
  value,
  maximumLength = 500
) {
  return typeof value === "string"
    ? value.slice(0, maximumLength)
    : null;
}


function nullableInteger(
  value,
  minimum = 0
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  if (
    typeof value !== "string" &&
    typeof value !== "number"
  ) {
    return null;
  }

  if (
    typeof value === "string" &&
    !/^d+$/.test(value)
  ) {
    return null;
  }

  const number = Number(value);

  return (
    Number.isSafeInteger(number) &&
    number >= minimum
  )
    ? number
    : null;
}


function nullableRating(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  if (
    typeof value !== "number" &&
    typeof value !== "string"
  ) {
    return null;
  }

  if (
    typeof value === "string" &&
    value.trim() === ""
  ) {
    return null;
  }

  const rating = Number(value);

  return (
    Number.isFinite(rating) &&
    rating >= 0 &&
    rating <= 10
  )
    ? rating
    : null;
}


function safePoster(value) {
  if (
    typeof value !== "string" ||
    value.length > 2048
  ) {
    return null;
  }

  try {
    const url = new URL(value);

    if (
      url.origin !== "https://image.tmdb.org" ||
      url.username ||
      url.password ||
      url.hash
    ) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}


function normalizeSeasons(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isRecord)
    .map(season => ({
      season: nullableInteger(
        season.season,
        0
      ),

      episodes: nullableInteger(
        season.episodes,
        0
      ),

      first_episode: nullableInteger(
        season.first_episode,
        1
      ),

      last_episode: nullableInteger(
        season.last_episode,
        1
      ),

      quality: nullableText(
        season.quality,
        40
      )
    }))
    .filter(season => (
      season.season !== null
    ));
}


function normalizeContent(
  data,
  mediaType,
  selection = {
    season: null,
    episode: null
  }
) {
  if (!isRecord(data)) {
    throw invalidResponse(
      "VidSrc returned invalid content information."
    );
  }

  const imdbId = optionalIdentifier(
    data.imdb_id,
    "imdb"
  );

  const tmdbId = optionalIdentifier(
    data.tmdb_id,
    "tmdb"
  );

  if (
    !imdbId &&
    !tmdbId
  ) {
    throw invalidResponse(
      "VidSrc content information did not contain " +
      "a recognized title identifier."
    );
  }

  const isEpisode =
    selection.season !== null;

  if (isEpisode) {
    const returnedSeason = nullableInteger(
      data.season,
      0
    );

    const returnedEpisode = nullableInteger(
      data.episode,
      1
    );

    if (
      returnedSeason !== selection.season ||
      returnedEpisode !== selection.episode
    ) {
      throw invalidResponse(
        "VidSrc returned information for a " +
        "different or unspecified episode."
      );
    }
  }

  const expectedType = isEpisode
    ? "episode"
    : mediaType;

  if (
    data.type !== undefined &&
    data.type !== expectedType
  ) {
    throw invalidResponse(
      "VidSrc returned a conflicting content type."
    );
  }

  return {
    media_type: mediaType,

    content_type: expectedType,

    imdb_id: imdbId,

    tmdb_id: tmdbId,

    title: nullableText(
      isEpisode
        ? data.show_title
        : data.title
    ),

    year: nullableInteger(
      data.year,
      1
    ),

    quality: nullableText(
      data.quality,
      40
    ),

    poster: safePoster(
      data.poster
    ),

    imdb_rating: nullableRating(
      data.imdb_rating
    ),

    season: selection.season,

    episode: selection.episode,

    seasons: mediaType === "tv" && !isEpisode
      ? normalizeSeasons(data.seasons)
      : [],

    total_episodes:
      mediaType === "tv" && !isEpisode
        ? nullableInteger(
            data.total_episodes,
            0
          )
        : null,

    /*
      Preserve the provider timestamp as text.
      Do not reinterpret an unspecified timezone.
    */

    time_added: nullableText(
      data.time_added,
      100
    )
  };
}


/* ==================================================
   CACHE
================================================== */

function readCache(key) {
  const entry = cache.get(key);

  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  cache.delete(key);
  cache.set(key, entry);

  return entry.value;
}


function writeCache(key, value) {
  if (settings.cacheTtlMs <= 0) {
    return;
  }

  const now = Date.now();

  for (const [entryKey, entry] of cache) {
    if (entry.expiresAt <= now) {
      cache.delete(entryKey);
    }
  }

  cache.delete(key);

  while (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey =
      cache.keys().next().value;

    cache.delete(oldestKey);
  }

  cache.set(
    key,
    {
      value,

      expiresAt:
        now + settings.cacheTtlMs
    }
  );
}


export function clearVidsrcCache() {
  cache.clear();
}


/* ==================================================
   HTTP HELPERS
================================================== */

function parseRetryAfter(value) {
  if (!value) {
    return null;
  }

  if (/^d+$/.test(value)) {
    return Math.min(
      Number(value),
      86400
    );
  }

  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return Math.min(
    86400,

    Math.max(
      0,

      Math.ceil(
        (timestamp - Date.now()) / 1000
      )
    )
  );
}


function upstreamError(response) {
  if (response.status === 429) {
    return new VidsrcServiceError(
      "VidSrc is temporarily limiting requests.",
      {
        code: "VIDSRC_RATE_LIMITED",
        status: 503,
        upstreamStatus: response.status,

        retryAfterSeconds:
          parseRetryAfter(
            response.headers.get(
              "retry-after"
            )
          )
      }
    );
  }

  if (
    response.status === 401 ||
    response.status === 403
  ) {
    return new VidsrcServiceError(
      "VidSrc denied the server request.",
      {
        code: "VIDSRC_ACCESS_DENIED",
        status: 503,
        upstreamStatus: response.status
      }
    );
  }

  return new VidsrcServiceError(
    "VidSrc could not complete the request.",
    {
      code: "VIDSRC_UPSTREAM_ERROR",
      status: 502,
      upstreamStatus: response.status
    }
  );
}


async function readLimitedText(
  response,
  maximumBytes
) {
  const declaredLength = Number(
    response.headers.get(
      "content-length"
    )
  );

  if (
    Number.isFinite(declaredLength) &&
    declaredLength > maximumBytes
  ) {
    await response.body?.cancel();

    throw new VidsrcServiceError(
      "The provider response exceeds " +
      "the supported size limit.",
      {
        code: "VIDSRC_RESPONSE_TOO_LARGE"
      }
    );
  }

  if (!response.body) {
    throw invalidResponse(
      "VidSrc returned an empty response."
    );
  }

  const reader =
    response.body.getReader();

  const chunks = [];

  let totalBytes = 0;

  try {
    while (true) {
      const {
        done,
        value
      } = await reader.read();

      if (done) {
        break;
      }

      totalBytes += value.byteLength;

      if (totalBytes > maximumBytes) {
        await reader.cancel();

        throw new VidsrcServiceError(
          "The provider response exceeds " +
          "the supported size limit.",
          {
            code: "VIDSRC_RESPONSE_TOO_LARGE"
          }
        );
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(
    totalBytes
  );

  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(
    bytes
  );
}


async function executeJSONRequest(path) {
  const controller =
    new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS
  );

  try {
    const url = new URL(
      path,
      settings.apiOrigin
    );

    const response = await fetch(
      url,
      {
        method: "GET",

        headers: {
          Accept: "application/json"
        },

        signal: controller.signal,

        /*
          Do not automatically follow mirrors,
          challenge pages or other redirects.
        */

        redirect: "error"
      }
    );

    if (
      !response.ok &&
      response.status !== 404
    ) {
      await response.body?.cancel();

      throw upstreamError(response);
    }

    const text = await readLimitedText(
      response,
      MAX_JSON_BYTES
    );

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      throw invalidResponse(
        "VidSrc returned non-JSON content."
      );
    }

    if (!isRecord(data)) {
      throw invalidResponse(
        "VidSrc returned an unexpected JSON structure."
      );
    }

    return {
      status: response.status,

      data,

      checkedAt:
        new Date().toISOString()
    };
  } catch (error) {
    if (error instanceof VidsrcServiceError) {
      throw error;
    }

    if (controller.signal.aborted) {
      throw new VidsrcServiceError(
        "The VidSrc request timed out.",
        {
          code: "VIDSRC_TIMEOUT",
          status: 504
        }
      );
    }

    throw new VidsrcServiceError(
      "The server could not reach VidSrc.",
      {
        code: "VIDSRC_NETWORK_ERROR",
        status: 502
      }
    );
  } finally {
    clearTimeout(timeout);
  }
}


async function requestJSON(
  path,
  {
    fresh = false
  } = {}
) {
  /*
    Endpoint paths are constructed internally.
    No arbitrary URL or path is accepted from callers.
  */

  if (
    !/^/[A-Za-z0-9/_-]+.json$/.test(path) ||
    path.includes("..")
  ) {
    throw invalidInput(
      "Invalid internal VidSrc endpoint."
    );
  }

  if (!fresh) {
    const cached = readCache(path);

    if (cached !== null) {
      return structuredClone(cached);
    }
  }

  const existing =
    pendingRequests.get(path);

  if (existing) {
    return structuredClone(
      await existing
    );
  }

  if (
    pendingRequests.size >=
    MAX_PENDING_REQUESTS
  ) {
    throw new VidsrcServiceError(
      "The availability service is busy. " +
      "Please retry shortly.",
      {
        code: "VIDSRC_SERVICE_BUSY",
        status: 503,
        retryAfterSeconds: 2
      }
    );
  }

  const operation =
    executeJSONRequest(path).then(
      result => {
        writeCache(path, result);
        return result;
      }
    );

  pendingRequests.set(
    path,
    operation
  );

  try {
    return structuredClone(
      await operation
    );
  } finally {
    if (
      pendingRequests.get(path) ===
      operation
    ) {
      pendingRequests.delete(path);
    }
  }
}


/* ==================================================
   INFORMATION AND AVAILABILITY
================================================== */

export async function getContentInfo(
  mediaType,
  id,
  options = {}
) {
  assertOptions(options);

  const type = readMediaType(
    mediaType
  );

  const identifier = readIdentifi
