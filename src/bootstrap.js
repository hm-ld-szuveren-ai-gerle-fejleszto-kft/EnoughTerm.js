import('./main.js').catch((error) => {
  console.error('EnoughTerm could not start.', error);
  const app = document.querySelector('#app');
  const message = document.createElement('pre');
  message.id = 'boot-status';
  message.dataset.state = 'error';
  message.setAttribute('role', 'alert');
  message.textContent = 'EnoughTerm could not start. Check the server and reload this page.';
  app.replaceChildren(message);
});
