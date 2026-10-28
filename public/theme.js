// Apply the saved theme before styles load, including on a direct room link.
(() => {
  const key = 'soc-quiz-theme';
  const system = matchMedia('(prefers-color-scheme: dark)');
  let preference;
  try { preference = localStorage.getItem(key); } catch {}
  const valid = value => value === 'light' || value === 'dark';
  function apply(theme) {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#0c1222' : '#f3f5fa';
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      button.setAttribute('aria-pressed', String(theme === 'dark'));
      button.title = `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`;
      button.querySelector('[data-theme-icon]').textContent = theme === 'dark' ? '☀' : '☾';
      button.querySelector('[data-theme-label]').textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
    });
  }
  apply(valid(preference) ? preference : system.matches ? 'dark' : 'light');
  document.addEventListener('click', event => {
    if (!event.target.closest('[data-theme-toggle]')) return;
    preference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(key, preference); } catch {}
    apply(preference);
  });
  system.addEventListener('change', () => {
    if (!valid(preference)) apply(system.matches ? 'dark' : 'light');
  });
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    preference = event.newValue;
    apply(valid(preference) ? preference : system.matches ? 'dark' : 'light');
  });
})();
