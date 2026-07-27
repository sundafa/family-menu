// ===== 默认菜单 =====
const defaultMenu = {
  breakfast: [
    '牛奶', '豆浆', '油条', '烤面包', '煎鸡蛋', '煮鸡蛋',
    '小米粥', '鸡蛋饼', '老豆腐', '锅巴菜', '煎饼果子', '煎火腿', '薯饼'
  ],
  lunch_dinner: {
    meat: {
      pork: ['煮排骨', '红烧排骨', '红烧肉', '猪肉炖粉条'],
      beef: ['炖牛肉', '土豆炖牛肉', '番茄炖牛腩', '咖喱牛肉饭', '肥牛饭', '肥牛乌冬面', '咖喱肥牛饭', '煎牛排'],
      chicken: ['照烧鸡肉饭', '辣子鸡丁', '炸鸡排'],
      fish: ['熬带鱼'],
      shrimp: ['白煮虾']
    },
    vegetable: ['豆角炒肉末', '西红柿炒鸡蛋', '芹菜炒鸡蛋', '黄瓜炒鸡蛋', '青椒炒鸡蛋', '黄瓜炒虾仁', '苜蓿虾仁', '蒜蓉绿白菜', '香菇油菜', '蒸西兰花', '白煮菠菜'],
    staple: ['杂粮饭', '馒头', '麻酱面', '凉皮', '冷面'],
    fried: ['炸薯条', '炸鸡柳', '炸丸子', '炸热狗棒']
  }
};

// ===== 配置 =====
const mealNames = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' };
const categoryConfig = {
  meat: {
    name: '荤菜', emoji: '🍖',
    subcategories: { pork: '猪肉', beef: '牛肉', chicken: '鸡肉', fish: '鱼肉', shrimp: '虾类' }
  },
  vegetable: { name: '素菜', emoji: '🥬' },
  staple: { name: '主食', emoji: '🍚' },
  fried: { name: '炸物', emoji: '🍟' }
};

const MQTT_BROKER = 'wss://broker.emqx.io:8084/mqtt';
const STORAGE_KEY = 'fm-state-v1';
const DATA_VERSION = 4;

// ===== 房间ID =====
function getRoomId() {
  const params = new URLSearchParams(location.search);
  let roomId = params.get('room');
  if (!roomId) {
    roomId = generateRoomId();
    params.set('room', roomId);
    const newUrl = location.pathname + '?' + params.toString() + location.hash;
    history.replaceState({}, '', newUrl);
  }
  return roomId;
}

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

// ===== 状态 =====
const clientId = 'fm-' + Math.random().toString(16).substr(2, 10);
const roomId = getRoomId();
const topicBase = `fm/${roomId}`;
const eventsTopic = `${topicBase}/events`;

const state = {
  member: localStorage.getItem('fm-member') || '',
  currentDate: formatDate(new Date()),
  currentMeal: 'breakfast',
  menu: JSON.parse(JSON.stringify(defaultMenu)),
  selections: {},
  onlineMembers: [],
  mqttClient: null,
  connected: false,
  newDishes: new Set()
};

// ===== localStorage 持久化 =====
function loadLocalState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    // 数据版本检查，旧版本数据清空重来
    if (saved.version !== DATA_VERSION) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: DATA_VERSION, menu: defaultMenu, selections: {} }));
      state.selections = {};
      return;
    }
    if (saved.menu) {
      // 合并：默认菜单 + 自定义菜品
      mergeMenu(state.menu, saved.menu);
    }
    if (saved.selections) {
      state.selections = saved.selections;
      cleanOldSelections();
    }
  } catch (e) {
    console.error('加载本地数据失败:', e);
    state.selections = {};
  }
}

function saveLocalState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: DATA_VERSION,
      menu: state.menu,
      selections: state.selections
    }));
  } catch (e) {
    console.error('保存本地数据失败:', e);
  }
}

