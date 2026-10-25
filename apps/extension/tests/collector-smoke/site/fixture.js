/* global document, window */
// Synthetic local-only fixture, not production extension code.
document.cookie = 'fixtureSession=COOKIE_SECRET; SameSite=Lax';
document.cookie = 'fixtureAccount=private@example.com; SameSite=Lax';
function select(node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
}
document.querySelector('#select-policy').addEventListener('click', () => select(document.querySelector('#policy')));
document.querySelector('#select-all').addEventListener('click', () => select(document.body));
