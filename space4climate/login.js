/**
 * Login, signup and password reset for Space4Climate.
 *
 * Replaces the Firebase scaffold the page used to carry, which was never
 * configured and left every form in "demo mode". Accounts now live behind
 * /api/auth: sign in with a username or an email address and a password, or
 * with a Google account, which creates the account on first use.
 *
 * The session lives in an HttpOnly cookie, so this file never sees or stores
 * a token; it asks /api/auth?action=me who is signed in.
 */
(function () {
  "use strict";

  function el(id) {
    return document.getElementById(id);
  }

  /* Messages keyed by what the API sends back, so the page never shows a raw
     error code and never says whether an account exists. */
  var MESSAGES = {
    bad_credentials: "That username or password is not right. Please try again.",
    missing_credentials: "Enter your username or email address and your password.",
    too_many_attempts: "Too many attempts. Please wait a few minutes and try again.",
    use_google: "This account was created with Google. Use the Google button below.",
    email_taken: "An account already exists for that email address. Try logging in.",
    username_taken: "That username is taken. Please choose another.",
    invalid_email: "Enter a valid email address.",
    invalid_username: "Usernames are 3–30 characters: letters, numbers, dot, dash or underscore.",
    weak_password: "Use at least 8 characters for your password.",
    missing_name: "Please enter your name.",
    google_bad_token: "Google sign-in could not be verified. Please try again.",
    google_email_unverified: "Google has not verified that email address.",
    google_not_configured: "Google sign-in is not switched on for this site yet.",
    storage_unconfigured:
      "Accounts are not switched on for this deployment yet. The site owner needs to connect the database.",
    server_error: "Something went wrong at our end. Please try again."
  };

  function messageFor(code) {
    return MESSAGES[code] || "Something went wrong. Please try again.";
  }

  function showError(prefix, message) {
    var node = el(prefix + "-error");
    if (!node) return;
    node.textContent = message;
    node.classList.add("show");
  }

  function hideError(prefix) {
    var node = el(prefix + "-error");
    if (node) {
      node.textContent = "";
      node.classList.remove("show");
    }
  }

  function showSuccess(prefix, message) {
    var node = el(prefix + "-success");
    if (!node) return;
    node.textContent = message;
    node.classList.add("show");
  }

  function hideSuccess(prefix) {
    var node = el(prefix + "-success");
    if (node) {
      node.textContent = "";
      node.classList.remove("show");
    }
  }

  function setLoading(prefix, loading) {
    var btn = el("btn-" + prefix);
    var text = el("btn-" + prefix + "-text");
    var spinner = el("btn-" + prefix + "-spinner");
    if (!btn) return;
    btn.disabled = loading;
    if (text) text.style.opacity = loading ? "0.6" : "1";
    if (spinner) spinner.style.display = loading ? "inline" : "none";
  }

  /** Call the auth API, throwing the server's error code as the message. */
  async function api(action, body) {
    var response;
    try {
      response = await fetch("/api/auth?action=" + encodeURIComponent(action), {
        method: body ? "POST" : "GET",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        credentials: "same-origin",
        cache: "no-store"
      });
    } catch (err) {
      throw new Error("network");
    }
    var data = null;
    try {
      data = await response.json();
    } catch (err) {
      data = null;
    }
    if (!response.ok) throw new Error((data && data.error) || "server_error");
    return data;
  }

  /* ── Tabs ─────────────────────────────────────────────────────────────── */

  function switchTab(tab) {
    Array.prototype.forEach.call(document.querySelectorAll(".login-tab"), function (btn) {
      var active = btn.dataset.tab === tab;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    Array.prototype.forEach.call(document.querySelectorAll(".login-form-section"), function (section) {
      section.classList.remove("active");
    });
    var target = el("section-" + tab);
    if (target) target.classList.add("active");
  }

  Array.prototype.forEach.call(document.querySelectorAll(".login-tab"), function (btn) {
    btn.addEventListener("click", function () {
      switchTab(btn.dataset.tab);
    });
  });
  el("btn-go-signup").addEventListener("click", function () {
    switchTab("signup");
  });
  el("btn-go-login").addEventListener("click", function () {
    switchTab("login");
  });
  el("btn-show-reset").addEventListener("click", function () {
    switchTab("reset");
  });
  el("btn-reset-back").addEventListener("click", function () {
    switchTab("login");
  });

  /* ── Password field affordances ───────────────────────────────────────── */

  Array.prototype.forEach.call(document.querySelectorAll(".lf-pw-toggle"), function (btn) {
    btn.addEventListener("click", function () {
      var input = el(btn.dataset.target);
      if (!input) return;
      var wasText = input.type === "text";
      input.type = wasText ? "password" : "text";
      btn.setAttribute("aria-label", wasText ? "Show password" : "Hide password");
    });
  });

  el("signup-password").addEventListener("input", function () {
    var password = this.value;
    var score = 0;
    if (password.length >= 8) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    var bar = el("pw-strength-bar");
    if (!bar) return;
    var colours = ["#fca5a5", "#fbbf24", "#34d399", "#10b981"];
    var widths = ["25%", "50%", "75%", "100%"];
    bar.style.width = password ? widths[Math.max(0, score - 1)] : "0%";
    bar.style.background = colours[Math.max(0, score - 1)];
  });

  /* ── Signed-in state ──────────────────────────────────────────────────── */

  function showSignedIn(user) {
    var panel = el("loggedin-panel");
    var card = el("auth-card-main");
    if (card) card.style.display = "none";
    if (!panel) return;
    panel.classList.add("show");
    panel.style.display = "block";
    var avatar = el("loggedin-avatar");
    var label = (user.name || user.username || user.email || "?").trim();
    if (avatar) {
      if (user.picture) {
        avatar.textContent = "";
        avatar.style.backgroundImage = 'url("' + user.picture.replace(/"/g, "%22") + '")';
        avatar.style.backgroundSize = "cover";
        avatar.style.backgroundPosition = "center";
      } else {
        avatar.textContent = label.charAt(0).toUpperCase();
      }
    }
    var name = el("loggedin-name");
    var email = el("loggedin-email");
    if (name) name.textContent = user.name || user.username || "";
    if (email) email.textContent = user.email || "";
  }

  function showSignedOut() {
    var panel = el("loggedin-panel");
    var card = el("auth-card-main");
    if (panel) {
      panel.classList.remove("show");
      panel.style.display = "none";
    }
    if (card) card.style.display = "";
  }

  el("btn-logout").addEventListener("click", async function () {
    try {
      await api("logout", {});
    } catch (err) {
      /* Even if the call fails the local view should return to signed out. */
    }
    showSignedOut();
  });

  /* ── Forms ────────────────────────────────────────────────────────────── */

  el("form-login").addEventListener("submit", async function (event) {
    event.preventDefault();
    hideError("login");
    hideSuccess("login");
    var identifier = el("login-email").value.trim();
    var password = el("login-password").value;
    if (!identifier || !password) {
      showError("login", messageFor("missing_credentials"));
      return;
    }
    setLoading("login", true);
    try {
      var result = await api("login", { identifier: identifier, password: password });
      showSuccess("login", "Welcome back. Signing you in…");
      showSignedIn(result.user);
    } catch (err) {
      showError("login", err.message === "network" ? "We could not reach the server. Please try again." : messageFor(err.message));
    } finally {
      setLoading("login", false);
    }
  });

  el("form-signup").addEventListener("submit", async function (event) {
    event.preventDefault();
    hideError("signup");
    hideSuccess("signup");
    var name = el("signup-name").value.trim();
    var email = el("signup-email").value.trim();
    var usernameField = el("signup-username");
    var username = usernameField ? usernameField.value.trim() : "";
    var password = el("signup-password").value;
    var confirm = el("signup-confirm").value;

    if (!name) return showError("signup", messageFor("missing_name"));
    if (!email) return showError("signup", messageFor("invalid_email"));
    if (password.length < 8) return showError("signup", messageFor("weak_password"));
    if (password !== confirm) return showError("signup", "The two passwords do not match.");

    setLoading("signup", true);
    try {
      var result = await api("signup", {
        name: name,
        email: email,
        username: username,
        password: password
      });
      showSuccess("signup", "Account created. You are signed in.");
      showSignedIn(result.user);
    } catch (err) {
      showError("signup", err.message === "network" ? "We could not reach the server. Please try again." : messageFor(err.message));
    } finally {
      setLoading("signup", false);
    }
  });

  el("form-reset").addEventListener("submit", function (event) {
    event.preventDefault();
    hideError("reset");
    hideSuccess("reset");
    // Deliberately the same answer whether or not the address is on file, so
    // this form cannot be used to discover who has an account.
    showSuccess(
      "reset",
      "If that address has an account, we will send reset instructions. " +
        "Password resets by email are not switched on yet — contact us and we will help."
    );
  });

  /* ── Google ───────────────────────────────────────────────────────────── */

  window.s4cGoogleCallback = async function (response) {
    hideError("login");
    hideSuccess("login");
    try {
      var result = await api("google", { credential: response.credential });
      showSuccess("login", result.created ? "Welcome. Your account is ready." : "Welcome back.");
      showSignedIn(result.user);
    } catch (err) {
      showError("login", err.message === "network" ? "We could not reach the server. Please try again." : messageFor(err.message));
    }
  };

  function mountGoogle(clientId) {
    var slot = el("google-signin");
    if (!slot || !window.google || !window.google.accounts || !window.google.accounts.id) return;
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: window.s4cGoogleCallback,
      auto_select: false,
      cancel_on_tap_outside: true
    });
    window.google.accounts.id.renderButton(slot, {
      theme: "outline",
      size: "large",
      width: 320,
      text: "continue_with",
      shape: "rectangular"
    });
    var wrap = el("google-signin-wrap");
    if (wrap) wrap.style.display = "block";
  }

  /** Load Google's script only once we know a client id exists. */
  function loadGoogle(clientId) {
    if (document.getElementById("gsi-script")) return mountGoogle(clientId);
    var script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.id = "gsi-script";
    script.async = true;
    script.defer = true;
    script.onload = function () {
      mountGoogle(clientId);
    };
    document.head.appendChild(script);
  }

  /* ── Start-up ─────────────────────────────────────────────────────────── */

  (async function init() {
    var config = null;
    try {
      config = await api("config");
    } catch (err) {
      config = null;
    }

    if (config && config.googleClientId) {
      loadGoogle(config.googleClientId);
    }

    // Only say something is unavailable when it actually is, and say what it
    // means for the person reading rather than naming an internal service.
    if (config && config.passwordAccounts === false) {
      var notice = el("auth-notice");
      if (notice) {
        notice.innerHTML =
          "<strong>Accounts are not switched on yet.</strong> " +
          "Logging in and creating an account will not work until the site owner connects the database.";
        notice.classList.add("show");
      }
    }

    try {
      var who = await api("me");
      if (who && who.user) showSignedIn(who.user);
      else showSignedOut();
    } catch (err) {
      showSignedOut();
    }
  })();
})();
