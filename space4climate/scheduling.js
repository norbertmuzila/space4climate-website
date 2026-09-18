/**
 * Shared scheduling helpers for the volunteer roster and session requests.
 *
 * Availability is stored as recurring weekly slots, "weekday-hour", where the
 * weekday follows JavaScript's getDay() numbering (0 = Sunday) and the hour is
 * two digits: "2-14" is Tuesday 14:00. Crucially those slots are in the
 * volunteer's *own* timezone, so matching a teacher's request means converting
 * every hour of the requested window into each volunteer's local weekday and
 * hour before comparing.
 */
(function () {
  "use strict";

  var DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first, Sunday last.
  var MAX_MATCH_HOURS = 24 * 21; // Guard against a pathologically long window.

  /** A fallback list for browsers without Intl.supportedValuesOf. */
  var FALLBACK_ZONES = [
    "UTC",
    "Europe/London",
    "Europe/Dublin",
    "Europe/Lisbon",
    "Europe/Madrid",
    "Europe/Paris",
    "Europe/Brussels",
    "Europe/Amsterdam",
    "Europe/Berlin",
    "Europe/Zurich",
    "Europe/Vienna",
    "Europe/Prague",
    "Europe/Warsaw",
    "Europe/Rome",
    "Europe/Stockholm",
    "Europe/Oslo",
    "Europe/Copenhagen",
    "Europe/Helsinki",
    "Europe/Athens",
    "Europe/Bucharest",
    "Europe/Kyiv",
    "Europe/Istanbul",
    "Europe/Moscow",
    "Africa/Casablanca",
    "Africa/Lagos",
    "Africa/Accra",
    "Africa/Cairo",
    "Africa/Nairobi",
    "Africa/Johannesburg",
    "Asia/Jerusalem",
    "Asia/Dubai",
    "Asia/Karachi",
    "Asia/Kolkata",
    "Asia/Dhaka",
    "Asia/Bangkok",
    "Asia/Jakarta",
    "Asia/Singapore",
    "Asia/Hong_Kong",
    "Asia/Shanghai",
    "Asia/Tokyo",
    "Asia/Seoul",
    "Australia/Perth",
    "Australia/Adelaide",
    "Australia/Brisbane",
    "Australia/Sydney",
    "Pacific/Auckland",
    "America/St_Johns",
    "America/Halifax",
    "America/New_York",
    "America/Toronto",
    "America/Chicago",
    "America/Mexico_City",
    "America/Denver",
    "America/Phoenix",
    "America/Los_Angeles",
    "America/Vancouver",
    "America/Anchorage",
    "Pacific/Honolulu",
    "America/Bogota",
    "America/Lima",
    "America/Santiago",
    "America/Sao_Paulo",
    "America/Argentina/Buenos_Aires"
  ];

  function detectTimezone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch (err) {
      return "UTC";
    }
  }

  function allZones() {
    var zones;
    try {
      zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : null;
    } catch (err) {
      zones = null;
    }
    if (!zones || !zones.length) zones = FALLBACK_ZONES.slice();
    var detected = detectTimezone();
    if (zones.indexOf(detected) === -1) zones = [detected].concat(zones);
    if (zones.indexOf("UTC") === -1) zones.push("UTC");
    return zones;
  }

  /**
   * Offset between a timezone's wall clock and UTC at a given instant.
   * Derived by formatting the instant in that zone and reading it back as if
   * it were UTC — the standard trick, and the only one available without a
   * timezone library.
   */
  function tzOffsetMs(date, tz) {
    var dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    var parts = {};
    dtf.formatToParts(date).forEach(function (part) {
      if (part.type !== "literal") parts[part.type] = part.value;
    });
    var asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour) % 24, // Some engines render midnight as "24".
      Number(parts.minute),
      Number(parts.second)
    );
    return asUtc - date.getTime();
  }

  /** Turn a wall-clock date and time in `tz` into an absolute timestamp. */
  function zonedToUtc(dateStr, timeStr, tz) {
    var d = dateStr.split("-");
    var t = timeStr.split(":");
    var naive = Date.UTC(Number(d[0]), Number(d[1]) - 1, Number(d[2]), Number(t[0]), Number(t[1]));
    // One refinement pass settles the offset across DST boundaries.
    var ts = naive - tzOffsetMs(new Date(naive), tz);
    return naive - tzOffsetMs(new Date(ts), tz);
  }

  /** The weekday and hour an instant falls on, in `tz`. */
  function zonedWeekHour(ts, tz) {
    var shifted = new Date(ts + tzOffsetMs(new Date(ts), tz));
    return shifted.getUTCDay() + "-" + String(shifted.getUTCHours()).padStart(2, "0");
  }

  function minutesOf(time) {
    var parts = time.split(":");
    return Number(parts[0]) * 60 + Number(parts[1]);
  }

  /**
   * The rule the site promises: a session must end after it starts, and on a
   * single date that means the end time must be later than the start time.
   * Returns an i18n error key, or "" when the window is valid. Mirrored by the
   * server so the API cannot be handed an impossible window directly.
   */
  function windowError(win) {
    if (!win.startDate || !win.endDate) return "err.required";
    if (!win.startTime || !win.endTime) return "err.required";
    if (win.endDate < win.startDate) return "err.endBeforeStart";
    if (win.endDate === win.startDate && minutesOf(win.endTime) <= minutesOf(win.startTime)) {
      return "err.endTimeNotAfterStart";
    }
    return "";
  }

  /** Every whole hour the window touches, as absolute timestamps. */
  function windowHours(win, tz) {
    var start = zonedToUtc(win.startDate, win.startTime, tz);
    var end = zonedToUtc(win.endDate, win.endTime, tz);
    var hours = [];
    for (var ts = start; ts < end && hours.length < MAX_MATCH_HOURS; ts += 3600000) {
      hours.push(ts);
    }
    return hours;
  }

  /**
   * How many people on the roster can cover the requested window.
   * `full` covers every hour of it; `partial` covers some but not all.
   */
  function matchRoster(roster, win, tz) {
    var hours = windowHours(win, tz);
    var result = { full: 0, partial: 0, total: roster.length, hours: hours.length };
    if (!hours.length) return result;
    roster.forEach(function (person) {
      var zone = person.timezone || "UTC";
      var slots = person.slots || [];
      var covered = 0;
      for (var i = 0; i < hours.length; i++) {
        if (slots.indexOf(zonedWeekHour(hours[i], zone)) !== -1) covered++;
      }
      if (covered === hours.length) result.full++;
      else if (covered > 0) result.partial++;
    });
    return result;
  }

  /* ── UI helpers ───────────────────────────────────────────────────── */

  function fillTimezoneSelect(select, selected) {
    var zones = allZones();
    var detected = detectTimezone();
    select.innerHTML = "";
    zones.forEach(function (zone) {
      var option = document.createElement("option");
      option.value = zone;
      option.textContent = zone === detected ? zone + " — detected" : zone.replace(/_/g, " ");
      select.appendChild(option);
    });
    select.value = selected && zones.indexOf(selected) !== -1 ? selected : detected;
  }

  function dayLabels(locale) {
    // A known week starting Sunday 2024-01-07, formatted in the active locale.
    return DAY_ORDER.map(function (day) {
      var date = new Date(Date.UTC(2024, 0, 7 + day));
      return new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(date);
    });
  }

  /**
   * A click-or-drag weekly availability grid.
   * Returns a controller exposing the current selection.
   */
  function weeklyGrid(container, options) {
    var opts = options || {};
    var fromHour = opts.fromHour === undefined ? 6 : opts.fromHour;
    var toHour = opts.toHour === undefined ? 22 : opts.toHour;
    var selected = {};
    var cells = {};
    var painting = false;
    var paintTo = true;

    function notify() {
      if (typeof opts.onChange === "function") opts.onChange(list());
    }

    function list() {
      return Object.keys(selected).filter(function (key) {
        return selected[key];
      });
    }

    function paint(key, on) {
      selected[key] = on;
      var cell = cells[key];
      if (cell) {
        cell.classList.toggle("is-on", on);
        cell.setAttribute("aria-pressed", on ? "true" : "false");
      }
    }

    function render(locale) {
      var labels = dayLabels(locale || "en");
      var table = document.createElement("table");
      table.className = "week-grid";
      var head = document.createElement("thead");
      var headRow = document.createElement("tr");
      headRow.appendChild(document.createElement("th"));
      labels.forEach(function (label) {
        var th = document.createElement("th");
        th.scope = "col";
        th.textContent = label;
        headRow.appendChild(th);
      });
      head.appendChild(headRow);
      table.appendChild(head);

      var body = document.createElement("tbody");
      cells = {};
      for (var hour = fromHour; hour < toHour; hour++) {
        var row = document.createElement("tr");
        var th = document.createElement("th");
        th.scope = "row";
        th.className = "week-grid-hour";
        th.textContent = String(hour).padStart(2, "0") + ":00";
        row.appendChild(th);
        DAY_ORDER.forEach(function (day, index) {
          var key = day + "-" + String(hour).padStart(2, "0");
          var td = document.createElement("td");
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "week-cell";
          btn.dataset.slot = key;
          btn.setAttribute("aria-pressed", selected[key] ? "true" : "false");
          btn.setAttribute(
            "aria-label",
            labels[index] + " " + String(hour).padStart(2, "0") + ":00"
          );
          if (selected[key]) btn.classList.add("is-on");
          cells[key] = btn;
          td.appendChild(btn);
          row.appendChild(td);
        });
        body.appendChild(row);
      }
      table.appendChild(body);
      container.innerHTML = "";
      container.appendChild(table);
    }

    container.addEventListener("pointerdown", function (event) {
      var btn = event.target.closest(".week-cell");
      if (!btn) return;
      event.preventDefault();
      painting = true;
      paintTo = !selected[btn.dataset.slot];
      paint(btn.dataset.slot, paintTo);
      notify();
    });

    container.addEventListener("pointerover", function (event) {
      if (!painting) return;
      var btn = event.target.closest(".week-cell");
      if (!btn) return;
      if (selected[btn.dataset.slot] !== paintTo) {
        paint(btn.dataset.slot, paintTo);
        notify();
      }
    });

    // Keyboard users toggle a single cell at a time.
    container.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      var btn = event.target.closest(".week-cell");
      if (!btn) return;
      event.preventDefault();
      paint(btn.dataset.slot, !selected[btn.dataset.slot]);
      notify();
    });

    ["pointerup", "pointercancel"].forEach(function (name) {
      window.addEventListener(name, function () {
        painting = false;
      });
    });

    return {
      render: render,
      list: list,
      set: function (slots) {
        selected = {};
        (slots || []).forEach(function (slot) {
          selected[slot] = true;
        });
        Object.keys(cells).forEach(function (key) {
          paint(key, Boolean(selected[key]));
        });
        notify();
      },
      clear: function () {
        Object.keys(selected).forEach(function (key) {
          paint(key, false);
        });
        selected = {};
        notify();
      },
      addRange: function (days, from, to) {
        days.forEach(function (day) {
          for (var hour = from; hour < to; hour++) {
            paint(day + "-" + String(hour).padStart(2, "0"), true);
          }
        });
        notify();
      }
    };
  }

  /** POST/PUT/GET JSON, surfacing the server's error key to the caller. */
  async function api(path, options) {
    var opts = options || {};
    var res;
    try {
      res = await fetch(path, {
        method: opts.method || "GET",
        headers: opts.body ? { "Content-Type": "application/json" } : undefined,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        cache: "no-store"
      });
    } catch (err) {
      throw new Error("err.network");
    }
    var data = null;
    try {
      data = await res.json();
    } catch (err) {
      data = null;
    }
    if (!res.ok) {
      var code = data && data.error ? data.error : "";
      if (code === "storage_unconfigured") throw new Error("err.storage");
      if (code === "invalid_email") throw new Error("err.email");
      if (code === "invalid_timezone") throw new Error("err.timezone");
      if (code === "no_availability") throw new Error("err.noAvailability");
      if (code === "end_before_start") throw new Error("err.endBeforeStart");
      if (code === "end_time_not_after_start") throw new Error("err.endTimeNotAfterStart");
      if (code === "missing_name" || code === "missing_school") throw new Error("err.required");
      throw new Error("err.generic");
    }
    return data;
  }

  window.S4C_SCHED = {
    DAY_ORDER: DAY_ORDER,
    api: api,
    detectTimezone: detectTimezone,
    fillTimezoneSelect: fillTimezoneSelect,
    matchRoster: matchRoster,
    weeklyGrid: weeklyGrid,
    windowError: windowError,
    zonedToUtc: zonedToUtc,
    zonedWeekHour: zonedWeekHour
  };
})();
