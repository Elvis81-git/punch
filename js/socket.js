let socket = null;
let isConnected = false;

function connectSocket() {
  if (socket) return;
  
  // 連接到當前託管靜態網頁的相同網址/伺服器
  socket = io();

  socket.on('connect', () => {
    isConnected = true;
    console.log('已連線至伺服器');
    document.getElementById('lobby-status').innerText = '伺服器已連線，請創建或加入房間。';
  });

  socket.on('connect_error', (error) => {
    console.error('連線伺服器失敗:', error);
    document.getElementById('lobby-status').innerText = '無法連線至伺服器，請重試或改用本地模式！';
  });

  // 成功加入房間
  socket.on('room-joined', ({ roomId, side, isWaiting }) => {
    clientSide = side;
    myRoomId = roomId;

    if (isWaiting) {
      // 顯示等待對手畫面
      document.getElementById('waiting-room-code').innerText = roomId;
      document.getElementById('waiting-char-name').innerText = selectedCharacter.toUpperCase();
      document.getElementById('waiting-char-avatar').style.backgroundImage = `url(assets/${selectedCharacter}.png)`;
      showScreen('waitingRoom');
    } else {
      document.getElementById('lobby-status').innerText = '正在加入房間並準備遊戲...';
    }
  });

  // 伺服器通知錯誤
  socket.on('error-msg', (msg) => {
    alert(msg);
    showScreen('onlineLobby');
    document.getElementById('lobby-status').innerText = msg;
  });

  // 雙人均到齊，遊戲開始
  socket.on('game-start', ({ opponent, self }) => {
    console.log('對手已到齊，遊戲開始！', { self, opponent });
    
    // 根據自己的 clientSide 決定 P1、P2 分別是誰
    let p1Char, p2Char;
    let p1Name, p2Name;

    if (clientSide === 'left') {
      p1Char = self.character;
      p2Char = opponent.character;
      p1Name = "YOU";
      p2Name = "OPPONENT";
    } else {
      p1Char = opponent.character;
      p2Char = self.character;
      p1Name = "OPPONENT";
      p2Name = "YOU";
    }

    // 初始化 HUD
    initHUD(p1Char, p2Char, p1Name, p2Name);
    
    // 切換至遊戲畫面
    showScreen('gameScreen');
    
    // 啟動 Canvas 遊戲引擎
    startGame(p1Char, p2Char, 'online', clientSide);
  });

  // 接收對手的更新數據
  socket.on('opponent-update', (data) => {
    if (typeof receiveOpponentUpdate === 'function') {
      receiveOpponentUpdate(data);
    }
  });

  // 接收對手傳來的受擊事件 (我們受擊了)
  socket.on('get-hit', (hitData) => {
    if (typeof receiveHitData === 'function') {
      receiveHitData(hitData);
    }
  });

  // 對手請求再戰
  socket.on('rematch-requested', () => {
    document.getElementById('rematch-status-text').innerText = '對手已發起再戰請求，點擊上方按鈕接受！';
  });

  // 遊戲重置
  socket.on('game-reset', ({ self, opponent }) => {
    document.getElementById('rematch-status-text').innerText = '遊戲重置，準備開始！';
    setTimeout(() => {
      resetOnlineGame(self, opponent);
    }, 1000);
  });

  // 對手離線
  socket.on('opponent-disconnected', () => {
    alert('對手已斷開連線！遊戲將結束。');
    cleanupGame();
    showScreen('onlineLobby');
    document.getElementById('lobby-status').innerText = '對手離開了遊戲。';
  });
}

// 發送自己的更新數據給對手
function sendPlayerUpdate(data) {
  if (socket && isConnected) {
    socket.emit('player-update', data);
  }
}

// 判定打中對手，將受擊資訊傳過去
function sendHitData(hitData) {
  if (socket && isConnected) {
    socket.emit('hit-opponent', hitData);
  }
}

// 請求加入房間
function joinOnlineRoom(roomId, character) {
  if (socket && isConnected) {
    socket.emit('join-room', { roomId, character });
  } else {
    alert('尚未連線到伺服器！');
    showScreen('onlineLobby');
  }
}

// 離開房間
function leaveOnlineRoom() {
  if (socket && isConnected) {
    // 斷開並重新連線，或者直接讓伺服器重置
    socket.disconnect();
    socket = null;
    isConnected = false;
    connectSocket();
  }
}

// 斷開連接
function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
    isConnected = false;
  }
}

// 發送再戰請求
function requestRematch() {
  if (socket && isConnected) {
    // 檢查對手是否已經請求
    const statusText = document.getElementById('rematch-status-text').innerText;
    if (statusText.includes('對手已發起再戰請求')) {
      // 如果對手已經請求了，我們按下去代表接受
      socket.emit('rematch-accept');
    } else {
      // 否則，我們發送請求
      socket.emit('rematch-request');
    }
  }
}
