
"use strict";

/* =========================================================
   KOREANSTREAM — Main Application
   TMDB discovery + VidSrc player + local user library
   ========================================================= */

const CONFIG = {
  tmdbApiKey: "c16dc0e5216853e7589c24794cfe9e68",
  tmdbBase: "https://api.themoviedb.org/3",
  imageBase: "https://image.tmdb.org/t/p/",
  vidsrcBase: "https://vidsrc.sh/embed",
  language: "en-US",
  pageSize: 20
};

const STORAGE = {
  favorites: "koreanstream_favorites_v1",
  history: "koreanstream_history_v1",
  progress: "koreanstream_progress_v1"
};

const GENRES = {
  Romance: 10749,
  Thriller: 53,
  Drama: 18,
  Comedy: 35,
  Action: 28,
  Mystery: 9648
};

const state = {
  trending: [],
  dramas: [],
  movies: [],
  catalog: [],
  heroItems: [],
  heroIndex: 0,
  activeHero: null,
  activeTitle: null,
  activePlayerTitle: null,
  activeGenre: null,
  activeType: "all",
  searchQuery: "",
  sort: "popular",
  page: 1,
  loadingMore: false,
  favorites: readStorage(STORAGE.favorites, []),
  history: readStorage(STORAGE.history, []),
  progress: readStorage(STORAGE.progress, {}),
  requestNumber: 0
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) =>
  Array.from(root.querySelectorAll(selector));

function readStorage(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn("KOREANSTREAM: local storage is unavailable.", error);
  }
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function getTitle(item) {
  return item?.title || item?.name || "Untitled";
}

function getDate(item) {
  return item?.release_date || item?.first_air_date || "";
}

function getYear(item) {
  const date = getDate(item);
  return date ? date.slice(0, 4) : "";
}

function getType(item) {
  if (item?.media_type === "movie" || item?.title) return "movie";
  return "tv";
}

function getKey(item) {
  return `${getType(item)}-${item.id}`;
}

function getPoster(item, size = "w500") {
  return item?.poster_path
    ? `${CONFIG.imageBase}${size}${item.poster_path}`
    : "";
}

function getBackdrop(item) {
  return item?.backdrop_path
    ? `${CONFIG.imageBase}original${item.backdrop_path}`
    : "";
}

function getRating(item) {
  const rating = Number(item?.vote_average);
  return Number.isFinite(rating) && rating > 0
    ? rating.toFixed(1)
    : "NR";
}

function setStatus(message, isError = false) {
  const element = $("#app-status");
  if (!element) return;

  element.textContent = message;
  element.classList.toggle("is-error", isError);
  element.hidden = !message;
}

function clearStatus() {
  const element = $("#app-status");
  if (!element) return;

  element.textContent = "";
  element.hidden = true;
  element.classList.remove("is-error");
}

function setButtonLoading(button, loading, loadingText = "Loading...") {
  if (!button) return;

  if (loading) {
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.textContent.trim();
    }
    button.textContent = loadingText;
    button.disabled = true;
  } else {
    if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
      delete button.dataset.originalText;
    }
    button.disabled = false;
  }
}

/* -------------------- TMDB API -------------------- */

async function tmdb(path, params = {}) {
  const url = new URL(`${CONFIG.tmdbBase}${path}`);

  url.searchParams.set("api_key", CONFIG.tmdbApiKey);
  url.searchParams.set("language", CONFIG.language);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`TMDB request failed (${response.status}).`);
  }

  return response.json();
}

function normalizeItems(items = [], forcedType = null) {
  return items
    .filter(item => item && item.id)
    .map(item => ({
      ...item,
      media_type: forcedType || item.media_type || (
        item.title ? "movie" : "tv"
      )
    }));
}

function uniqueItems(items = []) {
  const map = new Map();

  for (const item of items) {
    if (!item?.id) continue;
    const normalized = {
      ...item,
      media_type: getType(item)
    };
    map.set(getKey(normalized), normalized);
  }

  return Array.from(map.values());
}

async function loadTrending() {
  const data = await tmdb("/trending/tv/week", { page: 1 });
  const korean = normalizeItems(data.results, "tv")
    .filter(item => item.original_language === "ko");

  if (korean.length >= 5) return korean;

  const koreanDiscovery = await tmdb("/discover/tv", {
    with_original_language: "ko",
    sort_by: "popularity.desc",
    page: 1,
    include_adult: false
  });

  return uniqueItems([
    ...korean,
    ...normalizeItems(koreanDiscovery.results, "tv")
  ]);
}

async function loadDramas() {
  const data = await tmdb("/discover/tv", {
    with_original_language: "ko",
    with_origin_country: "KR",
    sort_by: "popularity.desc",
    page: 1,
    include_adult: false
  });

  return normalizeItems(data.results, "tv");
}

