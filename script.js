"use strict";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, get, child, onValue, push, remove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyCOBDe3VP6-xuE3Zzymy9mqyce3KeLkjFk",
    authDomain: "test-app-3d949.firebaseapp.com",
    databaseURL: "https://test-app-3d949-default-rtdb.firebaseio.com",
    projectId: "test-app-3d949",
    storageBucket: "test-app-3d949.firebasestorage.app",
    messagingSenderId: "645469587643",
    appId: "1:645469587643:web:c93d141241b63dab65019e"
};

const fbApp = initializeApp(firebaseConfig);
const db = getDatabase(fbApp);

function $(sel, root) { return (root || document).querySelector(sel); }
const app = document.getElementById("app");

function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
}

function pad2(n) { return String(n).padStart(2, "0"); }
function now() { return Date.now(); }

function lsGet(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
        return fallback;
    }
}

function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { }
}

function randomId(len, alphabet) {
    const a = alphabet || "abcdefghijklmnopqrstuvwxyz0123456789";
    let out = "";
    const arr = new Uint32Array(len);
    (window.crypto || window.msCrypto).getRandomValues(arr);
    for (let i = 0; i < len; i++) {
        out += a[arr[i] % a.length];
    }
    return out;
}

function genCode() { return randomId(5, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"); }
function genPin() { return randomId(4, "0123456789"); }
function safeSeg(s) { return String(s).replace(/[^A-Za-z0-9_\-.~:@+]/g, "-").slice(0, 60) || "anon"; }

function clock(ms) {
    if (ms < 0) ms = 0;
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0 ? h + ":" + pad2(m) + ":" + pad2(s) : pad2(m) + ":" + pad2(s);
}

function hhmm(ms) {
    const d = new Date(ms);
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}

function toast(text) {
    const old = document.querySelector(".toast");
    if (old) old.remove();
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    el.setAttribute("role", "status");
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 2600);
}

function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = a[i];
        a[i] = a[j];
        a[j] = t;
    }
    return a;
}

function rtdbStore(database) {
    return {
        kind: "firebase",
        getRoom: async function (code) {
            const snapshot = await get(child(ref(database), 'rooms/' + code + '/data'));
            return snapshot.exists() ? snapshot.val() : null;
        },
        saveRoom: async function (room) {
            await set(ref(database, 'rooms/' + room.code + '/data'), room);
        },
        onRoom: function (code, cb) {
            const roomRef = ref(database, 'rooms/' + code + '/data');
            return onValue(roomRef, function (snapshot) {
                cb(snapshot.exists() ? snapshot.val() : null);
            });
        },
        sendMessage: async function (code, msg) {
            const msgRef = ref(database, 'rooms/' + code + '/messages');
            await push(msgRef, msg);
        },
        onMessages: function (code, cb) {
            const msgsRef = ref(database, 'rooms/' + code + '/messages');
            return onValue(msgsRef, function (snapshot) {
                if (snapshot.exists()) {
                    const data = snapshot.val();
                    const list = Object.keys(data).map(function (id) {
                        return Object.assign({ id: id }, data[id]);
                    });
                    list.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
                    cb(list.slice(-80));
                } else {
                    cb([]);
                }
            });
        },
        saveResult: async function (code, r) {
            await set(ref(database, 'rooms/' + code + '/results/' + safeSeg(r.uid)), r);
        },
        onResults: function (code, cb) {
            const resRef = ref(database, 'rooms/' + code + '/results');
            return onValue(resRef, function (snapshot) {
                if (snapshot.exists()) {
                    const data = snapshot.val();
                    cb(Object.values(data));
                } else {
                    cb([]);
                }
            });
        },
        clearResults: async function (code) {
            await remove(ref(database, 'rooms/' + code + '/results'));
        },
        clearChat: async function (code) {
            await remove(ref(database, 'rooms/' + code + '/messages'));
        }
    };
}

const me = lsGet("klass.me", null) || { uid: randomId(10), name: "" };
lsSet("klass.me", me);

const S = {
    store: null,
    ready: false,
    view: "home",
    tab: "quiz",
    code: null,
    room: null,
    messages: [],
    results: [],
    isTeacher: false,
    attempt: null,
    draft: null,
    unsubs: []
};

function stopSubs() {
    S.unsubs.forEach(function (u) {
        try { if (typeof u === 'function') u(); } catch (e) { }
    });
    S.unsubs = [];
}

function subscribeRoom(code) {
    stopSubs();
    S.unsubs.push(S.store.onRoom(code, function (room) {
        const wasLive = S.room && S.room.status === "live";
        S.room = room;
        if (room && room.status === "live" && !wasLive && S.view === "student") {
            toast("Учитель открыл тест");
        }
        renderAll();
    }));
    S.unsubs.push(S.store.onMessages(code, function (list) {
        S.messages = list;
        paintChat();
    }));
    S.unsubs.push(S.store.onResults(code, function (list) {
        S.results = list;
        paintResults();
    }));
}

function emptyRoom(title, teacherName) {
    const today = new Date();
    const startMs = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 14, 0, 0).getTime();
    return {
        code: genCode(),
        pin: genPin(),
        title: title || "Урок",
        teacherName: teacherName || "Учитель",
        teacherUid: me.uid,
        status: "draft",
        window: { startMs: startMs, endMs: startMs + 4 * 3600 * 1000 },
        settings: { durationMin: 0, shuffle: false, showResults: true },
        quiz: { questions: [] },
        createdAt: now(),
        updatedAt: now()
    };
}

function newQuestion() {
    return { id: randomId(6), text: "", options: ["", ""], correct: 0 };
}

