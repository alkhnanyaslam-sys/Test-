// db.js
// تخزين بسيط في ملفات JSON جوه الريبو نفسه (data.json + offset.json)
// الفكرة: الملفات دي بتتقرأ في بداية كل تشغيلة، وبعد المعالجة الـ workflow
// بيعمل commit للتغييرات، فالبيانات بتفضل محفوظة بين كل تشغيلة والتانية.

const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "data.json");
const OFFSET_FILE = path.join(__dirname, "offset.json");

function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, "utf-8").trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.error(`⚠️ فشل قراءة ${file}:`, err.message);
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
}

// ---------- Offset (آخر update_id اتعالج) ----------
function getOffset() {
  const data = readJSON(OFFSET_FILE, { offset: 0 });
  return data.offset || 0;
}

function saveOffset(offset) {
  writeJSON(OFFSET_FILE, { offset });
}

// ---------- Users / Points ----------
function loadUsers() {
  const data = readJSON(DATA_FILE, { users: {} });
  return data.users || {};
}

function saveUsers(users) {
  writeJSON(DATA_FILE, { users });
}

function getUser(users, userId, chatId, username) {
  const key = `${chatId}:${userId}`;
  if (!users[key]) {
    users[key] = {
      userId,
      chatId,
      username: username || null,
      points: 0,
      level: 0,
      helpCount: 0,
    };
  }
  if (username) users[key].username = username;
  return users[key];
}

function addPoints(users, userId, chatId, username, pointsToAdd) {
  const user = getUser(users, userId, chatId, username);
  user.points += pointsToAdd;
  user.helpCount += 1;
  return user;
}

function getLeaderboard(users, chatId, limit = 10) {
  return Object.values(users)
    .filter((u) => u.chatId === chatId)
    .sort((a, b) => b.points - a.points)
    .slice(0, limit);
}

module.exports = {
  getOffset,
  saveOffset,
  loadUsers,
  saveUsers,
  getUser,
  addPoints,
  getLeaderboard,
};
