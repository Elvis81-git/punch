// 全域遊戲狀態變數
let gameMode = 'ai'; // 'ai', 'local', 'online'
let selectedCharacter = null; // 當前玩家選中的角色名 ('ryder', 'swift', 'titan')
let p1Character = null;
let p2Character = null;
let clientSide = 'left'; // 在線上模式代表自己是在 'left' 還 'right'
let myRoomId = null;

// 取得 HTML 元素
const screens = {
  mainMenu: document.getElementById('main-menu'),
  onlineLobby: document.getElementById('online-lobby'),
  charSelect: document.getElementById('char-select'),
  waitingRoom: document.getElementById('waiting-room'),
  gameScreen: document.getElementById('game-screen'),
  gameOver: document.getElementById('game-over')
};

// 切換畫面函數
function showScreen(screenKey) {
  Object.keys(screens).forEach(key => {
    if (key === screenKey) {
      screens[key].classList.add('active');
    } else {
      screens[key].classList.remove('active');
    }
  });
}

// 角色特徵屬性表（本地預載）
const charStats = {
  ryder: { name: 'RYDER', hp: 100, dmgMultiplier: 1.0, speed: 5.5, jumpForce: 16.5, width: 60, height: 120 },
  swift: { name: 'SWIFT', hp: 80, dmgMultiplier: 0.7, speed: 7.5, jumpForce: 19.5, width: 50, height: 110 },
  titan: { name: 'TITAN', hp: 120, dmgMultiplier: 1.3, speed: 4.0, jumpForce: 13.5, width: 80, height: 135 }
};

// 1. 主選單事件
document.getElementById('btn-single').addEventListener('click', () => {
  gameMode = 'ai';
  p1Character = null;
  p2Character = null;
  document.getElementById('char-select-title').innerText = '選擇您的格鬥家 (P1)';
  document.getElementById('p2-controls-help').classList.add('hidden'); // 隱藏P2本地控制說明
  resetCharCards();
  showScreen('charSelect');
});

document.getElementById('btn-local').addEventListener('click', () => {
  gameMode = 'local';
  p1Character = null;
  p2Character = null;
  document.getElementById('char-select-title').innerText = '請選擇 P1 的格鬥家';
  document.getElementById('p2-controls-help').classList.remove('hidden'); // 顯示P2本地控制說明
  resetCharCards();
  showScreen('charSelect');
});

document.getElementById('btn-online-lobby').addEventListener('click', () => {
  gameMode = 'online';
  document.getElementById('p2-controls-help').classList.add('hidden'); // 線上模式不需要顯示P2本地控制
  showScreen('onlineLobby');
  connectSocket(); // 初始化 WebSocket 連線
});

// 2. 線上大廳事件
document.getElementById('btn-lobby-back').addEventListener('click', () => {
  disconnectSocket();
  showScreen('mainMenu');
});

document.getElementById('btn-create-room').addEventListener('click', () => {
  const randomRoomId = Math.floor(1000 + Math.random() * 9000).toString();
  myRoomId = randomRoomId;
  document.getElementById('lobby-status').innerText = `正在建立房間 ${randomRoomId}...`;
  
  // 先去選角色，選完後再發送 join-room
  document.getElementById('char-select-title').innerText = `選擇您的格鬥家 (房間: ${myRoomId})`;
  resetCharCards();
  showScreen('charSelect');
});

document.getElementById('btn-join-room').addEventListener('click', () => {
  const roomInput = document.getElementById('room-input').value.trim().toUpperCase();
  if (roomInput.length < 4) {
    document.getElementById('lobby-status').innerText = '請輸入 4 位房間代碼！';
    return;
  }
  myRoomId = roomInput;
  
  // 先去選角色，選完後再發送 join-room
  document.getElementById('char-select-title').innerText = `選擇您的格鬥家 (加入房間: ${myRoomId})`;
  resetCharCards();
  showScreen('charSelect');
});

// 3. 角色選擇事件
const charCards = document.querySelectorAll('.char-card');
const confirmBtn = document.getElementById('btn-confirm-char');

charCards.forEach(card => {
  card.addEventListener('click', () => {
    charCards.forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    selectedCharacter = card.getAttribute('data-char');
    confirmBtn.classList.remove('disabled');
    confirmBtn.disabled = false;
  });
});

function resetCharCards() {
  charCards.forEach(c => c.classList.remove('selected'));
  selectedCharacter = null;
  confirmBtn.classList.add('disabled');
  confirmBtn.disabled = true;
}

