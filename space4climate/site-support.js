(function () {
  var doc = document.documentElement;
  if (doc) {
    doc.classList.add("s4c-js");
    doc.setAttribute("data-js", "enabled");
  }

  if ("scrollRestoration" in history) {
    history.scrollRestoration = "manual";
    requestAnimationFrame(function () {
      history.scrollRestoration = "auto";
    });
  }

  function assetPrefix() {
    var script = document.currentScript;
    var src = (script && script.src) || "/site-support.js";
    return src.replace(/site-support\.js(\?.*)?$/, "");
  }

  function ensurePerfStyles() {
    if (document.querySelector('link[href*="perf.css"]')) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = assetPrefix() + "perf.css?v=39";
    document.head.appendChild(link);
  }

  function ensureInterFont() {
    document.querySelectorAll('link[href*="fonts.googleapis.com"]').forEach(function (link) {
      if (link.href.indexOf("http://") === 0) {
        link.href = link.href.replace("http://", "https://");
      }
    });
    if (!document.querySelector('link[href*="fonts.googleapis.com"][href*="Inter"]')) {
      var pre = document.createElement("link");
      pre.rel = "preconnect";
      pre.href = "https://fonts.googleapis.com";
      document.head.appendChild(pre);
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap";
      document.head.appendChild(link);
    }
    var root = document.documentElement;
    root.style.setProperty("--text-main--font-family", "Inter, system-ui, sans-serif");
  }

  function NoopSplit() {
    return { revert: function () {}, chars: [], words: [], lines: [] };
  }
  NoopSplit._s4c = true;

  function lockSplitText() {
    try {
      Object.defineProperty(window, "SplitText", {
        configurable: true,
        get: function () {
          return NoopSplit;
        },
        set: function () {}
      });
    } catch (err) {
      window.SplitText = NoopSplit;
    }
  }

  function disarmScrollAnimations() {
    try {
      lockSplitText();

      if (window.gsap && typeof window.gsap.timeline === "function" && !window.gsap.timeline._s4c) {
        var origTimeline = window.gsap.timeline;
        window.gsap.timeline = function (vars) {
          if (vars && vars.scrollTrigger) {
            vars = Object.assign({}, vars);
            delete vars.scrollTrigger;
          }
          return origTimeline.apply(this, arguments);
        };
        window.gsap.timeline._s4c = true;
      }

      if (window.ScrollTrigger && !window.ScrollTrigger._s4c) {
        window.ScrollTrigger._s4c = true;
        if (typeof window.ScrollTrigger.config === "function") {
          window.ScrollTrigger.config({ autoRefreshEvents: "none" });
        }
        if (typeof window.ScrollTrigger.normalizeScroll === "function") {
          window.ScrollTrigger.normalizeScroll(false);
        }
        if (typeof window.ScrollTrigger.create === "function") {
          window.ScrollTrigger.create = function () {
            return { kill: function () {}, animation: null };
          };
        }
      }
    } catch (err) {}
  }

  function getMediaLabel(element, fallback) {
    var label = element.getAttribute("title") || element.getAttribute("aria-label");
    if (label) return label;

    var container = element.closest("section, article, div, figure");
    if (container) {
      var heading = container.querySelector("h1, h2, h3, h4, h5, h6");
      if (heading && heading.textContent.trim()) {
        return heading.textContent.trim();
      }
    }

    return fallback;
  }

  function repairBrokenMediaUrls() {
    var leftover = /\s+[A-Za-z0-9_.%-]+\.(jpg|jpeg|png|webp|svg)$/i;
    document.querySelectorAll("img, source, video").forEach(function (el) {
      ["src", "poster"].forEach(function (attr) {
        var val = el.getAttribute(attr);
        if (val && leftover.test(val)) {
          el.setAttribute(attr, val.replace(leftover, ""));
        }
      });
      var srcset = el.getAttribute("srcset");
      if (srcset && leftover.test(srcset)) {
        el.setAttribute(
          "srcset",
          srcset.replace(
            /(https?:\/\/[^\s,]+?)\s+[A-Za-z0-9_.%-]+\.(?:jpg|jpeg|png|webp|svg)/gi,
            "$1"
          )
        );
      }
    });
  }

  function enhanceEmbeds() {
    var embeds = document.querySelectorAll("iframe, video, audio");
    embeds.forEach(function (element, index) {
      element.setAttribute("data-js-enhanced", "true");

      if (element.tagName === "IFRAME") {
        var isHero = element.closest(".section-video-hero") || element.classList.contains("home");
        if (!isHero && !element.hasAttribute("loading")) {
          element.setAttribute("loading", "lazy");
        }
        if (!element.hasAttribute("referrerpolicy")) {
          element.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
        }
        if (!element.hasAttribute("allow")) {
          element.setAttribute("allow", "autoplay; fullscreen; picture-in-picture; encrypted-media");
        }
        element.setAttribute("allowfullscreen", "");
        if (!element.getAttribute("title")) {
          element.setAttribute("title", getMediaLabel(element, "Embedded media " + (index + 1)));
        }
      }

      if (element.tagName === "VIDEO" || element.tagName === "AUDIO") {
        var isDecorative = element.hasAttribute("autoplay") && element.hasAttribute("muted");
        if (!element.hasAttribute("preload")) {
          element.setAttribute("preload", isDecorative ? "auto" : "metadata");
        }
        if (!isDecorative && !element.hasAttribute("controls")) {
          element.setAttribute("controls", "controls");
        }
        if (element.tagName === "VIDEO") {
          element.setAttribute("playsinline", "playsinline");
        }
        if (isDecorative) {
          element.removeAttribute("controls");
          element.play().catch(function () {});
        }
        if (!element.getAttribute("aria-label") && !element.getAttribute("title")) {
          element.setAttribute("aria-label", getMediaLabel(element, "Media playback " + (index + 1)));
        }
      }
    });

    var heroIframe = document.querySelector(".section-video-hero iframe");
    if (heroIframe) {
      heroIframe.removeAttribute("loading");
    }
  }

  function flattenScrollHijack() {
    var selectors = [
      ".scroll-wrapper",
      ".second-section",
      ".scroll-track",
      ".horizontal-scroll-camera",
      ".horizontal-scroll-content",
      ".scroll-content-wrapper"
    ];
    document.querySelectorAll(selectors.join(",")).forEach(function (el) {
      el.style.setProperty("transform", "none", "important");
      el.style.setProperty("height", "auto", "important");
      el.style.setProperty("width", "100%", "important");
      el.style.setProperty("position", "relative", "important");
      el.style.setProperty("will-change", "auto", "important");
    });
  }

  function killScrollTriggers() {
    try {
      if (window.ScrollTrigger && typeof window.ScrollTrigger.getAll === "function") {
        window.ScrollTrigger.getAll().forEach(function (trigger) {
          trigger.kill(true);
        });
      }
      if (window.gsap) {
        document.querySelectorAll(".split-chars, .split-words, .split-lines").forEach(function (el) {
          window.gsap.set(el, { clearProps: "transform,opacity,rotationX" });
        });
      }
    } catch (err) {}
  }

  function stopIx2ScrollEngine() {
    if (!document.querySelector(".scroll-wrapper, .horizontal-scroll-camera, .second-section")) {
      flattenScrollHijack();
      return;
    }
    try {
      if (!window.Webflow || typeof window.Webflow.require !== "function") return;
      var ix2 = window.Webflow.require("ix2");
      if (ix2 && typeof ix2.destroy === "function") {
        ix2.destroy();
      }
    } catch (err) {}
    flattenScrollHijack();
  }

  function observeMedia(selector, onChange) {
    var nodes = document.querySelectorAll(selector);
    if (!nodes.length || !("IntersectionObserver" in window)) return;

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          onChange(entry.target, entry.isIntersecting);
        });
      },
      { rootMargin: "80px 0px", threshold: 0.12 }
    );

    nodes.forEach(function (node) {
      observer.observe(node);
    });
  }

  function tameVideos() {
    observeMedia('iframe[src*="vidzflow"], iframe[src*="youtube"], iframe[src*="vimeo"]', function (iframe, visible) {
      if (iframe.closest(".section-video-hero") || iframe.classList.contains("home")) return;
      var win = iframe.contentWindow;
      if (win) {
        try {
          win.postMessage(visible ? "playerPlay" : "playerPause", "*");
        } catch (err) {}
      }
      if (visible) {
        iframe.removeAttribute("data-s4c-paused");
      } else {
        iframe.setAttribute("data-s4c-paused", "true");
      }
    });

    observeMedia("video[autoplay], video[data-autoplay]", function (video, visible) {
      try {
        if (visible) {
          video.play().catch(function () {});
        } else {
          video.pause();
        }
      } catch (err) {}
    });
  }

  function lazyBelowFoldImages() {
    var images = document.querySelectorAll("img[loading='eager'], img:not([loading])");
    images.forEach(function (img, index) {
      if (index < 2) return;
      var rect = img.getBoundingClientRect();
      if (rect.top > window.innerHeight * 1.15) {
        img.setAttribute("loading", "lazy");
        img.setAttribute("decoding", "async");
      }
    });
  }

  function assetRoot() {
    var prefix = assetPrefix();
    if (prefix && prefix !== "/") return prefix;
    var path = (window.location && window.location.pathname) || "/";
    if (/\/(lab-notes|legal|news|projects|programs|case-studies)\//.test(path)) {
      return "../";
    }
    return "";
  }

  function makeLoginLink(className) {
    var link = document.createElement("a");
    link.href = assetRoot() + "login.html";
    link.className = className;
    link.innerHTML = '<div class="nav_btn_text">Log in</div>';
    return link;
  }

  function flattenAboutStory() {
    var slider = document.querySelector(".slider-2.story");
    if (!slider) return;

    var intro = slider.querySelector(".story-slide");
    if (intro && !document.querySelector(".s4c-story-intro")) {
      var pinned = intro.cloneNode(true);
      pinned.className = "s4c-story-intro";
      pinned.removeAttribute("aria-hidden");
      pinned.querySelectorAll("[aria-hidden]").forEach(function (el) {
        el.removeAttribute("aria-hidden");
      });
      pinned.querySelectorAll("[tabindex='-1']").forEach(function (el) {
        el.removeAttribute("tabindex");
      });
      pinned.style.setProperty("height", "auto", "important");
      pinned.style.setProperty("overflow", "visible", "important");
      pinned.querySelectorAll(".story-slide-wrapper, .story-container").forEach(function (el) {
        el.style.setProperty("position", "relative", "important");
        el.style.setProperty("inset", "auto", "important");
        el.style.setProperty("height", "auto", "important");
        el.style.setProperty("overflow", "visible", "important");
        el.style.setProperty("transform", "none", "important");
      });
      slider.parentNode.insertBefore(pinned, slider);
    }
    if (intro) {
      intro.style.display = "none";
    }

    slider.classList.remove("w-slider");
    var mask = slider.querySelector(".w-slider-mask");
    if (mask) {
      mask.style.setProperty("display", "flex", "important");
      mask.style.setProperty("flex-direction", "column", "important");
      mask.style.setProperty("transform", "none", "important");
      mask.style.setProperty("width", "100%", "important");
      mask.style.setProperty("height", "auto", "important");
    }
    slider.querySelectorAll(".w-slide").forEach(function (slide) {
      if (slide.classList.contains("story-slide")) return;
      slide.style.setProperty("transform", "none", "important");
      slide.style.setProperty("position", "relative", "important");
      slide.style.setProperty("left", "0", "important");
      slide.style.setProperty("width", "100%", "important");
      slide.style.setProperty("height", "auto", "important");
      slide.style.setProperty("opacity", "1", "important");
      slide.style.setProperty("visibility", "visible", "important");
      slide.removeAttribute("aria-hidden");
    });
    slider.querySelectorAll(".w-slider-arrow-left, .w-slider-arrow-right, .w-slider-nav").forEach(function (el) {
      el.style.display = "none";
    });
  }

  function fixAboutHeroMedia() {
    var well = document.querySelector(".section-video-hero.about");
    if (!well) return;
    well.querySelectorAll("iframe").forEach(function (iframe) {
      iframe.setAttribute("height", "100%");
      iframe.style.setProperty("position", "absolute", "important");
      iframe.style.setProperty("inset", "0", "important");
      iframe.style.setProperty("width", "100%", "important");
      iframe.style.setProperty("height", "100%", "important");
      iframe.style.setProperty("min-height", "0", "important");
      iframe.style.setProperty("max-height", "100%", "important");
    });
  }

  function flattenProgramCards() {
    document.querySelectorAll(".slider-wrapper").forEach(function (wrap) {
      if (!wrap.querySelector(".card.programs")) return;
      wrap.querySelectorAll(".collection-list, .w-dyn-items, .w-dyn-item, .swiper, .swiper-wrapper, .swiper-slide").forEach(function (el) {
        el.style.setProperty("transform", "none", "important");
        el.style.setProperty("width", el.classList.contains("w-dyn-item") || el.classList.contains("swiper-slide") ? "auto" : "100%", "important");
      });
    });
    document.querySelectorAll("a.card.programs img, .card.programs img").forEach(function (img) {
      var src = img.getAttribute("src") || "";
      if (src.indexOf("S4C workshops") !== -1 || src.indexOf("S4C%20workshops") !== -1) {
        src = "https://cdn.prod.website-files.com/65cebd17c70b035a9f4dea65/69b9740bc12922254be8b963_MissionZeroTechnologies_Building-Materials.jpg";
        img.setAttribute("src", src);
      } else if (src.indexOf(" ") !== -1) {
        img.setAttribute("src", src.replace(/ /g, "%20"));
      }
      img.removeAttribute("srcset");
      img.removeAttribute("sizes");
    });
  }

  function enhanceDropdowns() {
    if (window.matchMedia && window.matchMedia("(max-width: 991px)").matches) return;
    document.querySelectorAll(".nav_dropdown_wrap").forEach(function (wrap) {
      if (wrap.getAttribute("data-s4c-dd") === "1") return;
      wrap.setAttribute("data-s4c-dd", "1");
      wrap.addEventListener("mouseenter", function () {
        document.querySelectorAll(".nav_dropdown_wrap").forEach(function (other) {
          if (other !== wrap) other.classList.remove("active");
        });
        wrap.classList.add("active");
        wrap.querySelectorAll(".nav_dropdown_contain, .nav_dropdown_mask, .nav_dropdown_layout").forEach(function (el) {
          el.style.setProperty("opacity", "1", "important");
        });
      });
      wrap.addEventListener("mouseleave", function () {
        wrap.classList.remove("active");
      });
      var toggle = wrap.querySelector(".nav_dropdown_toggle_wrap, button, a");
      if (toggle) {
        toggle.addEventListener("click", function (event) {
          if (window.matchMedia && window.matchMedia("(max-width: 991px)").matches) return;
          event.preventDefault();
          var open = wrap.classList.contains("active");
          document.querySelectorAll(".nav_dropdown_wrap").forEach(function (other) {
            other.classList.remove("active");
          });
          if (!open) wrap.classList.add("active");
        });
      }
    });
  }

  function parkContactForm() {
    var form = document.querySelector(".contact-form-wrapper");
    if (!form) return;
    form.style.position = "fixed";
    form.style.top = "0";
    if (!form.style.right || form.style.right === "0px") {
      form.style.right = "-800px";
    }
    document.querySelectorAll(".slide-form-trigger").forEach(function (el) {
      el.style.pointerEvents = "none";
    });
  }

  function ensureLoginNav() {
    if (/login\.html$/i.test(window.location.pathname)) return;
    if (!document.querySelector(".s4c-login-nav-btn, a[href*='login.html']")) {
      var wrap = document.querySelector(".nav_btn_dekstop");
      if (wrap) {
        var link = makeLoginLink("s4c-login-nav-btn w-inline-block");
        var contact = wrap.querySelector("a[href*='contact']");
        if (contact) wrap.insertBefore(link, contact);
        else wrap.appendChild(link);
      }
    }
    var mobile = document.querySelector(".nav_menu_layout");
    if (mobile && !mobile.querySelector(".s4c-login-nav-btn, a[href*='login.html']")) {
      var mobileLink = makeLoginLink("s4c-login-nav-btn w-inline-block");
      mobileLink.style.margin = "0.75rem 0";
      mobile.appendChild(mobileLink);
    }
  }

  function ensureMobileMenu() {
    var toggle = document.getElementById("nav-menu-toggle");
    var nav = document.querySelector(".nav_component");
    if (!toggle || !nav || toggle.getAttribute("data-s4c-menu") === "1") return;
    toggle.setAttribute("data-s4c-menu", "1");
    toggle.addEventListener(
      "click",
      function (event) {
        if (window.navigationState) return;
        event.preventDefault();
        var open = !nav.classList.contains("open");
        nav.classList.toggle("open", open);
        document.body.classList.toggle("u-overflow-hidden", open);
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
      },
      true
    );
  }

  function labelFooterLogo() {
    var wrap = document.querySelector(".footer_header_logo1_wrap");
    if (!wrap || wrap.querySelector(".s4c-footer-wordmark")) return;
    var mark = document.createElement("span");
    mark.className = "s4c-footer-wordmark";
    mark.textContent = "Space4Climate";
    wrap.appendChild(mark);
  }

  function stampCopyright() {
    var year = String(new Date().getFullYear());
    document.querySelectorAll(".copyright-year").forEach(function (el) {
      el.textContent = year;
    });
  }

  function proofreadChrome() {
    var labels = {
      Industries: "Workshop",
      Company: "About",
      Thoughts: "Updates",
      Technology: "Experience",
      "Climate Education": "Film-making"
    };
    document.querySelectorAll(".nav_dropdown_label, .nav_link_text, .nav_btn_text, .nav_menu_text, .footer_menu_btn_text, .footer_menu_label, a").forEach(function (el) {
      if (el.childElementCount > 1) return;
      var text = (el.textContent || "").trim();
      if (labels[text]) el.textContent = labels[text];
    });
    document.querySelectorAll(".form-radio-input-wrapper, .form-input-wrapper").forEach(function (el) {
      var text = (el.textContent || "").replace(/\s+/g, " ");
      if (/2026|2027|2028|2029|2030\+/.test(text) && /2026/.test(text) && /2030/.test(text)) {
        el.style.setProperty("display", "none", "important");
      }
    });
    document.querySelectorAll("input, textarea").forEach(function (el) {
      var ph = el.getAttribute("placeholder") || "";
      if (ph === "Work Email*") el.setAttribute("placeholder", "Email*");
      if (ph === "Company*") el.setAttribute("placeholder", "School or organisation");
      if (ph === "Project location*") el.setAttribute("placeholder", "Country");
    });
    document.querySelectorAll("iframe").forEach(function (el) {
      var title = el.getAttribute("title") || "";
      if (title === "Lab" || title === "In the lab" || title === "Team" || title === "First plant" || title === "Space4Climate workshop") {
        el.setAttribute("title", "Space4Climate workshop");
      }
    });
  }

  function hideLeftoverStories() {
    var leftover = /deep sky|university of sheffield|creating pioneer fuels|series a|direct air|xprize|mission zero|ga[eë]l gobaille|gaël|electrochemical|carbon sink|hottest series|oco technology|o\.c\.o|breakthrough energy|climate stories from space|plant’s lifetime|plants deliver|modularised space4climate technology|wasted wind power|sustainable construction|haulage and supply chain|advancing climate learning in construction|advancing climate learning in flight|shipping containers fixing|climate capture project|innovators under 35|third climate learning site|climate tech trends|policy matters|geological climate|future of carbon|bethnal green|gigatonne|nicholas chadwick|why learn to love climate|learning pathways from thin air|scaling climate deep tech/i;
    var leftoverHref = /deep-sky|xprize|carbon-capture|sheffield|direct-air|mission-zero|stripe-carbon|oco-technology|aviation-fuel|carbon-removal|translational-energy|uktech\.news\/climate-tech/i;
    document.querySelectorAll(".w-dyn-item, .press_item, .press_item_wrap, a.card, .card.programs, .blog-item, .lab-notes-item, .blog-card-item").forEach(function (el) {
      var html = el.innerHTML || "";
      if (leftover.test(el.textContent || "") || leftoverHref.test(html)) {
        el.style.setProperty("display", "none", "important");
      }
    });
  }

  function injectVolunteerRoles() {
    var section = document.querySelector(".section_jobs");
    if (!section || document.querySelector(".s4c-roles")) return;
    var title = section.querySelector(".jobs_title");
    var roles = document.createElement("div");
    roles.className = "s4c-roles";
    roles.innerHTML =
      '<a class="s4c-role" href="contact.html"><h3>Social Media Manager</h3><p>Facebook, TikTok, Instagram, Tumblr, and the channels young people actually use.</p></a>' +
      '<a class="s4c-role" href="contact.html"><h3>Educational Content Creator</h3><p>Space and film-making materials for the online workshop.</p></a>' +
      '<a class="s4c-role" href="contact.html"><h3>Video Editor / Film-maker</h3><p>Help students turn a climate story into a film they can share.</p></a>' +
      '<a class="s4c-role" href="contact.html"><h3>Sponsorship Hunter</h3><p>Partnerships that cover organisational costs. Registration fees go to facilitators.</p></a>';
    if (title && title.parentNode) {
      title.parentNode.insertBefore(roles, title.nextSibling);
    } else {
      section.appendChild(roles);
    }
  }

  function polishPressPage() {
    if (!/press/i.test(window.location.pathname) && !/press\.html/i.test(window.location.pathname)) return;
    if (document.querySelector(".s4c-press-note")) return;
    var host = document.querySelector(".press_contain") || document.querySelector("main, .page_main, .page-wrapper");
    if (!host) return;
    var note = document.createElement("div");
    note.className = "s4c-press-note";
    note.innerHTML =
      "<h2>Press enquiries</h2><p>For interviews, workshop coverage, or commentary on space and climate education, email <a href=\"mailto:info@space4climate.org\">info@space4climate.org</a>. Space4Climate is a volunteer organisation based in Bonn, Germany.</p>";
    host.appendChild(note);
  }

  function preventSplitTextReload() {
    var ignoreReload = false;
    var originalReload = window.location.reload.bind(window.location);
    window.addEventListener(
      "resize",
      function () {
        ignoreReload = true;
        setTimeout(function () {
          ignoreReload = false;
        }, 600);
      },
      true
    );
    window.location.reload = function (forcedReload) {
      if (ignoreReload) return;
      originalReload(forcedReload);
    };
  }

  function run() {
    ensurePerfStyles();
    ensureInterFont();
    lockSplitText();
    disarmScrollAnimations();
    repairBrokenMediaUrls();
    enhanceEmbeds();
    flattenScrollHijack();
    tameVideos();
    lazyBelowFoldImages();
    preventSplitTextReload();
    stopIx2ScrollEngine();
    killScrollTriggers();
    parkContactForm();
    flattenProgramCards();
    flattenAboutStory();
    fixAboutHeroMedia();
    enhanceDropdowns();
    ensureLoginNav();
    ensureMobileMenu();
    labelFooterLogo();
    stampCopyright();
    proofreadChrome();
    hideLeftoverStories();
    injectVolunteerRoles();
    polishPressPage();

    var passes = 0;
    var timer = setInterval(function () {
      disarmScrollAnimations();
      killScrollTriggers();
      flattenScrollHijack();
      flattenProgramCards();
      flattenAboutStory();
      fixAboutHeroMedia();
      proofreadChrome();
      hideLeftoverStories();
      injectVolunteerRoles();
      polishPressPage();
      passes += 1;
      if (passes >= 15) clearInterval(timer);
    }, 200);
  }

  ensurePerfStyles();
  ensureInterFont();
  lockSplitText();
  disarmScrollAnimations();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
}());
