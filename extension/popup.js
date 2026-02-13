const API = "http://localhost:3333/api/reading-list";

const statusEl = document.getElementById("status");
const saveBtn = document.getElementById("save-btn");
const pageInfoEl = document.getElementById("page-info");
const pageTitleEl = document.getElementById("page-title");
const pageUrlEl = document.getElementById("page-url");
const pageContentEl = document.getElementById("page-content");
const xInfoEl = document.getElementById("x-info");

let pageData = null;
let tabId = null;

function setStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = "status " + (type || "");
}

// Detect page type and extract content
async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setStatus("No active tab found", "error");
      return;
    }

    tabId = tab.id;
    const url = new URL(tab.url);
    const isXBookmarks =
      (url.hostname === "x.com" || url.hostname === "twitter.com") &&
      url.pathname.includes("/bookmarks");

    if (isXBookmarks) {
      // X bookmarks — first do a quick count of what's visible
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scrapeXBookmarks,
      });

      const visible = results[0]?.result || [];
      pageData = { type: "x-bookmarks", bookmarks: visible };

      pageInfoEl.style.display = "block";
      pageTitleEl.textContent = "X Bookmarks";
      pageUrlEl.textContent = tab.url;
      xInfoEl.style.display = "block";

      if (visible.length === 0) {
        setStatus("No bookmarks visible. Make sure you're on the bookmarks page.", "error");
        return;
      }

      xInfoEl.textContent = visible.length + " bookmarks visible";
      pageContentEl.textContent = visible.slice(0, 3).map(b => "@" + b.author + ": " + b.content.slice(0, 60)).join("\n");
      saveBtn.textContent = "Sync " + visible.length + " Visible";
      saveBtn.disabled = false;
      setStatus("Ready — or scroll down on X first to load more", "success");
    } else {
      // Generic page — extract content
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractPageContent,
      });

      const data = results[0]?.result || {};

      pageData = {
        type: "page",
        item: {
          url: tab.url,
          title: data.title || tab.title,
          content: data.content || "",
        },
      };

      pageInfoEl.style.display = "block";
      pageTitleEl.textContent = pageData.item.title;
      pageUrlEl.textContent = tab.url;
      if (pageData.item.content) {
        pageContentEl.textContent = pageData.item.content;
        pageContentEl.style.display = "block";
      }

      saveBtn.textContent = "Save to Reading List";
      saveBtn.disabled = false;
      setStatus("Ready to save", "success");
    }
  } catch (err) {
    setStatus("Error: " + err.message, "error");
  }
}

// Injected into X bookmarks page — scrapes all currently rendered articles
function scrapeXBookmarks() {
  const articles = document.querySelectorAll("article");
  const bookmarks = [];
  const seen = new Set();

  articles.forEach(function (article) {
    const tweetText = article.querySelector('[data-testid="tweetText"]');
    const content = tweetText ? tweetText.textContent : "";

    const userLinks = article.querySelectorAll('a[role="link"]');
    let author = "unknown";
    for (let i = 0; i < userLinks.length; i++) {
      const href = userLinks[i].getAttribute("href") || "";
      if (/^\/[A-Za-z0-9_]+$/.test(href)) {
        author = href.replace("/", "");
        break;
      }
    }

    const timeEl = article.querySelector("time");
    let tweetUrl = window.location.href;
    let tweetId = Date.now().toString() + Math.random().toString(36).slice(2);
    if (timeEl && timeEl.parentElement) {
      const linkHref = timeEl.parentElement.getAttribute("href");
      if (linkHref) {
        tweetUrl = "https://x.com" + linkHref;
        const idMatch = linkHref.match(/status\/(\d+)/);
        if (idMatch) tweetId = idMatch[1];
      }
    }

    if (content && !seen.has(tweetId)) {
      seen.add(tweetId);
      bookmarks.push({ tweetId, author, content, url: tweetUrl });
    }
  });

  return bookmarks;
}

// Injected into any page
function extractPageContent() {
  const selection = window.getSelection().toString().trim();
  const metaDesc = document.querySelector('meta[name="description"]');
  const ogDesc = document.querySelector('meta[property="og:description"]');

  return {
    title: document.title,
    content: selection || (ogDesc && ogDesc.getAttribute("content")) || (metaDesc && metaDesc.getAttribute("content")) || "",
  };
}

// Save button handler
saveBtn.addEventListener("click", async function () {
  if (!pageData) return;

  saveBtn.disabled = true;

  // For X bookmarks, re-scrape to pick up anything loaded since popup opened
  if (pageData.type === "x-bookmarks" && tabId) {
    setStatus("Scanning page for bookmarks...", "working");
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: scrapeXBookmarks,
    });
    const fresh = results[0]?.result || [];
    if (fresh.length > pageData.bookmarks.length) {
      pageData.bookmarks = fresh;
    }
    setStatus("Syncing " + pageData.bookmarks.length + " bookmarks...", "working");
  } else {
    setStatus("Saving...", "working");
  }

  try {
    const body =
      pageData.type === "x-bookmarks"
        ? { bookmarks: pageData.bookmarks }
        : { item: pageData.item };

    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
      setStatus("Error: " + (data.error || "Unknown error"), "error");
      saveBtn.disabled = false;
      return;
    }

    if (pageData.type === "x-bookmarks") {
      setStatus(data.added + " added, " + data.skipped + " already saved", "success");
    } else {
      setStatus(data.skipped ? "Already in your reading list" : "Saved!", "success");
    }

    saveBtn.textContent = "Done";
  } catch (err) {
    setStatus("Failed — is Aurelius running on localhost:3333?", "error");
    saveBtn.disabled = false;
  }
});

init();