function mergeMenu(target, source) {
  if (source.breakfast) {
    source.breakfast.forEach(d => {
      if (!target.breakfast.includes(d)) target.breakfast.push(d);
    });
  }
  if (source.lunch_dinner) {
    const ld = source.lunch_dinner;
    if (ld.meat) {
      for (const [key, dishes] of Object.entries(ld.meat)) {
        if (!target.lunch_dinner.meat[key]) target.lunch_dinner.meat[key] = [];
        dishes.forEach(d => {
          if (!target.lunch_dinner.meat[key].includes(d)) {
            target.lunch_dinner.meat[key].push(d);
          }
        });
      }
    }
    for (const cat of ['vegetable', 'staple', 'fried']) {
      if (ld[cat]) {
        ld[cat].forEach(d => {
          if (!target.lunch_dinner[cat].includes(d)) {
            target.lunch_dinner[cat].push(d);
          }
        });
      }
    }
  }
}

function cleanOldSelections() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = formatDate(cutoff);
  for (const date of Object.keys(state.selections)) {
    if (date < cutoffStr) delete state.selections[date];
  }
}

// ===== 工具函数 =====
function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDateDisplay(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((date - today) / 86400000);
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  let label = `${date.getMonth() + 1}月${date.getDate()}日 ${weekdays[date.getDay()]}`;
  if (diff === 0) return '📍 今天 ' + label;
  if (diff === 1) return '明天 ' + label;
  if (diff === -1) return '昨天 ' + label;
  return label;
}

function getMySelections() {
  if (!state.member) return [];
  const dateData = state.selections[state.currentDate];
  if (!dateData) return [];
  const mealData = dateData[state.currentMeal];
  if (!mealData) return [];
  return mealData[state.member] || [];
}

function getDishSelectors(dish) {
  const dateData = state.selections[state.currentDate];
  if (!dateData) return [];
  const mealData = dateData[state.currentMeal];
  if (!mealData) return [];
  const selectors = [];
  for (const [member, dishes] of Object.entries(mealData)) {
    if (dishes && dishes.includes(dish)) selectors.push(member);
  }
  return selectors;
}

function showToast(message) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

function updateConnStatus(cls, text) {
  const el = document.getElementById('conn-status');
  el.className = `conn-status ${cls}`;
  el.textContent = text;
}

// ===== MQTT 连接 =====
function connectMQTT() {
  const willPayload = JSON.stringify({
    type: 'leave', sender: clientId, member: state.member
  });

  state.mqttClient = mqtt.connect(MQTT_BROKER, {
    clientId: clientId,
    keepalive: 30,
    clean: true,
    reconnectPeriod: 3000,
    connectTimeout: 8000,
    will: {
      topic: eventsTopic,
      payload: willPayload,
      qos: 0,
      retain: false
    }
  });

  state.mqttClient.on('connect', () => {
    state.connected = true;
    updateConnStatus('connected', '已连接 · 房间 ' + roomId);
    state.mqttClient.subscribe(eventsTopic, { qos: 0 });

    // 广播加入
    publish({ type: 'join', sender: clientId, member: state.member });
    // 请求同步
    publish({ type: 'sync_request', sender: clientId });
  });

  // 心跳：每20秒广播一次在线状态
  if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
  state.heartbeatTimer = setInterval(() => {
    if (state.connected && state.member) {
      publish({ type: 'presence', sender: clientId, member: state.member });
    }
  }, 20000);

  state.mqttClient.on('reconnect', () => {
    updateConnStatus('connecting', '重连中...');
  });

  state.mqttClient.on('close', () => {
    state.connected = false;
    updateConnStatus('disconnected', '连接断开，重连中...');
  });

  state.mqttClient.on('error', (err) => {
    console.error('MQTT error:', err);
  });

  state.mqttClient.on('message', (topic, message) => {
    if (topic !== eventsTopic) return;
    let msg;
    try {
      msg = JSON.parse(message.toString());
    } catch {
      return;
    }
    if (msg.sender === clientId) return; // 忽略自己的消息
    handleMessage(msg);
  });
}

function publish(msg) {
  if (state.mqttClient && state.mqttClient.connected) {
    state.mqttClient.publish(eventsTopic, JSON.stringify(msg), { qos: 0, retain: false });
  }
}