function phaseOf(room) {
    if (!room) return { key: "none", label: "Комната не найдена" };
    const t = now();
    const w = room.window || {};
    if (room.status === "closed") return { key: "closed", label: "Тест закрыт учителем" };
    if (!room.quiz || !room.quiz.questions || !room.quiz.questions.length) return { key: "empty", label: "Учитель ещё готовит вопросы" };
    if (room.status === "draft") return { key: "draft", label: "Тест ещё не запущен" };
    if (t < w.startMs) return { key: "before", label: "До начала", ms: w.startMs - t };
    if (t > w.endMs) return { key: "after", label: "Время вышло" };
    return { key: "live", label: "Осталось", ms: w.endMs - t };
}

function canStart(room) {
    return phaseOf(room).key === "live";
}

function myResult() {
    return S.results.find(function (r) { return r.uid === me.uid; }) || null;
}

function scoreOf(room, answers) {
    const qs = (room.quiz && room.quiz.questions) || [];
    let correct = 0;
    qs.forEach(function (q) {
        if (answers && answers[q.id] === q.correct) correct++;
    });
    return { correct: correct, total: qs.length };
}

function deadlineOf(room, startedAt) {
    const ends = [room.window.endMs];
    const dur = (room.settings && room.settings.durationMin) || 0;
    if (dur > 0) ends.push(startedAt + dur * 60000);
    return Math.min.apply(null, ends);
}

async function say(text, kind) {
    if (!S.code || !text) return;
    try {
        await S.store.sendMessage(S.code, {
            uid: me.uid,
            name: me.name || "Гость",
            role: kind || (S.isTeacher ? "teacher" : "student"),
            text: String(text).slice(0, 500),
            ts: now()
        });
    } catch (e) {
        toast("Сообщение не отправилось");
    }
}

function renderAll() {
    if (S.view === "home") return viewHome();
    if (S.view === "teacher") return viewTeacher();
    if (S.view === "student") return viewStudent();
    if (S.view === "test") return viewTest();
}

function viewHome() {
    app.innerHTML = '<div class="stack">' +
        '<div>' +
        '<h1>Класс: чат и тест</h1>' +
        '<p class="hero-note">Учитель открывает комнату и задаёт время. Ученики входят по коду с телефона.</p>' +
        '</div>' +
        '<div class="sheet margin-line">' +
        '<h2>Войти в комнату</h2>' +
        '<p class="muted" style="margin:6px 0 12px">Код из пяти символов даёт учитель.</p>' +
        '<label class="field"><span>Код комнаты</span>' +
        '<input id="joinCode" type="text" inputmode="latin" autocapitalize="characters" maxlength="5" placeholder="A7K3Q" style="font-family:Unbounded,monospace;letter-spacing:.18em;text-transform:uppercase">' +
        '</label>' +
        '<label class="field"><span>Имя и фамилия</span>' +
        '<input id="joinName" type="text" placeholder="Алина Ким" value="' + esc(me.name) + '">' +
        '</label>' +
        '<button class="btn wide" id="joinBtn">Войти в чат класса</button>' +
        '</div>' +
        '<div class="sheet">' +
        '<h2>Вы учитель?</h2>' +
        '<p class="muted" style="margin:6px 0 12px">Создайте комнату, соберите вопросы и укажите, с какого по какое время тест открыт.</p>' +
        '<div class="row">' +
        '<button class="btn ghost grow" id="createBtn">Создать комнату</button>' +
        '<button class="btn ghost grow" id="manageBtn">Открыть свою</button>' +
        '</div>' +
        '</div>' +
        '<div class="banner go"><b>Общая база подключена.</b> Чат и тест синхронизируются у всех, кто откроет эту страницу.</div>' +
        '</div>';

    $("#joinBtn").onclick = async function () {
        const code = ($("#joinCode").value || "").trim().toUpperCase();
        const name = ($("#joinName").value || "").trim();
        if (code.length < 4) return toast("Введите код комнаты");
        if (name.length < 2) return toast("Введите имя");
        me.name = name;
        lsSet("klass.me", me);
        const room = await S.store.getRoom(code);
        if (!room) return toast("Комната с таким кодом не найдена");
        S.code = code;
        S.room = room;
        S.isTeacher = false;
        S.view = "student";
        lsSet("klass.last", { code: code, role: "student" });
        subscribeRoom(code);
        renderAll();
        const seen = lsGet("klass.joined." + code, false);
        if (!seen) {
            lsSet("klass.joined." + code, true);
            say(name + " в классе", "system");
        }
        saveMyResult({ status: "joined" });
    };

    $("#createBtn").onclick = function () {
        S.view = "teacher";
        S.code = null;
        S.room = null;
        S.isTeacher = true;
        renderAll();
    };

    $("#manageBtn").onclick = function () {
        S.view = "teacher";
        S.code = null;
        S.room = null;
        S.isTeacher = true;
        S.openExisting = true;
        renderAll();
    };
}

