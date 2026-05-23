const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 託管靜態檔案
app.use(express.static(__dirname));

// 儲存房間狀態
// rooms結構: { [roomId]: { players: { [socketId]: { id, side, character, x, y, hp, action, facing } } } }
const rooms = {};

io.on('connection', (socket) => {
  console.log(`用戶已連線: ${socket.id}`);

  // 加入/創建房間
  socket.on('join-room', ({ roomId, character }) => {
    roomId = roomId.trim().toUpperCase();
    if (!roomId) {
      socket.emit('error-msg', '請輸入有效的房間代碼！');
      return;
    }

    // 檢查房間是否已存在
    if (!rooms[roomId]) {
      // 創建新房間，此玩家為 Player 1 (左邊)
      rooms[roomId] = {
        id: roomId,
        players: {
          [socket.id]: {
            id: socket.id,
            side: 'left',
            character: character,
            x: 200,
            y: 400,
            hp: 100,
            action: 'idle',
            facing: 'right'
          }
        }
      };
      socket.join(roomId);
      socket.roomId = roomId;
      socket.emit('room-joined', { roomId, side: 'left', isWaiting: true });
      console.log(`玩家 ${socket.id} 創建並加入了房間: ${roomId}`);
    } else {
      const room = rooms[roomId];
      const playerIds = Object.keys(room.players);

      if (playerIds.length >= 2) {
        socket.emit('error-msg', '該房間已滿！');
        return;
      }

      // 加入房間，此玩家為 Player 2 (右邊)
      room.players[socket.id] = {
        id: socket.id,
        side: 'right',
        character: character,
        x: 800,
        y: 400,
        hp: 100,
        action: 'idle',
        facing: 'left'
      };
      socket.join(roomId);
      socket.roomId = roomId;
      socket.emit('room-joined', { roomId, side: 'right', isWaiting: false });
      console.log(`玩家 ${socket.id} 加入了房間: ${roomId}`);

      // 取得兩個玩家的資料
      const player1Id = playerIds[0];
      const player1 = room.players[player1Id];
      const player2 = room.players[socket.id];

      // 通知雙方遊戲開始，並傳送對手資訊
      io.to(player1Id).emit('game-start', {
        opponent: player2,
        self: player1
      });
      io.to(socket.id).emit('game-start', {
        opponent: player1,
        self: player2
      });
      
      console.log(`房間 ${roomId} 遊戲開始！`);
    }
  });

  // 更新玩家狀態並轉發給對手
  socket.on('player-update', (data) => {
    const roomId = socket.roomId;
    if (roomId && rooms[roomId]) {
      const room = rooms[roomId];
      if (room.players[socket.id]) {
        // 更新伺服器端的玩家快照
        Object.assign(room.players[socket.id], data);
        
        // 轉發給房間內的其他玩家
        socket.to(roomId).emit('opponent-update', data);
      }
    }
  });

  // 玩家攻擊命中對手事件 (由攻擊方計算命中後發出，傳給受擊方)
  socket.on('hit-opponent', (hitData) => {
    const roomId = socket.roomId;
    if (roomId && rooms[roomId]) {
      // 轉發受擊資料給房間內的其他玩家
      socket.to(roomId).emit('get-hit', hitData);
    }
  });

  // 玩家重置遊戲 (當一局結束重新開始時)
  socket.on('rematch-request', () => {
    const roomId = socket.roomId;
    if (roomId && rooms[roomId]) {
      // 轉發 rematch 請求給對手
      socket.to(roomId).emit('rematch-requested');
    }
  });

  socket.on('rematch-accept', () => {
    const roomId = socket.roomId;
    if (roomId && rooms[roomId]) {
      const room = rooms[roomId];
      const playerIds = Object.keys(room.players);
      
      // 重置玩家血量與位置
      if (playerIds.length === 2) {
        const p1Id = playerIds[0];
        const p2Id = playerIds[1];
        
        room.players[p1Id].hp = 100;
        room.players[p1Id].x = 200;
        room.players[p1Id].y = 400;
        room.players[p1Id].action = 'idle';
        room.players[p1Id].facing = 'right';

        room.players[p2Id].hp = 100;
        room.players[p2Id].x = 800;
        room.players[p2Id].y = 400;
        room.players[p2Id].action = 'idle';
        room.players[p2Id].facing = 'left';

        io.to(p1Id).emit('game-reset', { self: room.players[p1Id], opponent: room.players[p2Id] });
        io.to(p2Id).emit('game-reset', { self: room.players[p2Id], opponent: room.players[p1Id] });
        console.log(`房間 ${roomId} 已重置遊戲！`);
      }
    }
  });

  // 斷開連線處理
  socket.on('disconnect', () => {
    console.log(`用戶已斷開連線: ${socket.id}`);
    const roomId = socket.roomId;
    if (roomId && rooms[roomId]) {
      const room = rooms[roomId];
      delete room.players[socket.id];
      
      // 通知房間內的其他玩家
      socket.to(roomId).emit('opponent-disconnected');
      console.log(`玩家 ${socket.id} 離開了房間 ${roomId}`);

      // 如果房間空了，則刪除房間
      if (Object.keys(room.players).length === 0) {
        delete rooms[roomId];
        console.log(`房間 ${roomId} 已被清除`);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`伺服器正運行在 port: ${PORT}`);
});
