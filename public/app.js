/**
 * PX Bot Frontend v1.1
 */
(function () {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  let state = {
    page: "dashboard",
    usersPage: 1,
    usersQuery: "",
    blockedOnly: false,
    usersTotalPages: 1,
  };

  async function api(path, opts = {}) {
    const res = await fetch(`/api${path}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
      ...opts,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || "Error"), { status: res.status, data });
    return data;
  }

  function show(view) {
    $("#login-view").classList.add("hidden");
    $("#change-pass-view").classList.add("hidden");
    $("#app-view").classList.add("hidden");
    $(`#${view}-view`)?.classList.remove("hidden");
  }

  function navigate(page) {
    state.page = page;
    $$("[data-page]").forEach((el) => el.classList.toggle("active", el.dataset.page === page));
    $$("main > section").forEach((s) => s.classList.add("hidden"));
    $(`#page-${page}`)?.classList.remove("hidden");
    if (page === "dashboard") loadStats();
    if (page === "users") loadUsers();
    if (page === "schedules") loadSchedules();
    if (page === "settings") loadSettings();
  }

  async function checkAuth() {
    try {
      const me = await api("/auth/me");
      if (me.mustChange) show("change-pass");
      else { show("app"); navigate("dashboard"); }
    } catch { show("login"); }
  }

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#login-error");
    err.classList.add("hidden");
    try {
      const data = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ password: $("#login-password").value }),
      });
      if (data.mustChange) show("change-pass");
      else { show("app"); navigate("dashboard"); }
    } catch (ex) {
      err.textContent = ex.message || "ورود ناموفق";
      err.classList.remove("hidden");
    }
  });

  $("#change-pass-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#change-pass-error");
    err.classList.add("hidden");
    const p1 = $("#new-password").value;
    const p2 = $("#new-password2").value;
    if (p1 !== p2) { err.textContent = "رمزها یکسان نیستند"; err.classList.remove("hidden"); return; }
    try {
      await api("/auth/password", { method: "POST", body: JSON.stringify({ password: p1 }) });
      show("app"); navigate("dashboard");
    } catch (ex) {
      err.textContent = ex.message || "خطا";
      err.classList.remove("hidden");
    }
  });

  $("#btn-logout").addEventListener("click", async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    show("login");
  });

  $$("[data-page]").forEach((el) => el.addEventListener("click", () => navigate(el.dataset.page)));

  async function loadStats() {
    try {
      const d = await api("/stats");
      $("#stat-total").textContent = d.total.toLocaleString("fa-IR");
      $("#stat-active").textContent = d.active24h.toLocaleString("fa-IR");
      $("#stat-blocked").textContent = d.blocked.toLocaleString("fa-IR");
      $("#stat-schedules").textContent = (d.schedules || 0).toLocaleString("fa-IR");
    } catch {}
  }

  function formatDate(ts) {
    if (!ts) return "—";
    return new Date(ts).toLocaleString("fa-IR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  function userName(u) {
    return [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || "بدون نام";
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  async function loadUsers() {
    const tbody = $("#users-tbody");
    tbody.innerHTML = `<tr><td colspan="5" class="px-5 py-8 text-center text-slate-500 text-sm">در حال بارگذاری...</td></tr>`;
    try {
      const q = new URLSearchParams({ page: state.usersPage, q: state.usersQuery, blocked: state.blockedOnly ? "1" : "0" });
      const d = await api(`/users?${q}`);
      state.usersTotalPages = d.pages;
      $("#users-meta").textContent = `${d.total.toLocaleString("fa-IR")} کاربر · صفحه ${d.page} از ${d.pages}`;
      $("#users-page").textContent = d.page;
      $("#users-prev").disabled = d.page <= 1;
      $("#users-next").disabled = d.page >= d.pages;
      if (!d.users.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="px-5 py-8 text-center text-slate-500 text-sm">کاربری یافت نشد</td></tr>`;
        return;
      }
      tbody.innerHTML = d.users.map((u) => `
        <tr class="table-row">
          <td class="px-5 py-3.5">
            <div class="font-medium text-slate-100">${escapeHtml(userName(u))}</div>
            ${u.username ? `<div class="text-xs text-slate-500 mt-0.5">@${escapeHtml(u.username)}</div>` : ""}
          </td>
          <td class="px-5 py-3.5 tabular-nums text-slate-300 font-mono text-xs">${u.id}</td>
          <td class="px-5 py-3.5">${u.blocked ? `<span class="badge-red">مسدود</span>` : `<span class="badge-green">فعال</span>`}</td>
          <td class="px-5 py-3.5 text-slate-400 text-xs">${formatDate(u.lastSeen)}</td>
          <td class="px-5 py-3.5 text-left">
            ${u.blocked
              ? `<button data-unblock="${u.id}" class="btn-success text-xs px-3 py-1.5">رفع مسدودیت</button>`
              : `<button data-block="${u.id}" class="btn-danger text-xs px-3 py-1.5">مسدود</button>`}
          </td>
        </tr>`).join("");
      tbody.querySelectorAll("[data-block]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          await api(`/users/${btn.dataset.block}/block`, { method: "POST" });
          loadUsers(); loadStats();
        });
      });
      tbody.querySelectorAll("[data-unblock]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          await api(`/users/${btn.dataset.unblock}/unblock`, { method: "POST" });
          loadUsers(); loadStats();
        });
      });
    } catch (ex) {
      tbody.innerHTML = `<tr><td colspan="5" class="px-5 py-8 text-center text-rose-400 text-sm">${escapeHtml(ex.message)}</td></tr>`;
    }
  }

  let searchTimer;
  $("#users-search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.usersQuery = e.target.value.trim();
      state.usersPage = 1;
      loadUsers();
    }, 320);
  });
  $("#filter-blocked").addEventListener("click", () => {
    state.blockedOnly = !state.blockedOnly;
    state.usersPage = 1;
    $("#filter-blocked").classList.toggle("bg-rose-500/20", state.blockedOnly);
    $("#filter-blocked").classList.toggle("text-rose-300", state.blockedOnly);
    loadUsers();
  });
  $("#users-prev").addEventListener("click", () => { if (state.usersPage > 1) { state.usersPage--; loadUsers(); } });
  $("#users-next").addEventListener("click", () => { if (state.usersPage < state.usersTotalPages) { state.usersPage++; loadUsers(); } });

  // Broadcast
  $("#btn-broadcast").addEventListener("click", async () => {
    const text = $("#broadcast-text").value.trim();
    if (!text) return;
    const btn = $("#btn-broadcast");
    const res = $("#broadcast-result");
    btn.disabled = true;
    res.classList.remove("hidden");
    res.textContent = "در حال ارسال...";
    try {
      const d = await api("/broadcast", { method: "POST", body: JSON.stringify({ text }) });
      res.textContent = `ارسال شد: ${d.sent} · ناموفق: ${d.failed}`;
      res.className = "text-xs text-emerald-400";
    } catch (ex) {
      res.textContent = ex.message || "خطا";
      res.className = "text-xs text-rose-400";
    }
    btn.disabled = false;
  });

  // Schedules
  async function loadSchedules() {
    const tbody = $("#sched-tbody");
    tbody.innerHTML = `<tr><td colspan="5" class="px-5 py-6 text-center text-slate-500 text-sm">بارگذاری...</td></tr>`;
    try {
      const d = await api("/schedules");
      if (!d.items.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="px-5 py-6 text-center text-slate-500 text-sm">هنوز پیام زمان‌داری تعریف نشده</td></tr>`;
        return;
      }
      const typeLabel = { once: "یک‌بار", daily: "روزانه", hourly: "ساعتی" };
      tbody.innerHTML = d.items.map((s) => `
        <tr class="table-row">
          <td class="px-5 py-3.5 max-w-xs truncate text-slate-200">${escapeHtml(s.text.slice(0, 80))}</td>
          <td class="px-5 py-3.5 text-xs">${typeLabel[s.type] || s.type}</td>
          <td class="px-5 py-3.5 font-mono text-xs text-slate-300">${escapeHtml(s.at)}</td>
          <td class="px-5 py-3.5">${s.enabled ? `<span class="badge-green">فعال</span>` : `<span class="badge-red">غیرفعال</span>`}</td>
          <td class="px-5 py-3.5 text-left space-x-1 space-x-reverse">
            <button data-toggle="${s.id}" class="btn-ghost text-xs px-2 py-1">${s.enabled ? "توقف" : "فعال"}</button>
            <button data-del="${s.id}" class="btn-danger text-xs px-2 py-1">حذف</button>
          </td>
        </tr>`).join("");
      tbody.querySelectorAll("[data-toggle]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          await api(`/schedules/${btn.dataset.toggle}/toggle`, { method: "POST" });
          loadSchedules(); loadStats();
        });
      });
      tbody.querySelectorAll("[data-del]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("حذف شود؟")) return;
          await api(`/schedules/${btn.dataset.del}`, { method: "DELETE" });
          loadSchedules(); loadStats();
        });
      });
    } catch (ex) {
      tbody.innerHTML = `<tr><td colspan="5" class="px-5 py-6 text-center text-rose-400 text-sm">${escapeHtml(ex.message)}</td></tr>`;
    }
  }

  $("#btn-add-schedule").addEventListener("click", async () => {
    const text = $("#sched-text").value.trim();
    const type = $("#sched-type").value;
    const at = $("#sched-at").value.trim();
    if (!text || !at) { alert("متن و زمان الزامی است"); return; }
    try {
      await api("/schedules", { method: "POST", body: JSON.stringify({ text, type, at }) });
      $("#sched-text").value = "";
      $("#sched-at").value = "";
      loadSchedules();
      loadStats();
    } catch (ex) {
      alert(ex.message || "خطا");
    }
  });

  async function loadSettings() {
    try {
      const d = await api("/settings");
      const st = $("#bot-status");
      if (d.hasToken) {
        st.textContent = d.username ? `متصل: @${d.username}` : "توکن ثبت شده";
        st.className = "text-xs text-emerald-400";
      } else {
        st.textContent = "توکن ثبت نشده";
        st.className = "text-xs text-slate-400";
      }
      if (d.startText) $("#start-text").value = d.startText;
    } catch {}
  }

  $("#btn-save-bot").addEventListener("click", async () => {
    const token = $("#bot-token").value.trim();
    if (!token) return;
    const st = $("#bot-status");
    st.textContent = "در حال ذخیره...";
    st.className = "text-xs text-slate-400";
    try {
      const d = await api("/settings/bot", { method: "POST", body: JSON.stringify({ token }) });
      st.textContent = `متصل: @${d.username}`;
      st.className = "text-xs text-emerald-400";
      $("#bot-token").value = "";
    } catch (ex) {
      st.textContent = ex.message || "خطا";
      st.className = "text-xs text-rose-400";
    }
  });

  $("#btn-save-start").addEventListener("click", async () => {
    try {
      await api("/settings/start-text", { method: "POST", body: JSON.stringify({ text: $("#start-text").value }) });
      alert("ذخیره شد");
    } catch (ex) { alert(ex.message || "خطا"); }
  });

  $("#btn-change-pass").addEventListener("click", async () => {
    const p = $("#settings-new-pass").value;
    if (p.length < 8) { alert("رمز باید حداقل ۸ کاراکتر باشد"); return; }
    try {
      await api("/auth/password", { method: "POST", body: JSON.stringify({ password: p }) });
      $("#settings-new-pass").value = "";
      alert("رمز با موفقیت تغییر کرد");
    } catch (ex) { alert(ex.message || "خطا"); }
  });

  checkAuth();
})();