function viewTeacher() {
    if (!S.room) return teacherEntry();
    const r = S.room;
    const ph = phaseOf(r);
    app.innerHTML = '<div class="row between" style="margin-bottom:12px">' +
        '<button class="btn ghost small" id="back">← Выйти</button>' +
        '<span class="pill ' + (ph.key === "live" ? "live" : ph.key === "closed" ? "off" : "warn") + '"><i class="dot"></i>' + (ph.key === "live" ? "Тест идёт" : ph.key === "before" ? "Ожидание" : ph.key === "closed" ? "Закрыт" : "Черновик") + '</span>' +
        '</div>' +
        '<div class="sheet margin-line">' +
        '<h2>' + esc(r.title) + '</h2>' +
        '<p class="muted" style="margin:4px 0 12px">Код для учеников — назовите его классу</p>' +
        '<div class="code-box">' + esc(r.code) + '</div>' +
        '<div class="row" style="margin-top:12px">' +
        '<button class="btn ghost small grow" id="copyLink">Скопировать ссылку</button>' +
        '<button class="btn ghost small grow" id="copyCode">Скопировать код</button>' +
        '</div>' +
        '<p class="tiny" style="margin-top:10px">Код учителя для входа с другого устройства: <b class="kbd">' + esc(r.pin) + '</b></p>' +
        '</div>' +
        '<div class="tabs" role="tablist">' +
        '<button role="tab" data-tab="quiz" aria-selected="' + (S.tab === "quiz") + '">Вопросы</button>' +
        '<button role="tab" data-tab="time" aria-selected="' + (S.tab === "time") + '">Время</button>' +
        '<button role="tab" data-tab="chat" aria-selected="' + (S.tab === "chat") + '">Чат</button>' +
        '<button role="tab" data-tab="class" aria-selected="' + (S.tab === "class") + '">Класс</button>' +
        '</div>' +
        '<div id="tabBody"></div>';

    $("#back").onclick = function () {
        stopSubs();
        S.view = "home";
        S.room = null;
        S.code = null;
        renderAll();
    };
    $("#copyCode").onclick = function () { copyText(r.code, "Код скопирован"); };
    $("#copyLink").onclick = function () { copyText(location.href.split("#")[0] + "#" + r.code, "Ссылка скопирована"); };

    app.querySelectorAll("[data-tab]").forEach(function (b) {
        b.onclick = function () {
            S.tab = b.dataset.tab;
            viewTeacher();
        };
    });

    if (S.tab === "quiz") tabQuiz();
    if (S.tab === "time") tabTime();
    if (S.tab === "chat") tabChat();
    if (S.tab === "class") tabClass();
}

function teacherEntry() {
    app.innerHTML = '<div class="row between" style="margin-bottom:12px">' +
        '<button class="btn ghost small" id="back">← Назад</button>' +
        '</div>' +
        '<div class="sheet margin-line">' +
        '<h2>' + (S.openExisting ? "Открыть свою комнату" : "Новая комната") + '</h2>' +
        '<div id="entryBody" style="margin-top:12px"></div>' +
        '</div>';

    $("#back").onclick = function () { S.openExisting = false; S.view = "home"; renderAll(); };
    const body = $("#entryBody");

    if (S.openExisting) {
        body.innerHTML = '<label class="field"><span>Код комнаты</span><input id="tCode" type="text" maxlength="5" style="text-transform:uppercase;font-family:Unbounded,monospace;letter-spacing:.18em"></label>' +
            '<label class="field"><span>Код учителя</span><input id="tPin" type="text" inputmode="numeric" maxlength="4"></label>' +
            '<button class="btn wide" id="tOpen">Открыть панель</button>';

        $("#tOpen").onclick = async function () {
            const code = ($("#tCode").value || "").trim().toUpperCase();
            const pin = ($("#tPin").value || "").trim();
            const room = await S.store.getRoom(code);
            if (!room) return toast("Комната не найдена");
            if (room.pin !== pin && room.teacherUid !== me.uid) return toast("Код учителя не подходит");
            S.code = code;
            S.room = room;
            S.isTeacher = true;
            S.draft = JSON.parse(JSON.stringify(room.quiz || { questions: [] }));
            S.openExisting = false;
            lsSet("klass.last", { code: code, role: "teacher" });
            subscribeRoom(code);
            renderAll();
        };
    } else {
        body.innerHTML = '<label class="field"><span>Название урока</span><input id="tTitle" type="text" placeholder="Биология, 7Б — фотосинтез"></label>' +
            '<label class="field"><span>Ваше имя</span><input id="tName" type="text" placeholder="Мария Петровна" value="' + esc(me.name) + '"></label>' +
            '<button class="btn wide" id="tCreate">Создать комнату</button>' +
            '<p class="tiny" style="margin-top:10px">Вопросы и время можно задать сразу после создания.</p>';

        $("#tCreate").onclick = async function () {
            const title = ($("#tTitle").value || "").trim() || "Урок";
            const name = ($("#tName").value || "").trim() || "Учитель";
            me.name = name;
            lsSet("klass.me", me);
            const room = emptyRoom(title, name);
            try {
                await S.store.saveRoom(room);
            } catch (e) {
                return toast("Не удалось создать комнату");
            }
            S.code = room.code;
            S.room = room;
            S.isTeacher = true;
            S.draft = { questions: [] };
            lsSet("klass.last", { code: room.code, role: "teacher" });
            subscribeRoom(room.code);
            renderAll();
        };
    }
}

