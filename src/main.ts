import './style.css';
import { dbService } from './services/db';
import { fileSyncService } from './services/fileSync';
import { renderHomeView } from './views/HomeView';
import { renderRecipesView } from './views/RecipesView';
import { renderIngredientsView } from './views/IngredientsView';
import { renderCalculatorView } from './views/CalculatorView';
import { renderHistoryView } from './views/HistoryView';
import { renderSyncView } from './views/SyncView';

async function initApp() {
  const app = document.querySelector<HTMLDivElement>('#app')!;

  // Initialize DB and sample data
  await dbService.seedIfEmpty();

  // Try to restore folder connection if available
  await fileSyncService.init();

  const settings = await dbService.getSettings();

  app.innerHTML = `
    <header class="app-header">
      <a href="#home" class="brand">
        <img src="/logo.jpg" alt="Cloud & Crust Logo" class="brand-logo" />
        <span id="header-brand-name">${settings.bakeryName}</span>
      </a>

      <nav class="header-nav">
        <a href="#home" class="nav-link" data-route="home">Home</a>
        <a href="#calculator" class="nav-link" data-route="calculator">Calculator</a>
        <a href="#recipes" class="nav-link" data-route="recipes">Recipes</a>
        <a href="#ingredients" class="nav-link" data-route="ingredients">Ingredients</a>
        <a href="#history" class="nav-link" data-route="history">History</a>
        <a href="#sync" class="nav-link" data-route="sync" id="nav-sync-link">
          <span class="sync-badge ${settings.isFolderConnected ? 'connected' : ''}" id="header-sync-badge">
            <span class="status-dot"></span>
            ${settings.isFolderConnected ? 'Drive Synced' : 'Storage'}
          </span>
        </a>
      </nav>
    </header>

    <main class="container" id="main-content">
      <!-- Views rendered here -->
    </main>
  `;

  const mainContent = app.querySelector('#main-content') as HTMLElement;
  const navLinks = app.querySelectorAll<HTMLAnchorElement>('.nav-link');

  async function updateSyncBadge() {
    const currentSettings = await dbService.getSettings();
    const badge = document.querySelector('#header-sync-badge');
    if (badge) {
      if (currentSettings.isFolderConnected) {
        badge.className = 'sync-badge connected';
        badge.innerHTML = `<span class="status-dot"></span> Drive Synced`;
      } else {
        badge.className = 'sync-badge';
        badge.innerHTML = `<span class="status-dot"></span> Storage`;
      }
    }
  }

  async function router() {
    const rawHash = window.location.hash.slice(1).toLowerCase();
    const route = rawHash.split('?')[0] || 'home';

    // Highlight active nav link
    navLinks.forEach((link) => {
      const target = link.dataset.route;
      if (target === route) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    await updateSyncBadge();

    switch (route) {
      case 'recipes':
        await renderRecipesView(mainContent);
        break;
      case 'ingredients':
        await renderIngredientsView(mainContent);
        break;
      case 'calculator':
        await renderCalculatorView(mainContent);
        break;
      case 'history':
        await renderHistoryView(mainContent);
        break;
      case 'sync':
        await renderSyncView(mainContent);
        break;
      case 'home':
      default:
        await renderHomeView(mainContent);
        break;
    }
  }

  window.addEventListener('hashchange', router);

  // Initial render
  if (!window.location.hash) {
    window.location.hash = '#home';
  } else {
    await router();
  }

  // Register Service Worker for offline PWA
  if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
    try {
      await navigator.serviceWorker.register('/sw.js');
      console.log('BakeMaster Service Worker registered');
    } catch (err) {
      console.log('ServiceWorker registration skipped or failed in this environment:', err);
    }
  }
}

initApp().catch((err) => {
  console.error('Initialization error:', err);
});
