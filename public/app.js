// Section Switcher Function
function switchView(viewId) {
  // Hide all view sections
  const views = document.querySelectorAll('.view-section');
  views.forEach(view => view.style.display = 'none');

  // Show the targeted section
  const targetView = document.getElementById(viewId);
  if (targetView) {
    targetView.style.display = 'block';
  }
}