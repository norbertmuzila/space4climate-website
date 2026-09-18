/**
 * Volunteer availability registration.
 *
 * A volunteer paints the hours they are usually free onto a weekly grid, in
 * their own timezone, and that pattern is stored against their details. The
 * response carries a private edit token; the page keeps it in the URL so the
 * volunteer can come back and change their hours later.
 */
(function () {
  "use strict";

  var S = window.S4C_SCHED;
  var I = window.S4C_I18N;
  var WEEKDAYS = [1, 2, 3, 4, 5]; // Monday–Friday, for the quick presets.

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

  var form = $("vol-form");
  if (!form || !S || !I) return;

  var grid = S.weeklyGrid($("vol-grid"), {
    fromHour: 6,
    toHour: 22,
    onChange: function (slots) {
      var count = slots.length;
      var key = count === 0 ? "vol.selectedNone" : count === 1 ? "vol.selectedOne" : "vol.selectedMany";
      $("vol-count").textContent = I.t(key, { n: count });
      if (count) setError($("vol-grid-err"), "");
    }
  });

  var editing = null; // { id, token } when revisiting an existing registration.

  function renderGrid() {
    var slots = grid.list();
    grid.render(I.lang);
    grid.set(slots);
  }

  S.fillTimezoneSelect($("vol-tz"));
  renderGrid();

  // Re-render so weekday names and the counter follow the chosen language.
  I.onChange(function () {
    renderGrid();
    if (editing) $("editing-note").hidden = false;
  });

  $("preset-mornings").addEventListener("click", function () {
    grid.addRange(WEEKDAYS, 9, 12);
  });
  $("preset-afternoons").addEventListener("click", function () {
    grid.addRange(WEEKDAYS, 13, 17);
  });
  $("grid-clear").addEventListener("click", function () {
    grid.clear();
  });

  function collect() {
    var languages = Array.prototype.slice
      .call(form.querySelectorAll('input[name="languages"]:checked'))
      .map(function (input) {
        return input.value;
      });
    return {
      name: $("vol-name").value.trim(),
      email: $("vol-email").value.trim(),
      organisation: $("vol-org").value.trim(),
      timezone: $("vol-tz").value,
      languages: languages,
      slots: grid.list(),
      notes: $("vol-notes").value.trim()
    };
  }

  function validate(data) {
    var ok = true;
    var nameBad = !data.name;
    setError($("vol-name-err"), nameBad ? "err.required" : "");
    markInvalid($("vol-name"), nameBad);
    if (nameBad) ok = false;

    var emailBad = !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email);
    setError($("vol-email-err"), emailBad ? "err.email" : "");
    markInvalid($("vol-email"), emailBad);
    if (emailBad) ok = false;

    var tzBad = !data.timezone;
    setError($("vol-tz-err"), tzBad ? "err.timezone" : "");
    if (tzBad) ok = false;

    var slotsBad = !data.slots.length;
    setError($("vol-grid-err"), slotsBad ? "err.noAvailability" : "");
    if (slotsBad) ok = false;

    return ok;
  }

  /** Load an existing registration when the URL carries id and token. */
  async function loadExisting() {
    var params = new URL(window.location.href).searchParams;
    var id = params.get("id");
    var token = params.get("token");
    if (!id || !token) return;
    try {
      var data = await S.api(
        "/api/volunteers?id=" + encodeURIComponent(id) + "&token=" + encodeURIComponent(token)
      );
      var v = data.volunteer;
      editing = { id: id, token: token };
      $("vol-name").value = v.name || "";
      $("vol-email").value = v.email || "";
      $("vol-org").value = v.organisation || "";
      $("vol-notes").value = v.notes || "";
      if (v.timezone) S.fillTimezoneSelect($("vol-tz"), v.timezone);
      Array.prototype.forEach.call(form.querySelectorAll('input[name="languages"]'), function (input) {
        input.checked = (v.languages || []).indexOf(input.value) !== -1;
      });
      grid.set(v.slots || []);
      $("editing-note").hidden = false;
      $("vol-submit").textContent = I.t("vol.update");
    } catch (err) {
      // A stale or wrong link simply falls back to a blank registration form.
    }
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    setError($("vol-form-err"), "");
    var data = collect();
    if (!validate(data)) return;

    var submit = $("vol-submit");
    var label = submit.textContent;
    submit.disabled = true;
    submit.textContent = I.t("common.sending");
    try {
      var path = editing
        ? "/api/volunteers?id=" + encodeURIComponent(editing.id) + "&token=" + encodeURIComponent(editing.token)
        : "/api/volunteers";
      var result = await S.api(path, { method: editing ? "PUT" : "POST", body: data });
      var id = editing ? editing.id : result.id;
      var token = editing ? editing.token : result.token;
      var link =
        window.location.origin +
        window.location.pathname +
        "?id=" + encodeURIComponent(id) +
        "&token=" + encodeURIComponent(token);
      $("vol-link").value = link;
      form.hidden = true;
      $("vol-success").hidden = false;
      $("vol-success").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      setError($("vol-form-err"), err.message || "err.generic");
    } finally {
      submit.disabled = false;
      submit.textContent = label;
    }
  });

  $("vol-copy").addEventListener("click", async function () {
    var input = $("vol-link");
    try {
      await navigator.clipboard.writeText(input.value);
    } catch (err) {
      // Clipboard access is often blocked; selecting the text still helps.
      input.select();
    }
    var button = $("vol-copy");
    button.textContent = I.t("vol.copied");
    setTimeout(function () {
      button.textContent = I.t("vol.copy");
    }, 2000);
  });

  loadExisting();
})();