function tabQuiz() {
    if (!S.draft) S.draft = JSON.parse(JSON.stringify(S.room.quiz || { questions: [] }));
    const qs = S.draft.questions;
    const body = $("#tabBody");
    body.innerHTML = '<div class="sheet">' +
        '<div class="row between"><h2>Вопросы (' + qs.length + ')</h2><button class="btn small" id="addQ">Добавить</button></div>' +
        '<div id="qList" style="margin-top:12px">' + (qs.length ? "" : '<p class="muted">Пока пусто. Добавьте вопрос или вставьте список текстом ниже.</p>') + '</div>' +
        '<div class="sticky-bottom"><button class="btn wide" id="saveQ">Сохранить тест</button></div>' +
        '</div>' +
        '<div class="sheet">' +
        '<details>' +
        '<summary>Быстрый ввод текстом</summary>' +
        '<p class="tiny" style="margin:8px 0">Вопрос — первой строкой, варианты — следующими, правильный помечен звёздочкой. Между вопросами — пустая строка.</p>' +
        '<textarea id="bulk" placeholder="Столица Франции?\n*Париж\nЛион\nМарсель\n\n2 + 2 × 2 =\n*6\n8"></textarea>' +
        '<button class="btn ghost small" id="bulkBtn" style="margin-top:9px">Добавить из текста</button>' +
        '</details>' +
        '</div>';

    const list = $("#qList");
    qs.forEach(function (q, i) {
        const card = document.createElement("div");
        card.className = "q-card";
        let optsHtml = "";
        q.options.forEach(function (o, j) {
            optsHtml += '<div class="opt">' +
                '<input type="radio" name="corr' + i + '" ' + (q.correct === j ? "checked" : "") + ' data-corr="' + i + '.' + j + '" title="Правильный ответ">' +
                '<input type="text" class="grow" data-opt="' + i + '.' + j + '" value="' + esc(o) + '" placeholder="Вариант ' + (j + 1) + '">' +
                (q.options.length > 2 ? '<button class="btn small ghost" data-delopt="' + i + '.' + j + '">×</button>' : '') +
                '</div>';
        });

        card.innerHTML = '<div class="row between"><h3>Вопрос ' + (i + 1) + '</h3><button class="btn small danger" data-del="' + i + '">Удалить</button></div>' +
            '<textarea data-qtext="' + i + '" placeholder="Текст вопроса" style="margin-top:8px">' + esc(q.text) + '</textarea>' +
            '<div style="margin-top:8px">' + optsHtml + '</div>' +
            '<button class="btn small ghost" data-addopt="' + i + '" style="margin-top:9px">Добавить вариант</button>';
        list.appendChild(card);
    });

    body.querySelectorAll("[data-qtext]").forEach(function (t) {
        t.oninput = function (e) { qs[+e.target.dataset.qtext].text = e.target.value; };
    });
    body.querySelectorAll("[data-opt]").forEach(function (t) {
        t.oninput = function (e) {
            const parts = e.target.dataset.opt.split(".").map(Number);
            qs[parts[0]].options[parts[1]] = e.target.value;
        };
    });
    body.querySelectorAll("[data-corr]").forEach(function (t) {
        t.onchange = function (e) {
            const parts = e.target.dataset.corr.split(".").map(Number);
            qs[parts[0]].correct = parts[1];
        };
    });
    body.querySelectorAll("[data-addopt]").forEach(function (b) {
        b.onclick = function (e) {
            qs[+e.target.dataset.addopt].options.push("");
            tabQuiz();
        };
    });
    body.querySelectorAll("[data-delopt]").forEach(function (b) {
        b.onclick = function (e) {
            const parts = e.target.dataset.delopt.split(".").map(Number);
            qs[parts[0]].options.splice(parts[1], 1);
            if (qs[parts[0]].correct >= qs[parts[0]].options.length) qs[parts[0]].correct = 0;
            tabQuiz();
        };
    });
    body.querySelectorAll("[data-del]").forEach(function (b) {
        b.onclick = function (e) {
            qs.splice(+e.target.dataset.del, 1);
            tabQuiz();
        };
    });

    $("#addQ").onclick = function () {
        qs.push(newQuestion());
        tabQuiz();
    };

    $("#bulkBtn").onclick = function () {
        const parsed = parseBulk($("#bulk").value);
        if (!parsed.length) return toast("Не получилось разобрать текст");
        parsed.forEach(function (q) { qs.push(q); });
        toast("Добавлено вопросов: " + parsed.length);
        tabQuiz();
    };

    $("#saveQ").onclick = async function () {
        const clean = qs.filter(function (q) {
            return q.text.trim() && q.options.filter(function (o) { return o.trim(); }).length >= 2;
        });
        if (clean.length !== qs.length) toast("Пустые вопросы пропущены");
        if (!clean.length) return toast("Нужен хотя бы один вопрос с двумя вариантами");
        const room = Object.assign({}, S.room, { quiz: { questions: clean }, updatedAt: now() });
        try {
            await S.store.saveRoom(room);
            S.room = room;
            S.draft = JSON.parse(JSON.stringify(room.quiz));
            toast("Тест сохранён");
        } catch (e) {
            toast("Не удалось сохранить");
        }
        viewTeacher();
    };
}

function parseBulk(text) {
    const blocks = String(text || "").split(/\n\s*\n/);
    const out = [];
    blocks.forEach(function (block) {
        const lines = block.split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
        if (lines.length < 3) return;
        const q = newQuestion();
        q.text = lines[0].replace(/^\d+[.)]\s*/, "");
        q.options = [];
        q.correct = 0;
        lines.slice(1).forEach(function (l) {
            const isRight = l[0] === "*" || l[0] === "+";
            const clean = isRight ? l.slice(1).trim() : l;
            if (isRight) q.correct = q.options.length;
            q.options.push(clean);
        });
        if (q.options.length >= 2) out.push(q);
    });
    return out;
}