async function loadMovies() {
  const data = await tmdb("/discover/movie", {
    with_original_language: "ko",
    with_origin_country: "KR",
    sort_by: "popularity.desc",
    page: 1,
    include_adult: false
  });

  return normalizeItems(data.results, "movie");
}

async function loadApplication() {
  setStatus("Loading Korean entertainment...");

  const tasks = await Promise.allSettled([
    loadTrending(),
    loadDramas(),
    loadMovies()
  ]);

  state.trending = tasks[0].status === "fulfilled"
    ? tasks[0].value
    : [];

  state.dramas = tasks[1].status === "fulfilled"
    ? tasks[1].value
    : [];

  state.movies = tasks[2].status === "fulfilled"
    ? tasks[2].value
    : [];

  state.catalog = uniqueItems([
    ...state.trending,
    ...state.dramas,
    ...state.movies
  ]);

  state.heroItems = state.trending
    .filter(item => getBackdrop(item))
    .slice(0, 5);

  if (!state.heroItems.length) {
    state.heroItems = state.catalog.slice(0, 5);
  }

  if (!state.catalog.length) {
    setStatus(
      "We couldn't load the catalog. Check your internet connection and TMDB API key, then reload.",
      true
    );
    renderAll();
    return;
  }

  clearStatus();
  renderAll();
  renderHero();
}

/* -------------------- Poster cards -------------------- */

function renderCard(item, options = {}) {
  const key = getKey(item);
  const title = getTitle(item);
  const poster = getPoster(item);
  const year = getYear(item);
  const type = getType(item) === "movie" ? "Movie" : "Series";
  const favorite = state.favorites.includes(key);
  const watchedProgress = state.progress[key];
  const progress = Number(watchedProgress?.percent || 0);
  const showProgress = options.showProgress && progress > 0;

  const imageHTML = poster
    ? `<img class="poster-image" src="${escapeHTML(poster)}"
        alt="${escapeHTML(title)} poster"
        loading="lazy"
        onerror="this.style.display='none';this.parentElement.classList.add('poster-placeholder')">`
    : `<span class="poster-placeholder-label">KOREANSTREAM</span>`;

  return `
    <article class="poster-card" data-key="${escapeHTML(key)}">
      <button class="poster-open" type="button"
        data-action="details" data-key="${escapeHTML(key)}"
        aria-label="View ${escapeHTML(title)}">
        <div class="poster-artwork ${poster ? "" : "poster-placeholder"}">
          ${imageHTML}
          <div class="poster-overlay">
            <span class="poster-play">▶</span>
          </div>
          <span class="poster-badge">${type}</span>
          <span class="poster-rating">★ ${getRating(item)}</span>
          ${showProgress ? `
            <span class="watch-progress">
              <span style="width:${Math.min(100, Math.max(0, progress))}%"></span>
            </span>` : ""}
        </div>
      </button>
      <div class="poster-card-info">
        <button class="poster-title" type="button"
          data-action="details" data-key="${escapeHTML(key)}">
          ${escapeHTML(title)}
        </button>
        <div class="poster-meta">
          <span>${escapeHTML(year || "Release year unknown")}</span>
          <span>${type}</span>
        </div>
        <div class="poster-actions">
          <button class="poster-action" type="button"
            data-action="play" data-key="${escapeHTML(key)}"
            aria-label="Play ${escapeHTML(title)}">▶ Watch</button>
          <button class="poster-action ${favorite ? "is-saved" : ""}"
            type="button" data-action="favorite"
            data-key="${escapeHTML(key)}"
            aria-label="${favorite ? "Remove from" : "Add to"} My List">
            ${favorite ? "✓ Saved" : "+ My List"}
          </button>
        </div>
      </div>
    </article>`;
}

