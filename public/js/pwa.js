(() => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.error('TIPIZ app setup failed:', error);
    });
  }

  const isInstalled =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  if (isInstalled) return;

  const noticeKey = 'tipiz-install-notice-seen';
  try {
    if (window.sessionStorage.getItem(noticeKey) === '1') return;
  } catch (error) {
    console.warn('TIPIZ could not check install notice preference:', error);
  }

  const isIOS =
    /iphone|ipad|ipod/i.test(window.navigator.userAgent) ||
    (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
  let installPrompt = null;
  let notice;
  let installButton;
  let message;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
  });

  function dismissNotice() {
    notice?.remove();
  }

  function rememberNotice() {
    try {
      window.sessionStorage.setItem(noticeKey, '1');
    } catch (error) {
      console.warn('TIPIZ could not save install notice preference:', error);
    }
  }

  function showNotice() {
    if (notice || !document.body) return;
    rememberNotice();

    notice = document.createElement('aside');
    notice.className = 'pwa-install-notice';
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');

    const title = document.createElement('strong');
    title.className = 'pwa-install-title';
    title.textContent = 'Download TIPIZ app';

    message = document.createElement('p');
    message.className = 'pwa-install-message';
    message.textContent = isIOS
      ? 'Add TIPIZ to your Home Screen from the Share menu.'
      : 'Download TIPIZ to your device for quick access.';

    const actions = document.createElement('div');
    actions.className = 'pwa-install-actions';

    installButton = document.createElement('button');
    installButton.type = 'button';
    installButton.className = 'pwa-install-primary';
    installButton.textContent = isIOS ? 'How to install' : 'Download app';
    installButton.addEventListener('click', installApp);

    const dismissButton = document.createElement('button');
    dismissButton.type = 'button';
    dismissButton.className = 'pwa-install-dismiss';
    dismissButton.textContent = 'Not now';
    dismissButton.addEventListener('click', dismissNotice);

    actions.append(installButton, dismissButton);
    notice.append(title, message, actions);
    document.body.append(notice);
  }

  async function installApp() {
    if (!installPrompt) {
      message.textContent = isIOS
        ? 'In Safari, tap Share, then choose Add to Home Screen.'
        : 'Open your browser menu and choose Install app or Add to Home screen.';
      return;
    }

    installButton.disabled = true;
    const prompt = installPrompt;
    installPrompt = null;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') dismissNotice();
    } catch (error) {
      console.error('TIPIZ app installation failed:', error);
    } finally {
      if (installButton.isConnected) installButton.disabled = false;
    }
  }

  window.setTimeout(showNotice, 2000);

  window.addEventListener('appinstalled', () => {
    rememberNotice();
    dismissNotice();
  });
})();