function tabTime() {
    const r = S.room;
    const w = r.window;
    const st = new Date(w.startMs);
    const en = new Date(w.endMs);
    const dateVal = st.getFullYear() + "-" + pad2(st.getMonth() + 1) + "-" + pad2(st.getDate());
    const ph = phaseOf(r);

    let bannerHtml = "";
    if (ph.key === "live") {
        bannerHtml = 'Тест идёт, осталось <span class="big-time">' + clock(ph.ms) + '</span>';
    } else if (ph.key === "before") {
        bannerHtml = 'Откроется в ' + hhmm(w.startMs) + ' — через <span class="big-time">' + clock(ph.ms) + '</span>';
    } else if (ph.key === "after") {
        bannerHtml = "Время вышло — ученики уже не начнут";
    } else if (ph.key === "closed") {
        bannerHtml = "Комната закрыта";
    } else if (ph.key === "empty") {
        bannerHtml = "Сначала добавьте вопросы";
    } else {
        bannerHtml = "Черновик: нажмите «Запустить», тест откроется в назначенное время";
    }

    $("#tabBody").innerHTML = '<div class="sheet">' +
        '<h2>Когда тест открыт</h2>' +
        '<p class="muted" style="margin:6px 0 12px">Вне этого окна кнопка «Начать тест» у учеников не работает.</p>' +
        '<label class="field"><span>Дата</span><input id="wDate" type="date" value="' + dateVal + '"></label>' +
        '<div class="row">' +
        '<label class="field grow"><span>С</span><input id="wFrom" type="time" value="' + pad2(st.getHours()) + ':' + pad2(st.getMinutes()) + '"></label>' +
        '<label class="field grow"><span>До</span><input id="wTo" type="time" value="' + pad2(en.getHours()) + ':' + pad2(en.getMinutes()) + '"></label>' +
        '</div>' +
        '<label class="field"><span>Ограничение на попытку, минут (0 — без лимита)</span>' +
        '<input id="wDur" type="number" min="0" max="240" value="' + ((r.settings && r.settings.durationMin) || 0) + '"></label>' +
        '<label class="row" style="gap:8px;margin-bottom:8px"><input type="checkbox" id="wShuffle" ' + (r.settings.shuffle ? "checked" : "") + '> <span>Перемешивать вопросы</span></label>' +
        '<label class="row" style="gap:8px;margin-bottom:14px"><input type="checkbox" id="wShow" ' + (r.settings.showResults ? "checked" : "") + '> <span>Показывать ученику его оценку сразу</span></label>' +
        '<button class="btn wide" id="wSave">Сохранить расписание</button>' +
        '</div>' +
        '<div class="sheet">' +
        '<h2>Запуск</h2>' +
        '<div class="banner ' + (ph.key === "live" ? "go" : ph.key === "closed" ? "stop" : "wait") + '" style="margin:10px 0 12px">' + bannerHtml + '</div>' +
        '<div class="row">' +
        (r.status !== "live" ? '<button class="btn grow" id="goLive">Запустить тест</button>' : '<button class="btn ghost grow" id="pause">Приостановить</button>') +
        '<button class="btn danger grow" id="close">Закрыть тест</button>' +
        '</div>' +
        '</div>';

    $("#wSave").onclick = async function () {
        const d = ($("#wDate").value || "").split("-").map(Number);
        const f = ($("#wFrom").value || "").split(":").map(Number);
        const t = ($("#wTo").value || "").split(":").map(Number);
        if (d.length < 3 || f.length < 2 || t.length < 2 || isNaN(d[0]) || isNaN(f[0]) || isNaN(t[0])) return toast("Проверьте дату и время");
        const startMs = new Date(d[0], d[1] - 1, d[2], f[0], f[1]).getTime();
        let endMs = new Date(d[0], d[1] - 1, d[2], t[0], t[1]).getTime();
        if (endMs <= startMs) endMs += 24 * 3600 * 1000;
        const room = Object.assign({}, S.room, {
            window: { startMs: startMs, endMs: endMs },
            settings: {
                durationMin: Math.max(0, +$("#wDur").value || 0),
                shuffle: $("#wShuffle").checked,
                showResults: $("#wShow").checked
            },
            updatedAt: now()
        });
        try {
            await S.store.saveRoom(room);
            S.room = room;
            toast("Расписание сохранено");
            viewTeacher();
        } catch (e) {
            toast("Не удалось сохранить");
        }
    };

    const setStatus = async function (status, note) {
        if (status === "live" && !(S.room.quiz && S.room.quiz.questions.length)) return toast("Сначала добавьте вопросы");
        const room = Object.assign({}, S.room, { status: status, updatedAt: now() });
        try {
            await S.store.saveRoom(room);
            S.room = room;
            if (note) say(note, "system");
            viewTeacher();
        } catch (e) {
            toast("Не получилось");
        }
    };

    if ($("#goLive")) $("#goLive").onclick = function () { setStatus("live", "Тест запущен: доступен с " + hhmm(S.room.window.startMs) + " до " + hhmm(S.room.window.endMs)); };
    if ($("#pause")) $("#pause").onclick = function () { setStatus("draft", "Учитель приостановил тест"); };
    $("#close").onclick = function () { setStatus("closed", "Тест закрыт"); };
}

function tabChat() {
    $("#tabBody").innerHTML = '<div class="sheet">' +
        '<div class="row between"><h2>Чат класса</h2><button class="btn small ghost" id="clearChat">Очистить</button></div>' +
        '<div class="chat-log" id="chatLog" style="margin-top:10px"></div>' +
        '<form class="chat-form" id="chatForm">' +
        '<input class="grow" id="chatInput" type="text" maxlength="500" placeholder="Сообщение классу" autocomplete="off">' +
        '<button class="btn" type="submit">→</button>' +
        '</form>' +
        '</div>';
    wireChat();
    $("#clearChat").onclick = async function () {
        if (confirm("Удалить все сообщения?")) {
            await S.store.clearChat(S.code);
            toast("Чат очищен");
        }
    };
    paintChat();
}