function renderRow(selector, items, options = {}) {
  const container = $(selector);
  if (!container) return;

  if (!items?.length) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No titles available right now.</p>
      </div>`;
    return;
  }

  container.innerHTML = items
    .map(item => renderCard(item, options))
    .join("");
}

function renderContinueWatching() {
  const items = state.history
    .map(key => state.catalog.find(item => getKey(item) === key))
    .filter(Boolean)
    .filter(item => Number(state.progress[getKey(item)]?.percent || 0) > 0)
    .slice(0, 12);

  const section = $("#continue-watching");
  if (section) section.hidden = items.length === 0;

  renderRow("#continue-row", items, { showProgress: true });
}

function renderAll() {
  renderRow("#trending-row", state.trending.slice(0, 12));
  renderRow("#dramas-row", state.dramas.slice(0, 12));
  renderRow("#movies-row", state.movies.slice(0, 12));
  renderContinueWatching();
  renderFavorites();
  renderCatalog();
}

/* -------------------- Hero banner -------------------- */

function renderHero() {
  if (!state.heroItems.length) return;

  const item = state.heroItems[state.heroIndex % state.heroItems.length];
  state.activeHero = item;

  const backdrop = getBackdrop(item);
  const hero = $(".hero");

  if (hero && backdrop) {
    hero.style.backgroundImage =
      `linear-gradient(90deg, rgba(12,12,14,.98) 0%, rgba(12,12,14,.72) 48%, rgba(12,12,14,.18) 100%), linear-gradient(0deg, rgba(12,12,14,.95), transparent 60%), url("${backdrop}")`;
    hero.style.backgroundSize = "cover";
    hero.style.backgroundPosition = "center";
  }

  const title = $("#hero-title");
  const description = $("#hero-description");
  const eyebrow = $("#hero-eyebrow");
  const meta = $("#hero-meta");

  if (title) title.textContent = getTitle(item);
  if (description) {
    description.textContent = item.overview ||
      "Discover a new Korean story on KOREANSTREAM.";
  }
  if (eyebrow) {
    eyebrow.textContent = getType(item) === "movie"
      ? "FEATURED KOREAN FILM"
      : "FEATURED K-DRAMA";
  }
  if (meta) {
    const parts = [];
    if (getYear(item)) parts.push(getYear(item));
    parts.push(`★ ${getRating(item)}`);
    parts.push(getType(item) === "movie" ? "Movie" : "Series");
    meta.textContent = parts.join("  ·  ");
  }

  const watchButton = $("#hero-watch");
  const infoButton = $("#hero-info");

  if (watchButton) {
    watchButton.disabled = false;
    watchButton.onclick = () => openPlayer(item);
  }

  if (infoButton) {
    infoButton.disabled = false;
    infoButton.onclick = () => openDetails(item);
  }

  const pagination = $("#hero-pagination");
  if (pagination) {
    pagination.innerHTML = state.heroItems.map((_, index) => `
      <button type="button"
        class="hero-dot ${index === state.heroIndex ? "active" : ""}"
        data-action="hero-dot" data-index="${index}"
        aria-label="Show featured title ${index + 1}"></button>
    `).join("");
  }
}

/* -------------------- Catalog and genres -------------------- */

function getFilteredCatalog() {
  let items = [...state.catalog];

  if (state.activeType !== "all") {
    items = items.filter(item => getType(item) === state.activeType);
  }

  if (state.activeGenre) {
    const genreId = GENRES[state.activeGenre];
    items = items.filter(item => item.genre_ids?.includes(genreId));
  }

  if (state.searchQuery.trim()) {
    const query = state.searchQuery.trim().toLowerCase();
    items = items.filter(item => {
      const title = getTitle(item).toLowerCase();
      const overview = (item.overview || "").toLowerCase();
      return title.includes(query) || overview.includes(query);
    });
  }

  if (state.sort === "rating") {
    items.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
  } else if (state.sort === "newest") {
    items.sort((a, b) => getDate(b).localeCompare(getDate(a)));
  } else {
    items.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  }

  return items;
}

function renderCatalog() {
  const grid = $("#all-content-grid");
  if (!grid) return;

  const items = getFilteredCatalog();

  grid.innerHTML = items.length
    ? items.map(item => renderCard(item)).join("")
    : `<div class="empty-state">
         <p>No matching titles found.</p>
         <p>Try another search or genre.</p>
       </div>`;

  const loadMore = $("#load-more");
  if (loadMore) {
    loadMore.hidden = Boolean(
      state.searchQuery || state.activeGenre || state.activeType !== "all"
    );
  }

  const heading = $("#catalog-heading");
  if (heading) {
    heading.textContent = state.searchQuery
      ? `Search results for "${state.searchQuery}"`
      : state.activeGenre
        ? `${state.activeGenre} titles`
        : state.activeType === "movie"
          ? "Korean Movies"
          : state.activeType === "tv"
            ? "K-Dramas"
            : "Explore Korean Entertainment";
  }
}

function renderFavorites() {
  const items = state.favorites
    .map(key => state.catalog.find(item => getKey(item) === key))
    .filter(Boolean);

  const section = $("#my-list");
  if (section) section.hidden = items.length === 0;

  renderRow("#my-list-row", items);
}

function updateCatalogFilters() {
  const typeSelect = $("#content-type");
  const sortSelect = $("#sort-content");

  if (typeSelect) state.activeType = typeSelect.value || "all";
  if (sortSelect) state.sort = sortSelect.value || "popular";

  renderCatalog();
}

/* -------------------- Search -------------------- */

async function performSearch(query) {
  state.searchQuery = query.trim();
  state.activeGenre = null;

  $$(".genre-button, [data-genre]").forEach(button => {
    button.classList.remove("active");
    button.setAttribute("aria-pressed", "false");
  });

  if (!state.searchQuery) {
    renderCatalog();
    return;
  }

  const requestId = ++state.requestNumber;
  setStatus("Searching Korean titles...");

  try {
    const data = await tmdb("/search/multi", {
      query: state.searchQuery,
      page: 1,
      include_adult: false
    });

    if (requestId !== state.requestNumber) return;

    const results = normalizeItems(data.results)
      .filter(item => ["tv", "movie"].includes(item.media_type))
      .filter(item =>
        item.original_language === "ko" ||
        item.origin_country?.includes("KR") ||
        item.original_language === "en"
      );

    const combined = uniqueItems([...results, ...state.catalog]);

    const query = state.searchQuery.toLowerCase();
    state.catalog = combined.filter(item => {
      const matchesTitle = getTitle(item).toLowerCase().includes(query);
      const matchesOverview = (item.overview || "").toLowerCase().includes(query);
      return matchesTitle || matchesOverview;
    });

    clearStatus();
    renderCatalog();
  } catch (error) {
    console.error("KOREANSTREAM search:", error);
    setStatus(
      "Search is temporarily unavailable. Please try again.",
      true
    );
  }
}

function restoreCatalog() {
  state.searchQuery = "";
  state.activeGenre = null;
  state.activeType = "all";

  const searchInput = $("#search-input");
  if (searchInput) searchInput.value = "";

  const typeSelect = $("#content-type");
  if (typeSelect) typeSelect.value = "all";

  $$(".genre-button, [data-genre]").forEach(button => {
    button.classList.remove("active");
    button.setAttribute("aria-pressed", "false");
  });

  renderCatalog();
}

/* -------------------- Title details dialog -------------------- */

function getItemByKey(key) {
  return state.catalog.find(item => getKey(item) === key) ||
    state.trending.find(item => getKey(item) === key) ||
    state.dramas.find(item => getKey(item) === key) ||
    state.movies.find(item => getKey(item) === key) ||
    state.heroItems.find(item => getKey(item) === key) ||
    null;
}

function showDialog(dialog) {
  if (!dialog) return;

  if (typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
  } else {
    dialog.classList.add("is-open");
    dialog.setAttribute("aria-modal", "true");
  }
}

function closeDialog(dialog) {
  if (!dialog) return;

  if (typeof dialog.close === "function" && dialog.open) {
    dialog.close();
  } else {
    dialog.classList.remove("is-open");
  }
}

function openDetails(item) {
  if (!item) return;

  state.activeTitle = item;

  const title = $("#dialog-title");
  const meta = $("#dialog-meta");
  const description = $("#dialog-description");
  const saveButton = $("#dialog-save");
  const backdrop = $("#dialog-backdrop");

  if (title) title.textContent = getTitle(item);
  if (meta) {
    meta.textContent = [
      getYear(item),
      getType(item) === "movie" ? "Movie" : "TV Series",
      `Rating ${getRating(item)}`
    ].filter(Boolean).join(" · ");
  }
  if (description) {
    description.textContent = item.overview ||
      "More information about this title is not currently available.";
  }
  if (backdrop) {
    const image = getBackdrop(item);
    backdrop.style.backgroundImage = image ? `url("${image}")` : "none";
  }

  if (saveButton) {
    const saved = state.favorites.includes(getKey(item));
    saveButton.textContent = saved ? "Remove from My List" : "Add to My List";
    saveButton.onclick = () => toggleFavorite(item);
  }

  const watchButton = $("#dialog-watch");
  if (watchButton) {
    watchButton.onclick = () => openPlayer(item);
  }

  showDialog($("#title-dialog"));
}

/* -------------------- Favorites and watch history -------------------- */

function toggleFavorite(item) {
  if (!item) return;

  const key = getKey(item);
  const index = state.favorites.indexOf(key);

  if (index >= 0) {
    state.favorites.splice(index, 1);
  } else {
    state.favorites.unshift(key);
  }

  state.favorites = [...new Set(state.favorites)];
  writeStorage(STORAGE.favorites, state.favorites);

  renderAll();

  if (state.activeTitle && getKey(state.activeTitle) === key) {
    const saveButton = $("#dialog-save");
    if (saveButton) {
      saveButton.textContent = state.favorites.includes(key)
        ? "Remove from My List"
        : "Add to My List";
    }
  }
}

function addToHistory(item) {
  const key = getKey(item);

  state.history = [
    key,
    ...state.history.filter(existing => existing !== key)
  ].slice(0, 30);

  writeStorage(STORAGE.history, state.history);
}

function saveProgress(item, seconds, duration) {
  if (!item || !Number.isFinite(seconds) || seconds < 0) return;

  const key = getKey(item);
  const validDuration = Number.isFinite(duration) && duration > 0
    ? duration
    : 0;

 
