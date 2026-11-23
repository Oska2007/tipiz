// TIPIZ Smart Ads (Pop-under Links)
document.addEventListener("DOMContentLoaded", () => {
  
  const smartLinks = [
    "https://auctionr.org/4/c488a9ee015820c49882b93c2cf82fee",
    "https://auctionr.org/4/17ad275d8fdc21c6100e14b78c7fb19a",
    "https://auctionr.org/4/07a9b5574b022a82bee34c32f2c66737"
  ];

  let currentLinkIndex = 0;
  let lastAdTime = 0;
  const AD_COOLDOWN = 10000; // තත්පර 10ක් ඇතුළත ආයෙ ඇඩ් එකක් එන්නේ නෑ

  function triggerAd() {
    const now = Date.now();
    
    if (now - lastAdTime > AD_COOLDOWN) {
      const link = smartLinks[currentLinkIndex];
      currentLinkIndex = (currentLinkIndex + 1) % smartLinks.length;
      
      // --- මේක තමයි අලුත් වෙනස්කම ---
      // window.open වෙනුවට අපි නොපෙනෙන <a> ටැග් එකක් හදලා ඒක ක්ලික් කරනවා
      const a = document.createElement('a');
      a.href = link;
      a.target = '_blank';
      a.style.display = 'none';
      
      document.body.appendChild(a);
      a.click(); // ලින්ක් එක ඔබනවා වගේ සිමියුලේට් කරනවා
      document.body.removeChild(a); // ඊට පස්සේ ඒක අයින් කරනවා
      
      lastAdTime = now;
    }
  }

  // 1. Movie / TV Card ක්ලික් කරද්දී
  document.body.addEventListener('click', (e) => {
    const card = e.target.closest('.movie-card');
    if (card) {
      triggerAd();
    }
  });

  // 2. Watch Now බටන් එක ක්ලික් කරද්දී
  document.body.addEventListener('click', (e) => {
    const watchBtn = e.target.closest('a[href*="watch.html"]');
    if (watchBtn) {
      triggerAd();
    }
  });

  // 3. TV Series Episode එකක් ක්ලික් කරද්දී
  document.body.addEventListener('click', (e) => {
    const episodeItem = e.target.closest('.episode-item');
    if (episodeItem) {
      triggerAd();
    }
  });

});