function tabClass() {
    $("#tabBody").innerHTML = '<div class="sheet" id="resultsSheet">' +
        '<div class="row between"><h2>Класс</h2>' +
        '<div class="row" style="gap:6px">' +
        '<button class="btn small ghost" id="csv">Выгрузить</button>' +
        '<button class="btn small danger" id="reset">Сбросить</button>' +
        '</div>' +
        '</div>' +
        '<div id="resultsBody" style="margin-top:12px"></div>' +
        '</div>';
    $("#reset").onclick = async function () {
        if (!confirm("Удалить все ответы учеников?")) return;
        await S.store.clearResults(S.code);
        toast("Результаты сброшены");
    };
    $("#csv").onclick = exportCsv;
    paintResults();
}

function paintResults() {
    const box = document.getElementById("resultsBody");
    if (!box || !S.room) return;
    const qs = (S.room.quiz && S.room.quiz.questions) || [];
    const done = S.results.filter(function (r) { return r.status === "done"; });
    if (!S.results.length) {
        box.innerHTML = '<p class="muted">Пока никто не вошёл. Назовите классу код <b class="kbd">' + esc(S.room.code) + '</b>.</p>';
        return;
    }
    const rows = S.results.slice().sort(function (a, b) {
        return (b.score || 0) - (a.score || 0) || String(a.name).localeCompare(String(b.name));
    });

    let sumPct = 0;
    done.forEach(function (r) { sumPct += (r.score || 0) / (r.total || 1); });
    const avg = done.length ? Math.round(sumPct / done.length * 100) : 0;

    let rowsHtml = "";
    rows.forEach(function (r) {
        rowsHtml += '<tr>' +
            '<td>' + esc(r.name || "Гость") + '</td>' +
            '<td class="tiny">' + (r.status === "done" ? "сдал в " + hhmm(r.finishedAt) : r.status === "in_progress" ? "пишет" : "в чате") + '</td>' +
            '<td class="num">' + (r.status === "done" ? esc(r.score) + " / " + esc(r.total) : "—") + '</td>' +
            '</tr>';
    });

    let qsStatsHtml = "";
    if (done.length && qs.length) {
        qs.forEach(function (q, i) {
            const ok = done.filter(function (r) { return r.answers && r.answers[q.id] === q.correct; }).length;
            const pct = Math.round(ok / done.length * 100);
            qsStatsHtml += '<div style="margin-top:9px"><div class="tiny">' + (i + 1) + '. ' + esc(q.text) + ' — ' + pct + '%</div><div class="bar"><i style="width:' + pct + '%"></i></div></div>';
        });
    }

    box.innerHTML = '<div class="row" style="gap:16px;margin-bottom:10px">' +
        '<div><div class="tiny">В комнате</div><div class="big-time">' + S.results.length + '</div></div>' +
        '<div><div class="tiny">Сдали</div><div class="big-time">' + done.length + '</div></div>' +
        '<div><div class="tiny">Средний балл</div><div class="big-time">' + avg + '%</div></div>' +
        '</div>' +
        '<table><thead><tr><th>Ученик</th><th>Статус</th><th class="num">Балл</th></tr></thead><tbody>' +
        rowsHtml +
        '</tbody></table>' +
        (qsStatsHtml ? '<hr><h3>Где ошибаются</h3>' + qsStatsHtml : '');
}

function exportCsv() {
    const qs = (S.room.quiz && S.room.quiz.questions) || [];
    const head = ["Ученик", "Статус", "Балл", "Всего", "Процент", "Сдал в"];
    qs.forEach(function (q, i) { head.push("В" + (i + 1)); });

    const lines = [head.join(";")];
    S.results.forEach(function (r) {
        const pct = r.total ? Math.round((r.score || 0) / r.total * 100) : 0;
        const row = [r.name || "", r.status, r.score == null ? "" : r.score, r.total || "", pct + "%", r.finishedAt ? hhmm(r.finishedAt) : ""];
        qs.forEach(function (q) {
            const a = r.answers && r.answers[q.id];
            row.push(a == null ? "" : (a === q.correct ? "1" : "0"));
        });
        lines.push(row.map(function (v) { return String(v).replace(/;/g, ","); }).join(";"));
    });

    const csv = "\uFEFF" + lines.join("\n");
    copyText(csv, "Таблица скопирована — вставьте в Excel");
}

