document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.querySelector('.sidebar-toggle');
  if (!toggle) return;
  toggle.addEventListener('click', () => {
    document.body.classList.toggle('sidebar-collapsed');
  });
});
