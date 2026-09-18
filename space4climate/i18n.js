/**
 * Space4Climate — English / German switching.
 *
 * Two translation mechanisms, because the site is a mix of exported pages and
 * hand-written ones:
 *
 *   1. Exact-text translation, scoped to the navigation and footer. The 31
 *      exported pages share identical chrome markup, so translating by exact
 *      English string avoids editing every page to add markers, and the tight
 *      scope keeps a word like "Space" from being rewritten inside articles.
 *
 *   2. Key-based translation via data-i18n attributes, used by the pages we
 *      author ourselves (volunteer registration, session requests) where the
 *      full string set is known up front.
 *
 * Long-form article and legal copy stays in English by design: shipping
 * unreviewed machine German on a schools site would be worse than not
 * offering it.
 */
(function () {
  "use strict";

  var STORE_KEY = "s4c-lang";
  var SUPPORTED = ["en", "de"];
  var SCOPES = ".nav_wrap, .nav_component, footer.footer_wrap, [data-i18n-scope]";

  /* ── 1. Chrome: exact English → German ─────────────────────────────── */
  var CHROME_DE = {
    "Technology": "Technologie",
    "Solutions": "Lösungen",
    "Back": "Zurück",
    "Industries": "Bereiche",
    "Space": "Weltraum",
    "Climate": "Klima",
    "Film-making": "Filmemachen",
    "Learn more": "Mehr erfahren",
    "Read more": "Weiterlesen",
    "Go to Space page": "Zur Seite „Weltraum“",
    "Go to Climate page": "Zur Seite „Klima“",
    "Go to Film-making page": "Zur Seite „Filmemachen“",
    "About us": "Über uns",
    "About": "Über uns",
    "Company": "Organisation",
    "Programs": "Programme",
    "Volunteer Roles": "Ehrenamtliche Rollen",
    "Thoughts": "Beiträge",
    "Reports": "Berichte",
    "Resources": "Material",
    "Student Success Stories": "Erfolgsgeschichten",
    "Learning Resources": "Lernmaterialien",
    "Updates": "Neuigkeiten",
    "Orbit Scheduler": "Orbit-Terminplaner",
    "Case Study": "Fallstudie",
    "Guide": "Leitfaden",
    "Contact": "Kontakt",
    "Legals": "Rechtliches",
    "What we offer": "Unser Angebot",
    "Climate Education": "Klimabildung",
    "Footer": "Fußbereich",
    "Sign up to our newsletter": "Newsletter abonnieren",
    "Enter email address": "E-Mail-Adresse eingeben",
    "Subscribe": "Abonnieren",
    "Please wait...": "Bitte warten …",
    "Success": "Geschafft",
    "Oops! Something went wrong while submitting the form.":
      "Ups! Beim Absenden des Formulars ist etwas schiefgelaufen.",
    // Most pages separate these with a non-breaking space and a few with an
    // ordinary one; the exact-text match needs both spellings.
    "Space4Climate.  All rights reserved.": "Space4Climate.  Alle Rechte vorbehalten.",
    "Space4Climate. All rights reserved.": "Space4Climate. Alle Rechte vorbehalten.",
    // Screen-reader labels, which are chrome as much as the visible text is.
    "Solutions Dropdown Toggle": "Menü „Lösungen“ öffnen",
    "About us Dropdown Toggle": "Menü „Über uns“ öffnen",
    "Resources Dropdown Toggle": "Menü „Material“ öffnen",
    "Back Button": "Zurück",
    "Contact Us": "Kontakt aufnehmen",
    "Menu Open": "Menü öffnen",
    "View climate storytelling and digital learning programs":
      "Klima-Storytelling und digitale Lernprogramme ansehen",
    "Hands-on Space & Climate Workshops for Young Innovators":
      "Praxisnahe Weltraum- und Klima-Workshops für junge Talente",
    "Home Page": "Startseite",
    "Volunteer availability": "Verfügbarkeit eintragen",
    "Request a session": "Workshop anfragen"
  };

  /* ── 2. Pages we author: key → text ────────────────────────────────── */
  var KEYS = {
    en: {
      "vol.title": "Register your availability",
      "vol.lede":
        "Tell us the hours you are usually free and we will match you with schools in your window. You can update this at any time.",
      "vol.name": "Your name",
      "vol.namePlaceholder": "Ada Lovelace",
      "vol.email": "Email address",
      "vol.emailPlaceholder": "you@example.org",
      "vol.org": "School or organisation (optional)",
      "vol.orgPlaceholder": "Where you are based",
      "vol.timezone": "Your timezone",
      "vol.timezoneHint": "Your weekly hours are stored in this timezone and converted for each school.",
      "vol.languages": "Languages you can facilitate in",
      "vol.grid": "When are you usually free?",
      "vol.gridHint": "Click or drag to select the hours you can usually run a session. This repeats every week.",
      "vol.selectedNone": "No hours selected yet",
      "vol.selectedOne": "1 hour selected",
      "vol.selectedMany": "{n} hours selected",
      "vol.clear": "Clear all",
      "vol.workdays": "Weekday mornings",
      "vol.afternoons": "Weekday afternoons",
      "vol.notes": "Anything we should know? (optional)",
      "vol.notesPlaceholder": "Subjects you love, age groups you prefer, notice you need…",
      "vol.submit": "Register availability",
      "vol.update": "Save changes",
      "vol.successTitle": "You are on the roster",
      "vol.successBody":
        "Thank you. Keep the link below if you want to change your hours later — it is the only way back into your registration.",
      "vol.yourLink": "Your private edit link",
      "vol.copy": "Copy link",
      "vol.copied": "Copied",
      "vol.editing": "You are editing an existing registration.",
      "vol.another": "Register someone else",

      "ses.title": "Request a workshop",
      "ses.lede":
        "Choose the window that works for your class. We will match it against our facilitators' availability and confirm by email.",
      "ses.school": "School or organisation",
      "ses.schoolPlaceholder": "Greenfield Primary School",
      "ses.contact": "Your name",
      "ses.contactPlaceholder": "Ada Lovelace",
      "ses.email": "Email address",
      "ses.emailPlaceholder": "you@school.org",
      "ses.window": "When would you like the session?",
      "ses.startDate": "Start date",
      "ses.startTime": "Start time",
      "ses.endDate": "End date",
      "ses.endTime": "End time",
      "ses.timezone": "Timezone",
      "ses.timezoneHint": "Every time on this page is in the timezone you pick here.",
      "ses.students": "Number of students (optional)",
      "ses.ageGroup": "Age group (optional)",
      "ses.ageAny": "Any age group",
      "ses.language": "Preferred workshop language",
      "ses.notes": "Anything else? (optional)",
      "ses.notesPlaceholder": "Topics you are covering, room setup, accessibility needs…",
      "ses.submit": "Request this session",
      "ses.matchChecking": "Checking facilitator availability…",
      "ses.matchNone": "No facilitators are registered for this window yet — you can still send the request.",
      "ses.matchSome": "{n} of {total} facilitators are free for this whole window.",
      "ses.matchPartial": "{n} more could cover part of it.",
      "ses.successTitle": "Request sent",
      "ses.successBody":
        "Thank you. We will confirm by email. Keep the reference below if you need to ask us about this request.",
      "ses.reference": "Your reference",
      "ses.another": "Request another session",

      "err.required": "This field is required.",
      "err.email": "Enter a valid email address.",
      "err.timezone": "Choose a timezone.",
      "err.noAvailability": "Select at least one hour you are free.",
      "err.endBeforeStart": "The end date cannot be before the start date.",
      "err.endTimeNotAfterStart": "The end time must be after the start time on the same day.",
      "err.startInPast": "Choose a date that has not already passed.",
      "err.network": "We could not reach the server. Please try again.",
      "err.storage":
        "Registration is not switched on for this deployment yet. Set KV_REST_API_URL and KV_REST_API_TOKEN, then try again.",
      "err.generic": "Something went wrong. Please check the form and try again.",
      "common.optional": "optional",
      "common.sending": "Sending…"
    },
    de: {
      "vol.title": "Verfügbarkeit eintragen",
      "vol.lede":
        "Sagen Sie uns, wann Sie üblicherweise Zeit haben, und wir bringen Sie mit Schulen in Ihrem Zeitfenster zusammen. Sie können das jederzeit ändern.",
      "vol.name": "Ihr Name",
      "vol.namePlaceholder": "Ada Lovelace",
      "vol.email": "E-Mail-Adresse",
      "vol.emailPlaceholder": "sie@beispiel.org",
      "vol.org": "Schule oder Organisation (optional)",
      "vol.orgPlaceholder": "Wo Sie ansässig sind",
      "vol.timezone": "Ihre Zeitzone",
      "vol.timezoneHint":
        "Ihre Wochenstunden werden in dieser Zeitzone gespeichert und für jede Schule umgerechnet.",
      "vol.languages": "Sprachen, in denen Sie moderieren können",
      "vol.grid": "Wann haben Sie üblicherweise Zeit?",
      "vol.gridHint":
        "Klicken oder ziehen Sie, um die Stunden auszuwählen, in denen Sie einen Workshop leiten können. Das wiederholt sich jede Woche.",
      "vol.selectedNone": "Noch keine Stunden ausgewählt",
      "vol.selectedOne": "1 Stunde ausgewählt",
      "vol.selectedMany": "{n} Stunden ausgewählt",
      "vol.clear": "Alles zurücksetzen",
      "vol.workdays": "Werktags vormittags",
      "vol.afternoons": "Werktags nachmittags",
      "vol.notes": "Sonst noch etwas? (optional)",
      "vol.notesPlaceholder": "Lieblingsthemen, bevorzugte Altersgruppen, nötige Vorlaufzeit …",
      "vol.submit": "Verfügbarkeit eintragen",
      "vol.update": "Änderungen speichern",
      "vol.successTitle": "Sie stehen auf der Liste",
      "vol.successBody":
        "Vielen Dank. Bewahren Sie den Link unten auf, falls Sie Ihre Zeiten später ändern möchten — nur darüber kommen Sie wieder in Ihre Anmeldung.",
      "vol.yourLink": "Ihr privater Bearbeitungslink",
      "vol.copy": "Link kopieren",
      "vol.copied": "Kopiert",
      "vol.editing": "Sie bearbeiten eine bestehende Anmeldung.",
      "vol.another": "Weitere Person eintragen",

      "ses.title": "Workshop anfragen",
      "ses.lede":
        "Wählen Sie das Zeitfenster, das für Ihre Klasse passt. Wir gleichen es mit der Verfügbarkeit unserer Moderator:innen ab und bestätigen per E-Mail.",
      "ses.school": "Schule oder Organisation",
      "ses.schoolPlaceholder": "Grundschule Grünfeld",
      "ses.contact": "Ihr Name",
      "ses.contactPlaceholder": "Ada Lovelace",
      "ses.email": "E-Mail-Adresse",
      "ses.emailPlaceholder": "sie@schule.org",
      "ses.window": "Wann soll der Workshop stattfinden?",
      "ses.startDate": "Startdatum",
      "ses.startTime": "Startzeit",
      "ses.endDate": "Enddatum",
      "ses.endTime": "Endzeit",
      "ses.timezone": "Zeitzone",
      "ses.timezoneHint": "Alle Zeiten auf dieser Seite gelten in der hier gewählten Zeitzone.",
      "ses.students": "Anzahl der Schüler:innen (optional)",
      "ses.ageGroup": "Altersgruppe (optional)",
      "ses.ageAny": "Beliebige Altersgruppe",
      "ses.language": "Gewünschte Workshop-Sprache",
      "ses.notes": "Sonst noch etwas? (optional)",
      "ses.notesPlaceholder": "Ihre Themen, Raumausstattung, Bedarf an Barrierefreiheit …",
      "ses.submit": "Workshop anfragen",
      "ses.matchChecking": "Verfügbarkeit der Moderator:innen wird geprüft …",
      "ses.matchNone":
        "Für dieses Zeitfenster ist noch niemand eingetragen — Sie können die Anfrage trotzdem senden.",
      "ses.matchSome": "{n} von {total} Moderator:innen haben im gesamten Zeitfenster Zeit.",
      "ses.matchPartial": "{n} weitere könnten einen Teil übernehmen.",
      "ses.successTitle": "Anfrage gesendet",
      "ses.successBody":
        "Vielen Dank. Wir bestätigen per E-Mail. Bewahren Sie die Referenz unten auf, falls Sie zu dieser Anfrage nachfragen möchten.",
      "ses.reference": "Ihre Referenz",
      "ses.another": "Weiteren Workshop anfragen",

      "err.required": "Dieses Feld ist erforderlich.",
      "err.email": "Bitte geben Sie eine gültige E-Mail-Adresse ein.",
      "err.timezone": "Bitte wählen Sie eine Zeitzone.",
      "err.noAvailability": "Wählen Sie mindestens eine Stunde aus, in der Sie Zeit haben.",
      "err.endBeforeStart": "Das Enddatum darf nicht vor dem Startdatum liegen.",
      "err.endTimeNotAfterStart": "Am selben Tag muss die Endzeit nach der Startzeit liegen.",
      "err.startInPast": "Bitte wählen Sie ein Datum, das noch nicht vergangen ist.",
      "err.network": "Der Server war nicht erreichbar. Bitte versuchen Sie es erneut.",
      "err.storage":
        "Die Anmeldung ist für diese Installation noch nicht aktiviert. Setzen Sie KV_REST_API_URL und KV_REST_API_TOKEN und versuchen Sie es erneut.",
      "err.generic": "Etwas ist schiefgelaufen. Bitte prüfen Sie das Formular und versuchen Sie es erneut.",
      "common.optional": "optional",
      "common.sending": "Wird gesendet …"
    }
  };

  var current = "en";
  var listeners = [];

  function readStored() {
    try {
      var stored = window.localStorage.getItem(STORE_KEY);
      if (SUPPORTED.indexOf(stored) !== -1) return stored;
    } catch (err) {
      /* Private mode and blocked storage both land here; English is fine. */
    }
    return "";
  }

  function fromUrl() {
    try {
      var value = new URL(window.location.href).searchParams.get("lang");
      return SUPPORTED.indexOf(value) !== -1 ? value : "";
    } catch (err) {
      return "";
    }
  }

  function persist(lang) {
    try {
      window.localStorage.setItem(STORE_KEY, lang);
    } catch (err) {
      /* Nothing to do: the choice simply will not survive the next page. */
    }
  }

  function t(key, vars) {
    var table = KEYS[current] || KEYS.en;
    var text = table[key];
    if (text === undefined) text = KEYS.en[key];
    if (text === undefined) return key;
    if (vars) {
      Object.keys(vars).forEach(function (name) {
        text = text.split("{" + name + "}").join(String(vars[name]));
      });
    }
    return text;
  }

  /* ── Chrome translation ─────────────────────────────────────────────── */

  var ATTRS = ["placeholder", "aria-label", "title", "alt", "data-wait"];

  function translateChromeText(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      var original = node.__s4cOriginal;
      if (original === undefined) {
        original = node.nodeValue;
        // Only remember nodes we might ever translate, to keep this cheap.
        if (!CHROME_DE[original.trim()]) continue;
        node.__s4cOriginal = original;
      }
      var key = original.trim();
      if (current === "de" && CHROME_DE[key]) {
        node.nodeValue = original.replace(key, CHROME_DE[key]);
      } else {
        node.nodeValue = original;
      }
    }
  }

  function translateChromeAttrs(root) {
    var nodes = root.querySelectorAll("[" + ATTRS.join("],[") + "]");
    Array.prototype.forEach.call(nodes, function (el) {
      ATTRS.forEach(function (attr) {
        var value = el.getAttribute(attr);
        if (value === null) return;
        var store = "__s4cAttr_" + attr;
        if (el[store] === undefined) {
          if (!CHROME_DE[value.trim()]) return;
          el[store] = value;
        }
        var key = el[store].trim();
        el.setAttribute(attr, current === "de" && CHROME_DE[key] ? CHROME_DE[key] : el[store]);
      });
    });
    // Submit buttons carry their label in value=, not in a text node.
    Array.prototype.forEach.call(root.querySelectorAll('input[type="submit"]'), function (el) {
      if (el.__s4cValue === undefined) {
        if (!CHROME_DE[el.value.trim()]) return;
        el.__s4cValue = el.value;
      }
      var key = el.__s4cValue.trim();
      el.value = current === "de" && CHROME_DE[key] ? CHROME_DE[key] : el.__s4cValue;
    });
  }

  /* ── Key-based translation ──────────────────────────────────────────── */

  function translateKeyed(root) {
    Array.prototype.forEach.call(root.querySelectorAll("[data-i18n]"), function (el) {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    Array.prototype.forEach.call(root.querySelectorAll("[data-i18n-placeholder]"), function (el) {
      el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
    });
    Array.prototype.forEach.call(root.querySelectorAll("[data-i18n-label]"), function (el) {
      el.setAttribute("aria-label", t(el.getAttribute("data-i18n-label")));
    });
  }

  function apply() {
    document.documentElement.setAttribute("lang", current);
    var scopes = document.querySelectorAll(SCOPES);
    Array.prototype.forEach.call(scopes, function (scope) {
      translateChromeText(scope);
      translateChromeAttrs(scope);
    });
    translateKeyed(document);
    Array.prototype.forEach.call(document.querySelectorAll("[data-lang-btn]"), function (btn) {
      var isActive = btn.getAttribute("data-lang-btn") === current;
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
      btn.classList.toggle("is-active", isActive);
    });
    listeners.forEach(function (fn) {
      try {
        fn(current);
      } catch (err) {
        /* One bad listener must not stop the rest of the page translating. */
      }
    });
  }

  function setLang(lang) {
    if (SUPPORTED.indexOf(lang) === -1 || lang === current) return;
    current = lang;
    persist(lang);
    apply();
  }

  // The switcher is injected into the nav on every page, so bind by delegation
  // rather than hunting for buttons that may not exist yet.
  document.addEventListener("click", function (event) {
    var btn = event.target.closest ? event.target.closest("[data-lang-btn]") : null;
    if (!btn) return;
    event.preventDefault();
    setLang(btn.getAttribute("data-lang-btn"));
  });

  current = readStored() || fromUrl() || "en";

  window.S4C_I18N = {
    supported: SUPPORTED.slice(),
    get lang() {
      return current;
    },
    setLang: setLang,
    t: t,
    apply: apply,
    onChange: function (fn) {
      if (typeof fn === "function") listeners.push(fn);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", apply);
  } else {
    apply();
  }
})();