function viewStudent() {
    const r = S.room;
    if (!r) {
        app.innerHTML = '<div class="sheet"><p>Комната закрыта или удалена.</p><button class="btn" id="home" style="margin-top:10px">На главную</button></div>';
        $("#home").onclick = function () { stopSubs(); S.view = "home"; renderAll(); };
        return;
    }
    const ph = phaseOf(r);
    const mine = myResult();

    app.innerHTML = '<div class="row between" style="margin-bottom:12px">' +
        '<button class="btn ghost small" id="leave">← Выйти</button>' +
        '<span class="tiny">' + esc(me.name) + ' · код <b class="kbd">' + esc(r.code) + '</b></span>' +
        '</div>' +
        '<div class="sheet margin-line">' +
        '<h2>' + esc(r.title) + '</h2>' +
        '<p class="tiny" style="margin-top:4px">Учитель: ' + esc(r.teacherName) + '</p>' +
        '<div class="banner ' + (ph.key === "live" ? "go" : ph.key === "closed" || ph.key === "after" ? "stop" : "wait") + '" id="banner" style="margin-top:12px"></div>' +
        '<div id="action" style="margin-top:12px"></div>' +
        '</div>' +
        '<div class="sheet">' +
        '<h2>Чат класса</h2>' +
        '<div class="chat-log" id="chatLog" style="margin-top:10px"></div>' +
        '<form class="chat-form" id="chatForm">' +
        '<input class="grow" id="chatInput" type="text" maxlength="500" placeholder="Написать классу" autocomplete="off">' +
        '<button class="btn" type="submit">→</button>' +
        '</form>' +
        '</div>';

    $("#leave").onclick = function () { stopSubs(); S.view = "home"; S.room = null; S.code = null; renderAll(); };
    wireChat();
    paintChat();
    paintBanner();

    const act = $("#action");
    if (mine && mine.status === "done") {
        act.innerHTML = r.settings.showResults
            ? '<div class="banner go">Ответы приняты: <b>' + esc(mine.score) + ' из ' + esc(mine.total) + '</b> (' + Math.round(mine.score / (mine.total || 1) * 100) + '%)</div>'
            : '<div class="banner">Ответы приняты. Оценку объявит учитель.</div>';
        return;
    }
    const ready = canStart(r);
    act.innerHTML = '<button class="btn wide" id="start" ' + (ready ? "" : "disabled") + '>' + (ready ? "Начать тест" : "Тест пока недоступен") + '</button>';
    if (ready) $("#start").onclick = startTest;
}

function paintBanner() {
    const b = document.getElementById("banner");
    if (!b || !S.room) return;
    const r = S.room;
    const ph = phaseOf(r);
    const w = r.window;
    const windowText = "Окно: " + hhmm(w.startMs) + "–" + hhmm(w.endMs);

    if (ph.key === "live") b.innerHTML = 'Тест открыт. Осталось <span class="big-time">' + clock(ph.ms) + '</span><div class="tiny">' + windowText + '</div>';
    else if (ph.key === "before") b.innerHTML = 'Начало в ' + hhmm(w.startMs) + '. Через <span class="big-time">' + clock(ph.ms) + '</span><div class="tiny">' + windowText + '</div>';
    else if (ph.key === "after") b.innerHTML = 'Время вышло — тест закрылся в ' + hhmm(w.endMs) + '.';
    else if (ph.key === "closed") b.innerHTML = 'Учитель закрыл тест.';
    else if (ph.key === "empty") b.innerHTML = 'Учитель ещё готовит вопросы.';
    else b.innerHTML = 'Ждём, когда учитель запустит тест.<div class="tiny">' + windowText + '</div>';

    b.className = "banner " + (ph.key === "live" ? "go" : (ph.key === "closed" || ph.key === "after") ? "stop" : "wait");
}

function startTest() {
    const r = S.room;
    const qs = (r.quiz && r.quiz.questions) || [];
    const order = (r.settings && r.settings.shuffle ? shuffled(qs) : qs).map(function (q) { return q.id; });
    const saved = lsGet("klass.attempt." + r.code + "." + me.uid, null);
    S.attempt = saved && saved.order ? saved : { order: order, answers: {}, startedAt: now(), idx: 0 };
    lsSet("klass.attempt." + r.code + "." + me.uid, S.attempt);
    saveMyResult({ status: "in_progress", startedAt: S.attempt.startedAt });
    S.view = "test";
    renderAll();
}

function viewTest() {
    const r = S.room;
    const at = S.attempt;
    if (!r || !at) { S.view = "student"; return renderAll(); }
    const qs = (r.quiz && r.quiz.questions) || [];

    function byId(id) {
        return qs.find(function (q) { return q.id === id; });
    }

    const q = byId(at.order[at.idx]);
    if (!q) return submitTest();
    const answered = Object.keys(at.answers).length;

    let dotsHtml = "";
    at.order.forEach(function (id, i) {
        dotsHtml += '<span class="' + (i === at.idx ? "now" : (at.answers[id] != null ? "done" : "")) + '"></span>';
    });

    let optsHtml = "";
    q.options.forEach(function (o, j) {
        const mark = "АБВГДЕ"[j] || (j + 1);
        optsHtml += '<button class="answer" data-pick="' + j + '" aria-pressed="' + (at.answers[q.id] === j) + '">' +
            '<span class="mark">' + mark + '</span><span>' + esc(o) + '</span>' +
            '</button>';
    });

    app.innerHTML = '<div class="row between" style="margin-bottom:10px">' +
        '<span class="tiny">Вопрос ' + (at.idx + 1) + ' из ' + at.order.length + '</span>' +
        '<span class="pill live" id="testTimer"><i class="dot"></i>—</span>' +
        '</div>' +
        '<div class="progress-dots">' + dotsHtml + '</div>' +
        '<div class="sheet margin-line">' +
        '<h2 style="font-size:18px;line-height:1.3">' + esc(q.text) + '</h2>' +
        '<div style="margin-top:12px">' + optsHtml + '</div>' +
        '<div class="row" style="margin-top:16px">' +
        '<button class="btn ghost" id="prev" ' + (at.idx === 0 ? "disabled" : "") + '>Назад</button>' +
        (at.idx < at.order.length - 1 ? '<button class="btn grow" id="next">Дальше</button>' : '<button class="btn grow" id="finish">Завершить (' + answered + '/' + at.order.length + ')</button>') +
        '</div>' +
        '</div>' +
        '<p class="tiny" style="margin-top:10px;text-align:center">Ответы сохраняются на телефоне: если страница перезагрузится, вы вернётесь сюда же.</p>';

    app.querySelectorAll("[data-pick]").forEach(function (b) {
        b.onclick = function () {
            at.answers[q.id] = +b.dataset.pick;
            lsSet("klass.attempt." + r.code + "." + me.uid, at);
            if (at.idx < at.order.length - 1) {
                at.idx++;
                viewTest();
            } else {
                viewTest();
            }
        };
    });

    if ($("#prev")) {
        $("#prev").onclick = function () {
            at.idx = Math.max(0, at.idx - 1);
            viewTest();
        };
    }

    if ($("#next")) {
        $("#next").onclick = function () {
            at.idx = Math.min(at.order.length - 1, at.idx + 1);
            viewTest();
        };
    }

    if ($("#finish")) {
        $("#finish").onclick = function () {
            if (answered < at.order.length && !confirm("Отвечено " + answered + " из " + at.order.length + ". Завершить?")) {
                return;
            }
            submitTest();
        };
    }

    paintTestTimer();
}

