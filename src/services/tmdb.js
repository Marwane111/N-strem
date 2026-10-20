import {
  config
} from "../config.js";


/* ==================================================
   TMDB SERVICE
   Server-side only.

   Credentials must never be sent to the browser.
   Requests use only the approved origin in config.js.
================================================== */

const settings = config.providers.tmdb;

const REQUEST_TIMEOUT_MS =
  config.providers.timeoutMs;

const MAX_CACHE_ENTRIES = 400;

const MAX_PENDING_REQUESTS = 80;

const MAX_RESPONSE_BYTES =
  8 * 1024 * 1024;

const cache = new Map();

const pendingRequests = new Map();


/* ==================================================
   SERVICE ERROR
   Messages are deliberately safe for application logs.
   Do not attach request URLs or credentials.
================================================== */

export class TmdbServiceError extends Error {
  constructor(
    message,
    {
      code = "TMDB_SERVICE_ERROR",
      status = 502,
      upstreamStatus = null,
      retryAfterSeconds = null
    } = {}
  ) {
    super(message);

    this.name = "TmdbServiceError";

    this.code = code;

    this.status = status;

    this.upstreamStatus = upstreamStatus;

    this.retryAfterSeconds =
      retryAfterSeconds;
  }
}


/* ==================================================
   VALIDATION HELPERS
================================================== */

function isRecord(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}


function validationError(message) {
  return new TmdbServiceError(
    message,
    {
      code: "INVALID_INPUT",
      status: 400
    }
  );
}


function assertOptions(options) {
  if (!isRecord(options)) {
    throw validationError(
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
    throw validationError(
      "fresh must be a boolean."
    );
  }

  return options.fresh === true;
}


function positiveInteger(
  value,
  name,
  {
    defaultValue,
    minimum = 1,
    maximum = Number.MAX_SAFE_INTEGER
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
    throw validationError(
      `${name} must be a whole number.`
    );
  }

  const parsed = Number(value);

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw validationError(
      `${name} must be between ` +
      `${minimum} and ${maximum}.`
    );
  }

  return parsed;
}


function readPage(value) {
  return positiveInteger(
    value,
    "page",
    {
      defaultValue: 1,
      minimum: 1,
      maximum: 500
    }
  );
}


function readId(value, name = "id") {
  return positiveInteger(
    value,
    name,
    {
      minimum: 1
    }
  );
}


function readSeasonNumber(value) {
  return positiveInteger(
    value,
    "seasonNumber",
    {
      minimum: 0,
      maximum: 10000
    }
  );
}


function readEpisodeNumber(value) {
  return positiveInteger(
    value,
    "episodeNumber",
    {
      minimum: 1,
      maximum: 100000
    }
  );
}


function readMediaType(value) {
  if (
    value !== "movie" &&
    value !== "tv"
  ) {
    throw validationError(
      'mediaType must be "movie" or "tv".'
    );
  }

  return value;
}


function readTimeWindow(value = "week") {
  if (
    value !== "day" &&
    value !== "week"
  ) {
    throw validationError(
      'timeWindow must be "day" or "week".'
    );
  }

  return value;
}


function readLanguage(value) {
  const language = value === undefined
    ? settings.language
    : value;

  if (
    typeof language !== "string" ||
    !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(
      language
    )
  ) {
    throw validationError(
      "language must be a supported-format " +
      "language code such as en-US."
    );
  }

  return language;
}


function readRegion(value) {
  const region = value === undefined
    ? settings.region
    : value;

  if (region === "") {
    return "";
  }

  if (
    typeof region !== "string" ||
    !/^[A-Z]{2}$/.test(region)
  ) {
    throw validationError(
      "region must be empty or a two-letter " +
      "uppercase country code."
    );
  }

  return region;
}


function readQuery(value) {
  if (typeof value !== "string") {
    throw validationError(
      "query must be a string."
    );
  }

  const query = value.trim();

  if (
    query.length < 1 ||
    query.length > 200 ||
    /[-\u001F]/.test(query)
  ) {
    throw validationError(
      "query must contain 1–200 characters " +
      "without control characters."
    );
  }

  return query;
}