// ===== 消息处理 =====
function handleMessage(msg) {
  switch (msg.type) {
    case 'sync_request':
      // 有人请求同步，把我的状态发过去
      publish({
        type: 'sync_response',
        sender: clientId,
        member: state.member,
        target: msg.sender,
        menu: state.menu,
        selections: state.selections
      });
      break;

    case 'sync_response':
      // 收到别人的状态，合并
      if (msg.target && msg.target !== clientId) return;
      // 记录对方在线
      if (msg.member && !state.onlineMembers.includes(msg.member)) {
        state.onlineMembers.push(msg.member);
      }
      let changed = false;
      if (msg.menu) {
        const before = JSON.stringify(state.menu);
        mergeMenu(state.menu, msg.menu);
        if (JSON.stringify(state.menu) !== before) changed = true;
      }
      if (msg.selections) {
        for (const [date, meals] of Object.entries(msg.selections)) {
          if (!state.selections[date]) {
            state.selections[date] = meals;
            changed = true;
          } else {
            for (const [meal, members] of Object.entries(meals)) {
              if (!state.selections[date][meal]) {
                state.selections[date][meal] = members;
                changed = true;
              } else {
                for (const [member, dishes] of Object.entries(members)) {
                  if (!state.selections[date][meal][member]) {
                    state.selections[date][meal][member] = dishes;
                    changed = true;
                  } else {
                    // 合并：取并集
                    dishes.forEach(d => {
                      if (!state.selections[date][meal][member].includes(d)) {
                        state.selections[date][meal][member].push(d);
                        changed = true;
                      }
                    });
                  }
                }
              }
            }
          }
        }
      }
      if (changed) {
        saveLocalState();
        renderMenu();
        renderSelections();
      }
      break;

    case 'toggle':
      if (!state.selections[msg.date]) state.selections[msg.date] = {};
      if (!state.selections[msg.date][msg.meal]) state.selections[msg.date][msg.meal] = {};
      if (!state.selections[msg.date][msg.meal][msg.member]) state.selections[msg.date][msg.meal][msg.member] = [];

      const items = state.selections[msg.date][msg.meal][msg.member];
      if (msg.action === 'add') {
        if (!items.includes(msg.dish)) items.push(msg.dish);
        if (msg.date === state.currentDate) {
          showToast(`🍽️ ${msg.member} 选了「${msg.dish}」(${mealNames[msg.meal]})`);
        }
      } else {
        const idx = items.indexOf(msg.dish);
        if (idx >= 0) items.splice(idx, 1);
      }
      saveLocalState();
      if (msg.date === state.currentDate) {
        renderMenu();
        renderSelections();
      }
      break;

    case 'clear':
      if (state.selections[msg.date] && state.selections[msg.date][msg.meal]) {
        delete state.selections[msg.date][msg.meal][msg.member];
      }
      saveLocalState();
      if (msg.date === state.currentDate) {
        renderMenu();
        renderSelections();
      }
      break;

    case 'dish_added':
      if (msg.menu) {
        mergeMenu(state.menu, msg.menu);
        if (msg.newDish) {
          state.newDishes.add(msg.newDish);
          showToast(`✨ 新菜品「${msg.newDish}」已加入菜单`);
        }
        saveLocalState();
        renderMenu();
      }
      break;

    case 'join':
      if (msg.member) {
        if (!state.onlineMembers.includes(msg.member)) {
          state.onlineMembers.push(msg.member);
        }
        // 回应同步请求
        publish({
          type: 'sync_response',
          sender: clientId,
          member: state.member,
          target: msg.sender,
          menu: state.menu,
          selections: state.selections
        });
        renderSelections();
      }
      break;

    case 'presence':
      if (msg.member) {
        if (!state.onlineMembers.includes(msg.member)) {
          state.onlineMembers.push(msg.member);
          renderSelections();
        }
      }
      break;

    case 'leave':
      state.onlineMembers = state.onlineMembers.filter(m => m !== msg.member);
      renderSelections();
      break;
  }
}

// ===== 操作 =====
function toggleDish(dish) {
  if (!state.member) {
    showMemberModal();
    return;
  }
  if (!state.selections[state.currentDate]) state.selections[state.currentDate] = {};
  if (!state.selections[state.currentDate][state.currentMeal]) state.selections[state.currentDate][state.currentMeal] = {};
  if (!state.selections[state.currentDate][state.currentMeal][state.member]) state.selections[state.currentDate][state.currentMeal][state.member] = [];

  const items = state.selections[state.currentDate][state.currentMeal][state.member];
  const idx = items.indexOf(dish);
  const action = idx >= 0 ? 'remove' : 'add';
  if (idx >= 0) {
    items.splice(idx, 1);
  } else {
    items.push(dish);
  }

  saveLocalState();
  renderMenu();
  renderSelections();

  publish({
    type: 'toggle',
    sender: clientId,
    date: state.currentDate,
    meal: state.currentMeal,
    member: state.member,
    dish,
    action
  });
}

