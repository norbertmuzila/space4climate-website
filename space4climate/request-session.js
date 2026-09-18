/**
 * Teacher session requests.
 *
 * The teacher picks a start date/time, an end date/time and a timezone. The
 * end must fall after the start — on a single date that means the end time
 * must be later than the start time — and the form says so the moment either
 * field changes rather than waiting for a submit.
 *
 * While the window is valid the page checks it against the anonymised
 * volunteer roster, so the teacher sees whether anyone is actually free before
 * sending. The roster carries timezones and availability only; no names or
 * email addresses reach the browser.
 */
(function () {
  "use strict";

  var S = window.S4C_SCHED;
  var I = window.S4C_I18N;

  function $(id) {
    return document.getElementById(id);
  }

  function setError(el, key) {
    if (!el) return;
    el.textContent = key ? I.t(key) : "";
    el.classList.toggle("is-shown", Boolean(key));
  }

  function markInvalid(input, invalid) {
    if (input) input.classList.toggle("invalid", Boolean(invalid));
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function isoDate(date) {
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
  }

  var form = $("ses-form");
  if (!form || !S || !I) return;

  var startDate = $("ses-start-date");
  var startTime = $("ses-start-time");
  var endDate = $("ses-end-date");
  var endTime = $("ses-end-time");
  var tz = $("ses-tz");

  // Default to a session a week out, and never offer a date in the past.
  var today = new Date();
  var soon = new Date(today.getTime() + 7 * 86400000);
  startDate.value = isoDate(soon);
  endDate.value = isoDate(soon);
  startDate.min = isoDate(today);
  endDate.min = isoDate(today);

  S.fillTimezoneSelect(tz);
  if (I.lang === "de") $("ses-lang").value = "de";

  var roster = null;
  var rosterPending = null;

  function currentWindow() {
    return {
      startDate: startDate.value,
      startTime: startTime.value,
      endDate: endDate.value,
      endTime: endTime.value
    };
  }

  /**
   * Keep the end from preceding the start as the teacher types: the end date
   * can never be earlier than the start date, and when they match, the end
   * time input's own `min` enforces the rule in the picker too.
   */
  function syncConstraints() {
    if (startDate.value) {
      endDate.min = startDate.value;
      if (endDate.value && endDate.value < startDate.value) endDate.value = startDate.value;
    }
    var sameDay = startDate.value && startDate.value === endDate.value;
    if (sameDay && startTime.value) {
      endTime.min = startTime.value;
    } else {
      endTime.removeAttribute("min");
    }
  }

  function describeMatch(result) {
    if (!result.total) return I.t("ses.matchNone");
    var text = I.t("ses.matchSome", { n: result.full, total: result.total });
    if (result.partial) text += " " + I.t("ses.matchPartial", { n: result.partial });
    return text;
  }

  async function ensureRoster() {
    if (roster) return roster;
    if (!rosterPending) {
      rosterPending = S.api("/api/volunteers?roster=1")
        .then(function (data) {
          roster = (data && data.roster) || [];
          return roster;
        })
        .catch(function () {
          // Matching is a convenience; a request can still be sent without it.
          roster = [];
          return roster;
        });
    }
    return rosterPending;
  }

  async function refreshMatch() {
    var match = $("ses-match");
    var win = currentWindow();
    var issue = S.windowError(win);
    setError($("ses-window-err"), issue);
    markInvalid(endTime, issue === "err.endTimeNotAfterStart");
    markInvalid(endDate, issue === "err.endBeforeStart");
    if (issue) {
      match.textContent = "";
      return;
    }
    match.textContent = I.t("ses.matchChecking");
    var list = await ensureRoster();
    // The window may have changed while the roster was loading.
    if (S.windowError(currentWindow())) {
      match.textContent = "";
      return;
    }
    match.textContent = describeMatch(S.matchRoster(list, currentWindow(), tz.value));
  }

  [startDate, startTime, endDate, endTime, tz].forEach(function (input) {
    input.addEventListener("change", function () {
      syncConstraints();
      refreshMatch();
    });
  });

  I.onChange(function () {
    refreshMatch();
  });

  function collect() {
    var students = parseInt($("ses-students").value, 10);
    return {
      school: $("ses-school").value.trim(),
      contactName: $("ses-contact").value.trim(),
      email: $("ses-email").value.trim(),
      timezone: tz.value,
      startDate: startDate.value,
      startTime: startTime.value,
      endDate: endDate.value,
      endTime: endTime.value,
      students: Number.isInteger(students) ? students : null,
      ageGroup: $("ses-age").value,
      language: $("ses-lang").value,
      notes: $("ses-notes").value.trim()
    };
  }

  function validate(data) {
    var ok = true;

    var schoolBad = !data.school;
    setError($("ses-school-err"), schoolBad ? "err.required" : "");
    markInvalid($("ses-school"), schoolBad);
    if (schoolBad) ok = false;

    var contactBad = !data.contactName;
    setError($("ses-contact-err"), contactBad ? "err.required" : "");
    markInvalid($("ses-contact"), contactBad);
    if (contactBad) ok = false;

    var emailBad = !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email);
    setError($("ses-email-err"), emailBad ? "err.email" : "");
    markInvalid($("ses-email"), emailBad);
    if (emailBad) ok = false;

    var issue = S.windowError(data);
    setError($("ses-window-err"), issue);
    markInvalid(endTime, issue === "err.endTimeNotAfterStart");
    markInvalid(endDate, issue === "err.endBeforeStart");
    if (issue) ok = false;

    return ok;
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    setError($("ses-form-err"), "");
    var data = collect();
    if (!validate(data)) return;

    var submit = $("ses-submit");
    var label = submit.textContent;
    submit.disabled = true;
    submit.textContent = I.t("common.sending");
    try {
      var result = await S.api("/api/sessions", { method: "POST", body: data });
      $("ses-ref").value = result.id;
      form.hidden = true;
      $("ses-success").hidden = false;
      $("ses-success").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      setError($("ses-form-err"), err.message || "err.generic");
    } finally {
      submit.disabled = false;
      submit.textContent = label;
    }
  });

  syncConstraints();
  refreshMatch();
})();
