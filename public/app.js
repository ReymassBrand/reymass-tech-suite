window.switchView = function (viewName) {
  document.querySelectorAll('[id^="view-"]').forEach(view => {
    view.classList.add('hidden');
  });

  const targetView = document.getElementById(`view-${viewName}`);
  if (targetView) {
    targetView.classList.remove('hidden');
  } else {
    console.error(`View not found: view-${viewName}`);
  }
};