function clearMySelections() {
  if (!state.member) return;
  if (state.selections[state.currentDate] && state.selections[state.currentDate][state.currentMeal]) {
    delete state.selections[state.currentDate][state.currentMeal][state.member];
  }
  saveLocalState();
  renderMenu();
  renderSelections();
  showToast('已清空你的选择');

  publish({
    type: 'clear',
    sender: clientId,
    date: state.currentDate,
    meal: state.currentMeal,
    member: state.member
  });
}

function changeDate(delta) {
  const date = new Date(state.currentDate + 'T00:00:00');
  date.setDate(date.getDate() + delta);
  state.currentDate = formatDate(date);
  renderDate();
  renderMenu();
  renderSelections();
}

function goToday() {
  state.currentDate = formatDate(new Date());
  renderDate();
  renderMenu();
  renderSelections();
  showToast('回到今天');
}

function changeMeal(meal) {
  state.currentMeal = meal;
  document.querySelectorAll('.meal-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.meal === meal);
  });
  renderMenu();
  renderSelections();
}

function addDish(meal, category, subcategory, name) {
  // 本地添加
  if (meal === 'breakfast') {
    if (!state.menu.breakfast.includes(name)) state.menu.breakfast.push(name);
  } else if (category === 'meat' && subcategory) {
    if (!state.menu.lunch_dinner.meat[subcategory]) state.menu.lunch_dinner.meat[subcategory] = [];
    if (!state.menu.lunch_dinner.meat[subcategory].includes(name)) {
      state.menu.lunch_dinner.meat[subcategory].push(name);
    }
  } else if (state.menu.lunch_dinner[category]) {
    if (!state.menu.lunch_dinner[category].includes(name)) {
      state.menu.lunch_dinner[category].push(name);
    }
  }

  state.newDishes.add(name);
  saveLocalState();
  renderMenu();

  // 广播
  publish({
    type: 'dish_added',
    sender: clientId,
    menu: state.menu,
    newDish: name
  });

  showToast(`✨ 已添加「${name}」`);
}

// ===== 渲染 =====
function renderDate() {
  document.getElementById('current-date').textContent = formatDateDisplay(state.currentDate);
}

function renderMenu() {
  const area = document.getElementById('menu-area');
  if (!state.menu) return;

  if (state.currentMeal === 'breakfast') {
    area.innerHTML = renderBreakfastMenu();
  } else {
    area.innerHTML = renderLunchDinnerMenu();
  }

  area.querySelectorAll('.dish-chip').forEach(chip => {
    chip.addEventListener('click', () => toggleDish(chip.dataset.dish));
  });
}

function renderBreakfastMenu() {
  const items = state.menu.breakfast || [];
  if (items.length === 0) return '<p class="no-selections">暂无早餐菜品</p>';
  return `
    <div class="menu-category">
      <h3 class="category-title">🌅 早餐</h3>
      <div class="dish-grid">${items.map(d => renderDishChip(d)).join('')}</div>
    </div>`;
}

function renderLunchDinnerMenu() {
  const ld = state.menu.lunch_dinner || {};
  let html = '';

  const meat = ld.meat || {};
  const hasMeat = Object.values(meat).some(arr => arr && arr.length > 0);
  if (hasMeat) {
    html += '<div class="menu-category"><h3 class="category-title">🍖 荤菜</h3>';
    for (const [key, label] of Object.entries(categoryConfig.meat.subcategories)) {
      const dishes = meat[key] || [];
      if (dishes.length === 0) continue;
      html += `<div class="subcategory"><div class="subcategory-label">${label}</div>`;
      html += `<div class="dish-grid">${dishes.map(d => renderDishChip(d)).join('')}</div></div>`;
    }
    html += '</div>';
  }

  for (const [key, config] of Object.entries(categoryConfig)) {
    if (key === 'meat') continue;
    const dishes = ld[key] || [];
    if (dishes.length === 0) continue;
    html += `<div class="menu-category"><h3 class="category-title">${config.emoji} ${config.name}</h3>`;
    html += `<div class="dish-grid">${dishes.map(d => renderDishChip(d)).join('')}</div></div>`;
  }

  if (!html) return '<p class="no-selections">暂无菜品</p>';
  return html;
}

