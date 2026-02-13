(function () {
  var API = "http://localhost:3333/api/reading-list";
  var hostname = window.location.hostname;

  function notify(msg) {
    // Create a toast-style notification
    var el = document.createElement("div");
    el.textContent = msg;
    el.style.cssText =
      "position:fixed;top:20px;right:20px;z-index:999999;padding:12px 20px;" +
      "background:#1a1a1a;color:#d4a843;border:1px solid #333;border-radius:8px;" +
      "font:14px/1.4 -apple-system,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,0.3);" +
      "transition:opacity 0.3s;";
    document.body.appendChild(el);
    setTimeout(function () {
      el.style.opacity = "0";
      setTimeout(function () { el.remove(); }, 300);
    }, 3000);
  }

  // X/Twitter bookmarks page — batch scrape
  if (
    (hostname === "x.com" || hostname === "twitter.com") &&
    window.location.pathname.includes("/bookmarks")
  ) {
    var articles = document.querySelectorAll("article");
    var bookmarks = [];

    articles.forEach(function (article) {
      // Tweet text
      var tweetText = article.querySelector('[data-testid="tweetText"]');
      var content = tweetText ? tweetText.textContent : "";

      // Author from the user name link
      var userLinks = article.querySelectorAll('a[role="link"]');
      var author = "unknown";
      for (var i = 0; i < userLinks.length; i++) {
        var href = userLinks[i].getAttribute("href") || "";
        if (href.match(/^\/[A-Za-z0-9_]+$/) && !href.includes("/")) {
          author = href.replace("/", "");
          break;
        }
      }

      // Tweet URL from the timestamp link
      var timeEl = article.querySelector("time");
      var tweetUrl = window.location.href;
      var tweetId = Date.now().toString() + Math.random().toString(36).slice(2);
      if (timeEl && timeEl.parentElement) {
        var linkHref = timeEl.parentElement.getAttribute("href");
        if (linkHref) {
          tweetUrl = "https://x.com" + linkHref;
          var idMatch = linkHref.match(/status\/(\d+)/);
          if (idMatch) tweetId = idMatch[1];
        }
      }

      if (content) {
        bookmarks.push({
          tweetId: tweetId,
          author: author,
          content: content,
          url: tweetUrl,
        });
      }
    });

    if (bookmarks.length === 0) {
      notify("No bookmarks found. Scroll down to load some, then try again.");
      return;
    }

    notify("Syncing " + bookmarks.length + " bookmarks...");

    fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookmarks: bookmarks }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        notify(data.added + " added, " + data.skipped + " already saved");
      })
      .catch(function (err) {
        notify("Failed to sync: " + err.message);
      });
  } else {
    // Any other page — send as single reading list item
    var selection = window.getSelection().toString().trim();
    var metaDesc = document.querySelector('meta[name="description"]');
    var content = selection || (metaDesc ? metaDesc.getAttribute("content") : "") || "";
    var title = document.title;
    var url = window.location.href;

    notify("Adding to Reading List...");

    fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item: { url: url, title: title, content: content } }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.skipped) {
          notify("Already in your reading list");
        } else {
          notify("Added: " + title);
        }
      })
      .catch(function (err) {
        notify("Failed to add: " + err.message);
      });
  }
})();
