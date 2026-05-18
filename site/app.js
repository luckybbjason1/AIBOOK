(() => {
  const STORAGE_KEY = "dibi8_notes_v1";

  const newNoteBtn = document.getElementById("newNoteBtn");
  const exportBtn = document.getElementById("exportBtn");
  const importInput = document.getElementById("importInput");
  const deleteBtn = document.getElementById("deleteBtn");
  const searchInput = document.getElementById("searchInput");
  const notesList = document.getElementById("notesList");
  const contentInput = document.getElementById("contentInput");
  const updatedAtEl = document.getElementById("updatedAt");

  const nowISO = () => new Date().toISOString();
  const toB64 = (buf) => {
    const bytes = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  };
  const fromB64 = (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  };
  const safeJSONParse = (value) => {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

  const generateId = () => {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  };

  const deriveKey = async (password, salt, iterations) => {
    const enc = new TextEncoder();
    const material = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  };

  const encryptText = async (password, plaintext) => {
    const enc = new TextEncoder();
    const salt = new Uint8Array(16);
    const iv = new Uint8Array(12);
    crypto.getRandomValues(salt);
    crypto.getRandomValues(iv);
    const iterations = 150000;
    const key = await deriveKey(password, salt, iterations);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
    return {
      encrypted: true,
      v: 1,
      kdf: "PBKDF2-SHA256",
      iterations,
      salt: toB64(salt.buffer),
      iv: toB64(iv.buffer),
      ct: toB64(ct),
    };
  };

  const decryptText = async (password, payload) => {
    if (!payload || payload.encrypted !== true) throw new Error("not-encrypted");
    const iterations = Number(payload.iterations);
    if (!Number.isFinite(iterations) || iterations < 1) throw new Error("bad-iterations");
    const salt = new Uint8Array(fromB64(payload.salt));
    const iv = new Uint8Array(fromB64(payload.iv));
    const ct = fromB64(payload.ct);
    const key = await deriveKey(password, salt, iterations);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return new TextDecoder().decode(pt);
  };

  const normalizeNote = (note) => {
    if (!note || typeof note !== "object") return null;
    if (typeof note.id !== "string" || note.id.length < 8) return null;
    const content = typeof note.content === "string" ? note.content : "";
    const createdAt = typeof note.createdAt === "string" ? note.createdAt : nowISO();
    const updatedAt = typeof note.updatedAt === "string" ? note.updatedAt : createdAt;
    return { id: note.id, content, createdAt, updatedAt };
  };

  const defaultState = () => {
    const first = {
      id: generateId(),
      content: "欢迎使用 Notes\n\n- 全部内容都保存在你的浏览器本地（localStorage）\n- 不依赖服务器\n- 可导入/导出 JSON\n",
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    return { notes: [first], activeId: first.id, query: "" };
  };

  const loadState = () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? safeJSONParse(raw) : null;
    if (!parsed || typeof parsed !== "object") return defaultState();

    const notes = Array.isArray(parsed.notes) ? parsed.notes.map(normalizeNote).filter(Boolean) : [];
    if (notes.length === 0) return defaultState();

    const activeId =
      typeof parsed.activeId === "string" && notes.some((n) => n.id === parsed.activeId) ? parsed.activeId : notes[0].id;
    const query = typeof parsed.query === "string" ? parsed.query : "";

    return { notes, activeId, query };
  };

  const saveState = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  };

  const state = loadState();

  const getActiveNote = () => state.notes.find((n) => n.id === state.activeId) || null;

  const summarize = (content) => {
    const text = String(content || "").replace(/\r/g, "").trim();
    if (!text) return { title: "未命名", preview: "" };
    const lines = text.split("\n");
    const firstLine = lines.find((l) => l.trim().length > 0) || "";
    const title = firstLine.trim().slice(0, 40) || "未命名";
    const preview = text.slice(firstLine.length).trim().replace(/\s+/g, " ").slice(0, 120);
    return { title, preview };
  };

  const formatUpdatedAt = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return `更新时间：${d.toLocaleString()}`;
  };

  const compareByUpdatedDesc = (a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0);

  const matchesQuery = (note, query) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (note.content || "").toLowerCase().includes(q);
  };

  const renderList = () => {
    const query = state.query.trim();
    const visible = state.notes
      .slice()
      .sort(compareByUpdatedDesc)
      .filter((n) => matchesQuery(n, query));

    notesList.innerHTML = "";

    if (visible.length === 0) {
      const empty = document.createElement("div");
      empty.className = "noteItem";
      empty.style.cursor = "default";
      empty.innerHTML = `<div class="noteTitle">没有结果</div><div class="notePreview">换个关键词试试</div>`;
      notesList.appendChild(empty);
      return;
    }

    for (const note of visible) {
      const { title, preview } = summarize(note.content);
      const item = document.createElement("div");
      item.className = "noteItem" + (note.id === state.activeId ? " active" : "");
      item.setAttribute("role", "listitem");
      item.dataset.id = note.id;
      item.innerHTML = `<div class="noteTitle"></div><div class="notePreview"></div>`;
      item.querySelector(".noteTitle").textContent = title;
      item.querySelector(".notePreview").textContent = preview;
      item.addEventListener("click", () => {
        if (state.activeId === note.id) return;
        state.activeId = note.id;
        saveState();
        render();
        contentInput.focus();
      });
      notesList.appendChild(item);
    }
  };

  const renderEditor = () => {
    const note = getActiveNote();
    if (!note) {
      contentInput.value = "";
      updatedAtEl.textContent = "";
      contentInput.disabled = true;
      deleteBtn.disabled = true;
      return;
    }

    contentInput.disabled = false;
    deleteBtn.disabled = false;
    contentInput.value = note.content || "";
    updatedAtEl.textContent = formatUpdatedAt(note.updatedAt);
  };

  const render = () => {
    searchInput.value = state.query;
    renderList();
    renderEditor();
  };

  const createNote = () => {
    const n = { id: generateId(), content: "", createdAt: nowISO(), updatedAt: nowISO() };
    state.notes.unshift(n);
    state.activeId = n.id;
    saveState();
    render();
    contentInput.focus();
  };

  const deleteActive = () => {
    const note = getActiveNote();
    if (!note) return;
    const ok = confirm("确定删除这条笔记？此操作不可恢复。");
    if (!ok) return;
    const idx = state.notes.findIndex((n) => n.id === note.id);
    if (idx >= 0) state.notes.splice(idx, 1);
    if (state.notes.length === 0) {
      const fresh = defaultState();
      state.notes = fresh.notes;
      state.activeId = fresh.activeId;
      state.query = "";
    } else {
      state.activeId = state.notes[0].id;
    }
    saveState();
    render();
  };

  let saveTimer = null;
  const scheduleSaveContent = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const note = getActiveNote();
      if (!note) return;
      note.content = contentInput.value || "";
      note.updatedAt = nowISO();
      saveState();
      updatedAtEl.textContent = formatUpdatedAt(note.updatedAt);
      renderList();
    }, 200);
  };

  const download = (filename, text) => {
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const exportData = async () => {
    const payload = {
      exportedAt: nowISO(),
      version: 1,
      notes: state.notes,
    };
    const password = prompt("设置导出密码（留空则不加密）：") || "";
    if (!password) {
      download(`notes-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2));
      return;
    }
    try {
      const encrypted = await encryptText(password, JSON.stringify(payload));
      download(`notes-${new Date().toISOString().slice(0, 10)}.encrypted.json`, JSON.stringify(encrypted, null, 2));
    } catch {
      alert("导出失败：加密出错。");
    }
  };

  const importData = async (file) => {
    const text = await file.text();
    const parsed = safeJSONParse(text);
    if (!parsed || typeof parsed !== "object") {
      alert("导入失败：不是有效的 JSON。");
      return;
    }

    let data = parsed;
    if (parsed.encrypted === true) {
      const password = prompt("这是加密备份，请输入密码：") || "";
      if (!password) return;
      try {
        const decrypted = await decryptText(password, parsed);
        const inner = safeJSONParse(decrypted);
        if (!inner || typeof inner !== "object") {
          alert("导入失败：解密内容不是有效的 JSON。");
          return;
        }
        data = inner;
      } catch {
        alert("导入失败：密码错误或数据损坏。");
        return;
      }
    }

    const notes = Array.isArray(data.notes) ? data.notes.map(normalizeNote).filter(Boolean) : [];
    if (notes.length === 0) {
      alert("导入失败：没有可用的 notes 数据。");
      return;
    }

    const merge = confirm("导入会覆盖当前所有笔记（更简单、更安全）。确定继续？");
    if (!merge) return;

    state.notes = notes;
    state.activeId = notes[0].id;
    state.query = "";
    saveState();
    render();
  };

  newNoteBtn.addEventListener("click", createNote);
  deleteBtn.addEventListener("click", deleteActive);
  exportBtn.addEventListener("click", () => exportData());

  importInput.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    importInput.value = "";
    if (!file) return;
    try {
      await importData(file);
    } catch {
      alert("导入失败：读取文件出错。");
    }
  });

  searchInput.addEventListener("input", () => {
    state.query = searchInput.value || "";
    saveState();
    renderList();
  });

  contentInput.addEventListener("input", scheduleSaveContent);

  window.addEventListener("keydown", (e) => {
    const isMac = navigator.platform.toLowerCase().includes("mac");
    const mod = isMac ? e.metaKey : e.ctrlKey;

    if (mod && e.key.toLowerCase() === "n") {
      e.preventDefault();
      createNote();
      return;
    }

    if (mod && e.key.toLowerCase() === "f") {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
      return;
    }
  });

  render();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }
})();
