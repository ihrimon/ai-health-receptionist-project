/*
 * BrainStack chat widget loader (early MVP). A company adds one tag to its
 * site:
 *   <script src="https://<dashboard>/chatbot.js" data-chatbot-id="cb_…" async></script>
 * It draws a launcher button and opens the chat (/w/<id> on this same
 * origin) in an iframe. Plain ES5, no dependencies, styles set inline so
 * the host page's CSS can't break it (and it can't break the host page).
 */
(function () {
  var script = document.currentScript;
  if (!script) return;
  var chatbotId = script.getAttribute("data-chatbot-id");
  // Loaded twice on one page: keep the first.
  if (!chatbotId || window.__brainstackWidgetLoaded) return;
  window.__brainstackWidgetLoaded = true;

  var origin = new URL(script.src).origin;
  var side = "right";
  var open = false;

  var CHAT_ICON =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var CLOSE_ICON =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  function css(el, styles) {
    for (var key in styles) el.style.setProperty(key, styles[key], "important");
  }

  var button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", "Open chat");
  button.innerHTML = CHAT_ICON;
  css(button, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    width: "56px",
    height: "56px",
    "border-radius": "50%",
    border: "none",
    padding: "0",
    margin: "0",
    cursor: "pointer",
    display: "flex",
    "align-items": "center",
    "justify-content": "center",
    background: "#0F766E",
    color: "#ffffff",
    "box-shadow": "0 4px 16px rgba(0,0,0,.25)",
    "z-index": "2147483646",
  });

  var panel = document.createElement("div");
  css(panel, {
    position: "fixed",
    bottom: "88px",
    right: "20px",
    width: "370px",
    height: "560px",
    "max-width": "calc(100vw - 40px)",
    "max-height": "calc(100vh - 110px)",
    "border-radius": "16px",
    overflow: "hidden",
    "box-shadow": "0 8px 32px rgba(0,0,0,.25)",
    background: "#ffffff",
    display: "none",
    "z-index": "2147483647",
  });

  // The chat page loads right away (hidden), so the button gets the
  // company's color and side before the visitor clicks.
  var frame = document.createElement("iframe");
  frame.src = origin + "/w/" + encodeURIComponent(chatbotId);
  frame.title = "Chat";
  css(frame, { width: "100%", height: "100%", border: "0", display: "block" });
  panel.appendChild(frame);

  function place() {
    var other = side === "left" ? "right" : "left";
    var near = {};
    var far = {};
    near[side] = "20px";
    far[other] = "auto";
    css(button, near);
    css(button, far);
    css(panel, near);
    css(panel, far);
  }

  function setOpen(next) {
    open = next;
    css(panel, { display: open ? "block" : "none" });
    button.innerHTML = open ? CLOSE_ICON : CHAT_ICON;
    button.setAttribute("aria-label", open ? "Close chat" : "Open chat");
  }

  button.addEventListener("click", function () {
    setOpen(!open);
  });

  // Only messages from our own chat page count.
  window.addEventListener("message", function (event) {
    if (event.origin !== origin || !event.data) return;
    if (event.data.type === "brainstack:close") setOpen(false);
    if (event.data.type === "brainstack:config") {
      if (/^#[0-9a-fA-F]{6}$/.test(event.data.primaryColor || "")) {
        css(button, {
          background: event.data.primaryColor,
          color: event.data.textColor === "#000000" ? "#000000" : "#ffffff",
        });
      }
      side = event.data.position === "left" ? "left" : "right";
      place();
    }
  });

  function mount() {
    document.body.appendChild(panel);
    document.body.appendChild(button);
  }

  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();