document.getElementById('btn-char-back').addEventListener('click', () => {
  if (gameMode === 'local' && p1Character !== null) {
    // 如果是選 P2 時按返回，回退到選 P1
    p1Character = null;
    document.getElementById('char-select-title').innerText = '請選擇 P1 的格鬥家';
    resetCharCards();
  } else if (gameMode === 'online') {
    showScreen('onlineLobby');
    document.getElementById('lobby-status').innerText = '已取消選擇。';
  } else {
    showScreen('mainMenu');
  }
});

confirmBtn.addEventListener('click', () => {
  if (!selectedCharacter) return;

  if (gameMode === 'ai') {
    p1Character = selectedCharacter;
    // AI 隨機選一個角色
    const chars = ['ryder', 'swift', 'titan'];
    p2Character = chars[Math.floor(Math.random() * chars.length)];
    
    initHUD(p1Character, p2Character, "PLAYER (P1)", "COMPUTER (AI)");
    showScreen('gameScreen');
    startGame(p1Character, p2Character, 'ai', 'left');
  } 
  else if (gameMode === 'local') {
    if (p1Character === null) {
      p1Character = selectedCharacter;
      document.getElementById('char-select-title').innerText = '請選擇 P2 的格鬥家';
      resetCharCards();
    } else {
      p2Character = selectedCharacter;
      initHUD(p1Character, p2Character, "PLAYER 1 (P1)", "PLAYER 2 (P2)");
      showScreen('gameScreen');
      startGame(p1Character, p2Character, 'local', 'left');
    }
  } 
  else if (gameMode === 'online') {
    // 進入線上模式，將角色與房號傳給伺服器
    joinOnlineRoom(myRoomId, selectedCharacter);
  }
});

// 4. 等待房間事件
document.getElementById('btn-waiting-back').addEventListener('click', () => {
  leaveOnlineRoom();
  showScreen('onlineLobby');
  document.getElementById('lobby-status').innerText = '已離開房間。';
});

// 5. 遊戲結束/KO 結算事件
document.getElementById('btn-menu-back').addEventListener('click', () => {
  if (gameMode === 'online') {
    leaveOnlineRoom();
    disconnectSocket();
  }
  cleanupGame();
  showScreen('mainMenu');
});

document.getElementById('btn-rematch').addEventListener('click', () => {
  if (gameMode === 'online') {
    document.getElementById('rematch-status-text').innerText = '已發送再戰請求，等待對手回應...';
    requestRematch();
  } else {
    // AI 或 本地雙人直接重置
    resetLocalGame();
  }
});

// UI HUD 更新功能
function updateHUD(p1Hp, p2Hp, p1Energy = 0, p2Energy = 0) {
  // P1 血量 (即時與緩衝)
  const p1HpPercent = Math.max(0, (p1Hp / charStats[p1Character].hp) * 100);
  document.getElementById('p1-hp').style.width = p1HpPercent + '%';
  setTimeout(() => {
    const catchEl = document.getElementById('p1-hp-catch');
    if (catchEl) catchEl.style.width = p1HpPercent + '%';
  }, 150); // 延遲縮短緩衝條

  // P2 血量
  const p2HpPercent = Math.max(0, (p2Hp / charStats[p2Character].hp) * 100);
  document.getElementById('p2-hp').style.width = p2HpPercent + '%';
  setTimeout(() => {
    const catchEl = document.getElementById('p2-hp-catch');
    if (catchEl) catchEl.style.width = p2HpPercent + '%';
  }, 150);

  // 能量條更新
  document.getElementById('p1-energy').style.width = Math.min(100, p1Energy) + '%';
  document.getElementById('p2-energy').style.width = Math.min(100, p2Energy) + '%';
}

function initHUD(p1Type, p2Type, p1NameVal = "P1", p2NameVal = "P2") {
  p1Character = p1Type;
  p2Character = p2Type;

  document.getElementById('p1-name').innerText = p1NameVal + ` (${charStats[p1Type].name})`;
  document.getElementById('p2-name').innerText = p2NameVal + ` (${charStats[p2Type].name})`;
  
  document.getElementById('p1-hud-img').src = `assets/${p1Type}.png`;
  document.getElementById('p2-hud-img').src = `assets/${p2Type}.png`;
  
  updateHUD(charStats[p1Type].hp, charStats[p2Type].hp, 0, 0);
}

function showGameOverScreen(winnerText) {
  document.getElementById('winner-text').innerText = winnerText;
  document.getElementById('rematch-status-text').innerText = '';
  showScreen('gameOver');
}
