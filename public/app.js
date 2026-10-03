// Explicitly expose switchView to the window object for inline onclick attributes
window.switchView = function(viewId) {
  const views = document.querySelectorAll('.view-section');
  views.forEach(view => view.style.display = 'none');

  const targetView = document.getElementById(viewId);
  if (targetView) {
    targetView.style.display = 'block';
  }
};