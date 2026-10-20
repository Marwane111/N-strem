
"use strict";

/*
 * KOREANSTREAM configuration
 * Public frontend configuration only.
 */

window.KOREANSTREAM_CONFIG = Object.freeze({
  appName: "KOREANSTREAM",
  language: "en-US",

  tmdb: {
    baseURL: "https://api.themoviedb.org/3",
    imageBaseURL: "https://image.tmdb.org/t/p",
    posterSize: "w500",
    backdropSize: "original"
  },

  player: {
    baseURL: "https://vidsrc.sh/embed",
    autoplay: true,
    subtitleLanguage: "en"
  },

  storage: {
    favorites: "koreanstream_favorites_v1",
    history: "koreanstream_history_v1",
    progress: "koreanstream_progress_v1"
  },

  catalog: {
    defaultPage: 1,
    pageSize: 20,
    originalLanguage: "ko",
    country: "KR"
  }
});
