const apiKey = 'c16dc0e5216853e7589c24794cfe9e68';
const url = `https://api.themoviedb.org/3/trending/movie/week?api_key=${apiKey}`;

fetch(url)
  .then(response => response.json())
  .then(data => {
    const movieGrid = document.querySelector('.movie-grid');
    if (!movieGrid) return;
    movieGrid.innerHTML = '';
    data.results.forEach(movie => {
      const card = document.createElement('div');
      card.className = 'movie-card';
      const poster = `https://image.tmdb.org/t/p/w500${movie.poster_path}`;
      card.innerHTML = `
        <a href="https://vidsrc.xyz/embed/movie?tmdb=${movie.id}" target="_blank">
          <img src="${poster}" alt="${movie.title}">
          <p>${movie.title}</p>
        </a>
      `;
      movieGrid.appendChild(card);
    });
  });