function optionalYear(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return undefined;
  }

  return positiveInteger(
    value,
    "year",
    {
      minimum: 1800,
      maximum: 9999
    }
  );
}


function optionalOriginalLanguage(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return undefined;
  }

  if (
    typeof value !== "string" ||
    !/^[a-z]{2}$/.test(value)
  ) {
    throw validationError(
      "originalLanguage must be a two-letter " +
      "lowercase language code."
    );
  }

  return value;
}


function optionalGenres(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return undefined;
  }

  const values = Array.isArray(value)
    ? value
    : (
        typeof value === "string"
          ? value.split(",")
          : [value]
      );

  if (
    values.length === 0 ||
    values.length > 10
  ) {
    throw validationError(
      "Provide between 1 and 10 genre IDs."
    );
  }

  const ids = values.map(
    genreId => readId(
      genreId,
      "genreId"
    )
  );

  return [
    ...new Set(ids)
  ].join(",");
}


function optionalMinimumRating(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return undefined;
  }

  if (
    typeof value !== "number" &&
    typeof value !== "string"
  ) {
    throw validationError(
      "minimumRating must be a number."
    );
  }

  if (
    typeof value === "string" &&
    value.trim() === ""
  ) {
    throw validationError(
      "minimumRating must not be whitespace."
    );
  }

  const rating = Number(value);

  if (
    !Number.isFinite(rating) ||
    rating < 0 ||
    rating > 10
  ) {
    throw validationError(
      "minimumRating must be between 0 and 10."
    );
  }

  return rating;
}


/* ==================================================
   CACHE
   No persistent credentials or API responses are
   written to disk by this service.
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

  /*
    Reinsert for a small least-recently-used cache.
  */

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


export function clearTmdbCache() {
  cache.clear();
}


/* ==================================================
   RESPONSE HELPERS
================================================== */

function cloneJSON(value) {
  return structuredClone(value);
}