function renderDishChip(dish) {
  const mySel = getMySelections();
  const selected = mySel.includes(dish);
  const selectors = getDishSelectors(dish);
  const isNew = state.newDishes.has(dish);

  const selectorHTML = selectors.length > 0
    ? `<span class="dish-selectors">${selectors.map(s =>
        `<span class="selector-avatar">${s.charAt(0)}</span>`
      ).join('')}</span>`
    : '<span class="dish-selectors"></span>';

  return `
    <div class="dish-chip ${selected ? 'selected' : ''} ${isNew ? 'new-dish' : ''}" data-dish="${dish}">
      <span class="dish-name">${dish}</span>
      ${selectorHTML}
    </div>`;
}

function renderSelections() {
  const area = document.getElementById('selections-summary');
  const dateData = state.selections[state.currentDate] || {};
  const meals = ['breakfast', 'lunch', 'dinner'];
  let hasAny = false;

  // 统计所有餐次的所有成员
  const allMembers = new Set();
  for (const meal of meals) {
    const md = dateData[meal] || {};
    for (const m of Object.keys(md)) {
      if (md[m] && md[m].length > 0) allMembers.add(m);
    }
  }

  let html = '';

  // 在线家人提示
  const others = state.onlineMembers.filter(m => m !== state.member);
  if (others.length > 0) {
    html += `<div class="online-bar">🟢 在线：${others.join('、')}</div>`;
  }

  for (const meal of meals) {
    const mealData = dateData[meal] || {};
    const members = Object.keys(mealData).filter(m => mealData[m] && mealData[m].length > 0);
    if (members.length === 0) continue;
    hasAny = true;

    const isCurrent = meal === state.currentMeal;
    html += `<div class="summary-card${isCurrent ? ' current-meal' : ''}">`;
    html += `<h3 class="summary-title">${meal === 'breakfast' ? '🌅' : meal === 'lunch' ? '☀️' : '🌙'} ${mealNames[meal]}选择${isCurrent ? ' ←' : ''}</h3>`;

    for (const member of members) {
      const dishes = mealData[member];
      const isMe = member === state.member;
      const isOnline = state.onlineMembers.includes(member);

      html += '<div class="member-selection' + (isMe ? ' me' : '') + '">';
      html += '<div class="member-name">';
      if (isOnline) html += '<span class="online-dot"></span>';
      html += member + (isMe ? ' (我)' : '');
      html += '</div>';
      html += '<div class="member-dishes">';
      html += dishes.map(d => `<span class="dish-tag">${d}</span>`).join('');
      html += '</div></div>';
    }

    if (state.member && mealData[state.member] && mealData[state.member].length > 0 && isCurrent) {
      html += '<button class="clear-btn" onclick="clearMySelections()">🗑️ 清空我本餐的选择</button>';
    }

    html += '</div>';
  }

  if (!hasAny) {
    html += `
      <div class="summary-card">
        <h3 class="summary-title">📋 今日选择</h3>
        <p class="no-selections">还没有人选菜，快选吧！👆</p>
      </div>`;
  }

  area.innerHTML = html;
}

// ===== 名字设置 =====
function showMemberModal() {
  document.getElementById('member-modal').classList.remove('hidden');
  const input = document.getElementById('member-input');
  input.value = state.member;
  setTimeout(() => input.focus(), 100);
}

function saveMember() {
  const name = document.getElementById('member-input').value.trim();
  if (!name) {
    showToast('请输入名字');
    return;
  }
  const oldName = state.member;
  state.member = name;
  localStorage.setItem('fm-member', name);
  document.getElementById('member-modal').classList.add('hidden');

  if (oldName !== name && state.connected) {
    if (oldName) publish({ type: 'leave', sender: clientId, member: oldName });
    publish({ type: 'join', sender: clientId, member: name });
  }
  showToast(`你好，${name}！`);
  renderSelections();
}