function paintTestTimer() {
    const el = document.getElementById("testTimer");
    if (!el || !S.attempt || !S.room) return;
    const left = deadlineOf(S.room, S.attempt.startedAt) - now();
    el.innerHTML = '<i class="dot"></i> ' + clock(left);
    if (left <= 0) submitTest();
}

async function submitTest() {
    const r = S.room;
    const at = S.attempt;
    if (!at || S.submitting) return;
    S.submitting = true;
    const sc = scoreOf(r, at.answers);
    await saveMyResult({
        status: "done",
        answers: at.answers,
        score: sc.correct,
        total: sc.total,
        startedAt: at.startedAt,
        finishedAt: now()
    });
    try { localStorage.removeItem("klass.attempt." + r.code + "." + me.uid); } catch (e) { }
    S.attempt = null;
    S.submitting = false;
    S.view = "student";
    renderAll();
    toast("Ответы отправлены");
}

async function saveMyResult(patch) {
    if (!S.code) return;
    const prev = myResult() || { uid: me.uid, name: me.name, total: 0, score: null, answers: {} };
    const rec = Object.assign({}, prev, patch, { uid: me.uid, name: me.name || "Гость", updatedAt: now() });
    try {
        await S.store.saveResult(S.code, rec);
    } catch (e) {
        console.warn("result:", e);
    }
}

function wireChat() {
    const form = document.getElementById("chatForm");
    if (!form) return;
    form.onsubmit = async function (e) {
        e.preventDefault();
        const input = document.getElementById("chatInput");
        const text = (input.value || "").trim();
        if (!text) return;
        input.value = "";
        await say(text);
    };
}

function paintChat() {
    const log = document.getElementById("chatLog");
    if (!log) return;
    const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 40;

    let msgsHtml = "";
    if (S.messages.length) {
        S.messages.forEach(function (m) {
            if (m.role === "system") {
                msgsHtml += '<div class="msg system">' + esc(m.text) + '</div>';
            } else {
                msgsHtml += '<div class="msg ' + (m.uid === me.uid ? "mine" : "") + ' ' + (m.role === "teacher" ? "teacher" : "") + '">' +
                    '<div class="who">' + esc(m.name) + (m.role === "teacher" ? " · учитель" : "") + ' · ' + hhmm(m.ts) + '</div>' + esc(m.text) +
                    '</div>';
            }
        });
    } else {
        msgsHtml = '<p class="muted">Сообщений пока нет.</p>';
    }

    log.innerHTML = msgsHtml;
    if (stick) log.scrollTop = log.scrollHeight;
}

function copyText(text, okMsg) {
    const done = function () { toast(okMsg || "Скопировано"); };
    function fallback() {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand("copy");
            done();
        } catch (e) {
            toast("Скопируйте вручную: " + text.slice(0, 40));
        }
        ta.remove();
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    } else {
        fallback();
    }
}

setInterval(function () {
    if (S.view === "test") paintTestTimer();
    else if (S.view === "student") {
        const before = canStart(S.room);
        paintBanner();
        const btn = document.getElementById("start");
        if (btn && before !== !btn.disabled) {
            btn.disabled = !before;
            btn.textContent = before ? "Начать тест" : "Тест пока недоступен";
            if (before) btn.onclick = startTest;
        }
    } else if (S.view === "teacher" && S.tab === "time" && S.room) {
        const b = document.querySelector("#tabBody .banner");
        const ph = phaseOf(S.room);
        if (b && ph.ms != null) {
            const t = b.querySelector(".big-time");
            if (t) t.textContent = clock(ph.ms);
        }
    }
}, 1000);

(async function boot() {
    app.innerHTML = '<div class="sheet"><p class="muted">Загружаем класс…</p></div>';

    S.store = rtdbStore(db);
    S.ready = true;

    const hash = (location.hash || "").replace("#", "").trim().toUpperCase();
    const last = lsGet("klass.last", null);

    if (hash && hash.length >= 4) {
        const room = await S.store.getRoom(hash);
        if (room) {
            S.view = "home";
            renderAll();
            const input = document.getElementById("joinCode");
            if (input) { input.value = hash; input.focus(); }
            return;
        }
    }
    if (last && last.code) {
        const room = await S.store.getRoom(last.code);
        if (room) {
            S.code = last.code;
            S.room = room;
            S.isTeacher = last.role === "teacher" && (room.teacherUid === me.uid);
            S.view = S.isTeacher ? "teacher" : "student";
            if (S.isTeacher) S.draft = JSON.parse(JSON.stringify(room.quiz || { questions: [] }));
            subscribeRoom(last.code);
            renderAll();
            return;
        }
    }
    renderAll();
})();