function retryAfterSeconds(value) {
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


function errorForHttpResponse(response) {
  const upstreamStatus = response.status;

  if (
    upstreamStatus === 401 ||
    upstreamStatus === 403
  ) {
    return new TmdbServiceError(
      "TMDB rejected the server credentials " +
      "or denied this request.",
      {
        code: "TMDB_AUTHENTICATION_FAILED",
        status: 503,
        upstreamStatus
      }
    );
  }

  if (upstreamStatus === 404) {
    return new TmdbServiceError(
      "The requested TMDB resource was not found.",
      {
        code: "TMDB_NOT_FOUND",
        status: 404,
        upstreamStatus
      }
    );
  }

  if (upstreamStatus === 429) {
    return new TmdbServiceError(
      "TMDB is temporarily limiting requests.",
      {
        code: "TMDB_RATE_LIMITED",
        status: 503,
        upstreamStatus,

        retryAfterSeconds:
          retryAfterSeconds(
            response.headers.get(
              "retry-after"
            )
          )
      }
    );
  }

  return new TmdbServiceError(
    "TMDB could not complete the request.",
    {
      code: "TMDB_UPSTREAM_ERROR",
      status: 502,
      upstreamStatus
    }
  );
}


async function readJSONResponse(response) {
  const declaredLength = Number(
    response.headers.get(
      "content-length"
    )
  );

  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_RESPONSE_BYTES
  ) {
    await response.body?.cancel();

    throw new TmdbServiceError(
      "TMDB returned a response larger " +
      "than the supported limit.",
      {
        code: "TMDB_RESPONSE_TOO_LARGE"
      }
    );
  }

  if (!response.body) {
    throw new TmdbServiceError(
      "TMDB returned an empty response.",
      {
        code: "TMDB_INVALID_RESPONSE"
      }
    );
  }

  const reader = response.body.getReader();

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

      if (
        totalBytes > MAX_RESPONSE_BYTES
      ) {
        await reader.cancel();

        throw new TmdbServiceError(
          "TMDB returned a response larger " +
          "than the supported limit.",
          {
            code: "TMDB_RESPONSE_TOO_LARGE"
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

  const text = new TextDecoder().decode(
    bytes
  );

  try {
    const data = JSON.parse(text);

    if (!isRecord(data)) {
      throw new Error(
        "Expected a JSON object."
      );
    }

    return data;
  } catch {
    throw new TmdbServiceError(
      "TMDB returned an invalid JSON response.",
      {
        code: "TMDB_INVALID_RESPONSE"
      }
    );
  }
}


/* ==================================================
   PRIVATE REQUEST CLIENT
   Not exported: callers cannot supply arbitrary URLs.
================================================== */

function assertConfigured() {
  if (!settings.enabled) {
    throw new TmdbServiceError(
      "TMDB is not configured on the server.",
      {
        code: "TMDB_NOT_CONFIGURED",
        status: 503
      }
    );
  }
}


function buildRequestURL(path, parameters) {
  if (
    typeof path !== "string" ||
    !/^/[a-zA-Z0-9/_-]+$/.test(path) ||
    path.includes("..")
  ) {
    throw validationError(
      "Invalid internal TMDB endpoint."
    );
  }

  const url = new URL(
    "/" +
    settings.apiVersion +
    path,

    settings.apiBaseUrl
  );

  for (
    const [name, value] of
    Object.entries(parameters)
  ) {
    if (
      value === undefined ||
      value === null ||
      value === ""
    ) {
      continue;
    }

    url.searchParams.set(
      name,
      String(value)
    );
  }

  url.searchParams.sort();

  return url;
}


async function executeRequest(
  baseURL
) {
  const controller =
    new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS
  );

  try {
    const url = new URL(baseURL);

    const headers = {
      Accept: "application/json"
    };

    if (settings.readAccessToken) {
      headers.Authorization =
        "Bearer " +
        settings.readAccessToken;
    } else {
      url.searchParams.set(
        "api_key",
        settings.apiKey
      );
    }

    const response = await fetch(
      url,
      {
        method: "GET",
        headers,

        signal: controller.signal,

        /*
          Never forward credentials to a redirect.
        */

        redirect: "error"
      }
    );

    if (!response.ok) {
      await response.body?.cancel();

      throw errorForHttpResponse(
        response
      );
    }

    const data = await readJSONResponse(
      response
    );

    if (data.success === false) {
      throw new TmdbServiceError(
        "TMDB reported that the request failed.",
        {
          code: "TMDB_UPSTREAM_ERROR",
          status: 502,
          upstreamStatus: response.status
        }
      );
    }

    return data;
  } catch (error) {
    if (error instanceof TmdbServiceError) {
      throw error;
    }

    if (controller.signal.aborted) {
      throw new TmdbServiceError(
        "The TMDB request timed out.",
        {
          code: "TMDB_TIMEOUT",
          status: 504
        }
      );
    }

    /*
      Do not expose the original network error:
      it may contain a URL with an API-key query.
    */

    throw new TmdbServiceError(
      "The server could not reach TMDB.",
      {
        code: "TMDB_NETWORK_ERROR",
        status: 502
      }
    );
  } finally {
    clearTimeout(timeout);
  }
}


async function request(
  path,
  parameters = {},
  {
    fresh = false
  } = {}
) {
  assertConfigured();

  const url = buildRequestURL(
    path,
    parameters
  );

  /*
    This cache key is generated before adding
    the API-key query parameter.
  */

  const cacheKey = url.href;

  if (!fresh) {
    const cached = readCache(
      cacheKey
    );

    if (cached !== null) {
      return cloneJSON(cached);
    }
  }

  const existingRequest =
    pendingRequests.get(cacheKey);

  if (existingRequest) {
    return cloneJSON(
      await existingRequest
    );
  }

  if (
    pendingRequests.size >=
    MAX_PENDING_REQUESTS
  ) {
    throw new TmdbServiceError(
      "The metadata service is busy. " +
      "Please retry shortly.",
      {
        code: "TMDB_SERVICE_BUSY",
        status: 503,
        retryAfterSeconds: 2
      }
    );
  }

  const operation = executeRequest(
    url
  ).then(data => {
    writeCache(cacheKey, data);
    return data;
  });

  pendingRequests.set(
    cacheKey,
    operation
  );

  try {
    return cloneJSON(
      await operation
    );
  } finally {
    if (
      pendingRequests.get(cacheKey) ===
      operation
    ) {
      pendingRequests.delete(cacheKey);
    }
  }
}


/* ==================================================
   RESPONSE VALIDATION
================================================== */

function requireObjectWithId(
  data,
  resourceName
) {
  if (
    !isRecord(data) ||
    !Number.isSafeInteger(data.id) ||
    data.id < 1
  ) {
    throw new TmdbServiceError(
      `TMDB returned invalid ${resourceName} data.`,
      {
        code: "TMDB_INVALID_RESPONSE"
      }
    );
  }

  return data;
}


function requireResults(data) {
  if (
    !isRecord(data) ||
    !Array.isArray(data.results)
  ) {
    throw new TmdbServiceError(
      "TMDB returned an invalid results list.",
      {
        code: "TMDB_INVALID_RESPONSE"
      }
    );
  }

  return data;
}


function contentList(
  data,
  fixedMediaType = null
) {
  requireResults(data);

  const results = data.results
    .filter(item => {
      if (
        !isRecord(item) ||
        !Number.isSafeInteger(item.id) ||
        item.id < 1 ||
        item.adult === true
      ) {
        return false;
      }

      const mediaType =
        fixedMediaType ||
        item.media_type;

      return (
        mediaType === "movie" ||
        mediaType === "tv"
      );
    })
    .map(item => ({
      ...item,

      media_type:
        fixedMediaType ||
        item.media_type
    }));

  return {
    ...data,
    results,

    /*
      TMDB totals describe upstream pagination.
      They are not rewritten after local filtering.
    */

    returned_results: results.length
  };
}


function titleDetails(
  data,
  mediaType
) {
  requireObjectWithId(
    data,
    "title"
  );

  if (data.adult === true) {
    throw new TmdbServiceError(
      "This title is outside the supported catalogue.",
      {
        code: "TMDB_TITLE_EXCLUDED",
        status: 404
      }
    );
  }

  return {
    ...data,
    media_type: mediaType
  };
}


/* ==================================================
   PROVIDER STATUS
   This reports configuration, not live availability.
================================================== */

export function getTmdbConfigurationStatus() {
  return {
    configured: settings.enabled,
    provider: "TMDB",
    language: settings.language,
    region: settings.region
  };
}


/* ==================================================
   TRENDING
================================================== */

export async function getTrending(
  options = {}
) {
  assertOptions(options);

  const mediaType =
    options.mediaType === undefined
      ? "all"
      : options.mediaType;

  if (
    !["all", "movie", "tv"].includes(
      mediaType
    )
  ) {
    throw validationError(
      'mediaType must be "all", "movie" or "tv".'
    );
  }

  const timeWindow = readTimeWindow(
    options.timeWindow
  );

  const data = await request(
    `/trending/${mediaType}/${timeWindow}`,

    {
      language: readLanguage(
        options.language
      ),

      page: readPage(
        options.page
      )
    },

    {
      fresh: readFresh(options)
    }
  );

  return contentList(
    data,

    mediaType === "all"
      ? null
      : mediaType
  );
}


/* ==================================================
   MOVIE AND TV LISTS
================================================== */

export async function getPopular(
  mediaType,
  options = {}
) {
  assertOptions(options);

  const type = readMediaType(
    mediaType
  );

  const parameters = {
    language: readLanguage(
      options.language
    ),

    page: readPage(
      options.page
    )
  };

  if (type === "movie") {
    parameters.region = readRegion(
      options.region
    );
  }

  const data = await request(
    `/${type}/popular`,
    parameters,
    {
      fresh: readFresh(options)
    }
  );

  return contentList(data, type);
}


export async function getTopRated(
  mediaType,
  options = {}
) {
  assertOptions(options);

  const type = readMediaType(
    mediaType
  );

  const parameters = {
    language: readLanguage(
      options.language
    ),

    page: readPage(
      options.page
    )
  };

  if (type === "movie") {
    parameters.region = readRegion(
      options.region
    );
  }

  const data = await request(
    `/${type}/top_rated`,
    parameters,
    {
      fresh: readFresh(options)
    }
  );

  return contentList(data, type);
}


export async function getNowPlayingMovies(
  options = {}
) {
  assertOptions(options);

  const data = await request(
    "/movie/now_playing",

    {
      language: readLanguage(
        options.language
      ),

      region: readRegion(
    