// ===== 二维码 =====
function showQRCode() {
  const url = location.href;
  document.getElementById('qr-url').textContent = url;
  document.getElementById('qr-loading').style.display = '';

  const qrImg = document.getElementById('qr-image');
  qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=2&data=${encodeURIComponent(url)}`;

  document.getElementById('qr-modal').classList.remove('hidden');
}

function copyUrl() {
  const url = location.href;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => showToast('链接已复制'));
  } else {
    const ta = document.createElement('textarea');
    ta.value = url;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('链接已复制');
  }
}

// ===== 添加菜品弹窗 =====
function showAddDishModal() {
  const mealSelect = document.getElementById('dish-meal');
  mealSelect.value = state.currentMeal === 'breakfast' ? 'breakfast' : 'lunch_dinner';
  handleMealChange();
  document.getElementById('dish-name').value = '';
  document.getElementById('add-dish-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('dish-name').focus(), 100);
}

function handleMealChange() {
  const meal = document.getElementById('dish-meal').value;
  const fgCategory = document.getElementById('fg-category');
  const fgSubcategory = document.getElementById('fg-subcategory');
  if (meal === 'lunch_dinner') {
    fgCategory.style.display = '';
    handleCategoryChange();
  } else {
    fgCategory.style.display = 'none';
    fgSubcategory.style.display = 'none';
  }
}

function handleCategoryChange() {
  const category = document.getElementById('dish-category').value;
  document.getElementById('fg-subcategory').style.display = (category === 'meat') ? '' : 'none';
}

function confirmAddDish() {
  const name = document.getElementById('dish-name').value.trim();
  if (!name) {
    showToast('请输入菜名');
    return;
  }
  const meal = document.getElementById('dish-meal').value;
  const category = meal === 'lunch_dinner' ? document.getElementById('dish-category').value : null;
  const subcategory = (meal === 'lunch_dinner' && category === 'meat')
    ? document.getElementById('dish-subcategory').value : null;

  if (isDishExists(meal, category, subcategory, name)) {
    showToast(`「${name}」已经在菜单里了`);
    return;
  }

  addDish(meal, category, subcategory, name);
  document.getElementById('add-dish-modal').classList.add('hidden');
}

function isDishExists(meal, category, subcategory, name) {
  if (meal === 'breakfast') return state.menu.breakfast.includes(name);
  if (category === 'meat' && subcategory) {
    const arr = state.menu.lunch_dinner.meat[subcategory];
    return arr && arr.includes(name);
  }
  const arr = state.menu.lunch_dinner[category];
  return Array.isArray(arr) && arr.includes(name);
}

// ===== 初始化 =====
function init() {
  // 加载本地数据
  loadLocalState();

  // 名字
  document.getElementById('member-btn').addEventListener('click', showMemberModal);
  document.getElementById('member-save').addEventListener('click', saveMember);
  document.getElementById('member-cancel').addEventListener('click', () => {
    document.getElementById('member-modal').classList.add('hidden');
  });
  document.getElementById('member-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveMember();
  });

  // 日期
  document.getElementById('prev-day').addEventListener('click', () => changeDate(-1));
  document.getElementById('next-day').addEventListener('click', () => changeDate(1));
  document.getElementById('current-date').addEventListener('click', goToday);
  document.getElementById('today-btn').addEventListener('click', goToday);

  // 餐次
  document.querySelectorAll('.meal-tab').forEach(tab => {
    tab.addEventListener('click', () => changeMeal(tab.dataset.meal));
  });

  // 二维码
  document.getElementById('qr-btn').addEventListener('click', showQRCode);
  document.getElementById('qr-close').addEventListener('click', () => {
    document.getElementById('qr-modal').classList.add('hidden');
  });
  document.getElementById('qr-copy').addEventListener('click', copyUrl);

  // 添加菜品
  document.getElementById('add-dish-btn').addEventListener('click', showAddDishModal);
  document.getElementById('add-dish-cancel').addEventListener('click', () => {
    document.getElementById('add-dish-modal').classList.add('hidden');
  });
  document.getElementById('add-dish-confirm').addEventListener('click', confirmAddDish);
  document.getElementById('dish-meal').addEventListener('change', handleMealChange);
  document.getElementById('dish-category').addEventListener('change', handleCategoryChange);
  document.getElementById('dish-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmAddDish();
  });

  // 点击遮罩关闭
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', e => {
      if (e.target === modal) modal.classList.add('hidden');
    });
  });

  // 首次设置名字
  if (!state.member) {
    setTimeout(showMemberModal, 500);
  }

  // 渲染
  renderDate();
  renderMenu();
  renderSelections();

  // 连接 MQTT
  connectMQTT();
}

init();
