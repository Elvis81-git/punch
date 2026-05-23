// 遊戲核心變數
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let animationFrameId = null;
let gameActive = false;
let gameTimerInterval = null;
let timeLeft = 99;
let currentRound = 1;

// 物理參數
const GRAVITY = 0.85;
const FLOOR_Y = 460;
const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 576;

// 震屏效果變數
let shakeIntensity = 0;
let shakeDecay = 0.9;

// 粒子特效池
let particles = [];

// 玩家與對手實體
let player1 = null;
let player2 = null;
let localMode = 'ai'; // 'ai', 'local', 'online'
let localSide = 'left'; // 'left' or 'right' (僅線上模式有用)

// 鍵盤按鍵狀態
const keys = {
  // P1 (WASD + JKL)
  a: false, d: false, w: false, s: false, j: false, k: false, l: false,
  // P2 (方向鍵 + 123)
  ArrowLeft: false, ArrowRight: false, ArrowUp: false, ArrowDown: false,
  num1: false, num2: false, num3: false
};

// 粒子類別
class Particle {
  constructor(x, y, color) {
    this.x = x;
    this.y = y;
    this.size = Math.random() * 4 + 2;
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 6 + 3;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed - 2; // 微幅向上
    this.color = color;
    this.alpha = 1.0;
    this.decay = Math.random() * 0.03 + 0.015;
    this.gravity = 0.15;
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vy += this.gravity;
    this.alpha -= this.decay;
  }

  draw(context) {
    context.save();
    context.globalAlpha = Math.max(0, this.alpha);
    context.shadowBlur = 10;
    context.shadowColor = this.color;
    context.fillStyle = this.color;
    context.beginPath();
    context.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
}

// 建立受擊粒子
function createHitParticles(x, y, color) {
  for (let i = 0; i < 20; i++) {
    particles.push(new Particle(x, y, color));
  }
  shakeIntensity = 10; // 觸發震屏
}

// 角色類別
class Player {
  constructor({ x, y, width, height, color, side, characterType, name }) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.baseWidth = width;
    this.baseHeight = height;
    this.width = width;
    this.height = height;
    this.color = color;
    this.side = side; // 'left' or 'right'
    this.characterType = characterType;
    this.name = name;
    
    // 遊戲數值
    const stats = charStats[characterType];
    this.maxHp = stats.hp;
    this.hp = stats.hp;
    this.speed = stats.speed;
    this.jumpForce = stats.jumpForce;
    this.dmgMultiplier = stats.dmgMultiplier;
    this.energy = 0;

    // 狀態標記
    this.isGrounded = false;
    this.isDucking = false;
    this.facing = side === 'left' ? 'right' : 'left';
    
    // 動作狀態：'idle', 'walk', 'jump', 'duck', 'light_punch', 'heavy_punch', 'block', 'hit', 'ko'
    this.action = 'idle'; 
    this.actionTimer = 0;
    this.lockControls = false;
    this.invulnerable = false; // 無敵狀態 (受擊後短暫)
    this.invulnerableTimer = 0;

    // 殘影特效 (僅 Swift 或 重攻擊衝刺時使用)
    this.ghosts = [];

    // 拳套位置 (相對於身體)
    this.leftGlove = { x: 0, y: 0, targetX: 0, targetY: 0 };
    this.rightGlove = { x: 0, y: 0, targetX: 0, targetY: 0 };
    
    // 判定框
    this.attackBox = {
      x: 0, y: 0, width: 0, height: 0, active: false
    };

    // 攻擊冷卻與屬性
    this.lightPunchCooldown = 0;
    this.heavyPunchCooldown = 0;
  }

  // 取得角色當前的碰撞邊界
  getBounds() {
    return {
      left: this.x - this.width / 2,
      right: this.x + this.width / 2,
      top: this.y - this.height,
      bottom: this.y
    };
  }

  // 執行跳躍
  jump() {
    if (this.isGrounded && !this.lockControls && this.action !== 'block') {
      this.vy = -this.jumpForce;
      this.isGrounded = false;
      this.action = 'jump';
    }
  }

  // 執行下蹲
  duck(isPressed) {
    if (this.lockControls || this.action === 'jump') return;
    
    if (isPressed) {
      this.isDucking = true;
      this.height = this.baseHeight * 0.55; // 高度減半
      if (this.action !== 'block') this.action = 'duck';
    } else {
      this.isDucking = false;
      this.height = this.baseHeight;
      if (this.action === 'duck') this.action = 'idle';
    }
  }

  // 輕拳攻擊
  lightPunch() {
    if (this.lockControls || this.lightPunchCooldown > 0 || this.action === 'block') return;

    this.action = 'light_punch';
    this.actionTimer = 12; // 持續 12 幀
    this.lockControls = true;
    this.lightPunchCooldown = 20; // 冷卻 20 幀

    // 出拳手套動畫
    const dir = this.facing === 'right' ? 1 : -1;
    this.rightGlove.targetX = dir * 80;
    this.rightGlove.targetY = -this.height * 0.7;

    // 能量微幅增加
    this.energy = Math.min(100, this.energy + 5);

    // 觸發攻擊判定 (第 3 幀生效)
    setTimeout(() => {
      if (this.action === 'light_punch' && gameActive) {
        this.triggerAttackBox(60, this.height * 0.3, this.facing === 'right' ? 30 : -90, -this.height * 0.75, 5 * this.dmgMultiplier, 6, 8);
      }
    }, 50); 
  }

  // 重拳攻擊
  heavyPunch() {
    if (this.lockControls || this.heavyPunchCooldown > 0 || this.action === 'block') return;

    this.action = 'heavy_punch';
    this.actionTimer = 28; // 持續 28 幀
    this.lockControls = true;
    this.heavyPunchCooldown = 45; // 冷卻 45 幀

    // 重拳會向前衝刺一段距離
    const dir = this.facing === 'right' ? 1 : -1;
    this.vx = dir * (this.speed * 1.5);
    
    // 出拳手套動畫
    this.rightGlove.targetX = dir * 110;
    this.rightGlove.targetY = -this.height * 0.65;
    this.leftGlove.targetX = dir * 50;
    this.leftGlove.targetY = -this.height * 0.55;

    this.energy = Math.min(100, this.energy + 10);

    // 觸發攻擊判定 (第 10 幀生效)
    setTimeout(() => {
      if (this.action === 'heavy_punch' && gameActive) {
        this.triggerAttackBox(90, this.height * 0.4, this.facing === 'right' ? 30 : -120, -this.height * 0.7, 14 * this.dmgMultiplier, 18, 18);
      }
    }, 160);
  }

  // 設定防守狀態
  block(isPressed) {
    if (this.lockControls) return;
    
    if (isPressed) {
      this.action = 'block';
    } else if (this.action === 'block') {
      this.action = this.isDucking ? 'duck' : 'idle';
    }
  }

  // 啟用攻擊判定框
  triggerAttackBox(w, h, offsetX, offsetY, damage, knockback, hitStun) {
    this.attackBox.width = w;
    this.attackBox.height = h;
    this.attackBox.x = this.x + offsetX;
    this.attackBox.y = this.y + offsetY;
    this.attackBox.active = true;
    this.attackBox.damage = damage;
    this.attackBox.knockback = this.facing === 'right' ? knockback : -knockback;
    this.attackBox.hitStun = hitStun;

    // 在本地對戰或 AI 模式中判定命中
    if (localMode !== 'online') {
      const opponent = this.side === 'left' ? player2 : player1;
      this.checkHitCollision(opponent);
    } else {
      // 在線上模式，只有控制本地端的人才進行命中判定 (Favor the Attacker)
      if (this.side === clientSide) {
        const opponent = this.side === 'left' ? player2 : player1;
        this.checkHitCollision(opponent);
      }
    }

    // 1 幀後關閉判定
    setTimeout(() => {
      this.attackBox.active = false;
    }, 50);
  }

  // 判定是否命中對手
  checkHitCollision(target) {
    if (!this.attackBox.active || target.hp <= 0 || target.invulnerable) return;

    // 取得攻擊判定框的矩形
    const ab = this.attackBox;
    const abLeft = ab.x;
    const abRight = ab.x + ab.width;
    const abTop = ab.y;
    const abBottom = ab.y + ab.height;

    // 取得對手碰撞箱
    const tb = target.getBounds();

    // 矩形重疊判定
    if (abRight > tb.left && abLeft < tb.right && abBottom > tb.top && abTop < tb.bottom) {
      // 命中！
      this.attackBox.active = false; // 避免重複判定
      
      const dmg = ab.damage;
      const kb = ab.knockback;
      const hs = ab.hitStun;

      if (localMode === 'online') {
        // 線上模式，將命中事件傳給伺服器，讓伺服器告知對手受擊
        sendHitData({
          damage: dmg,
          knockbackX: kb,
          hitStunTicks: hs,
          hitX: target.x,
          hitY: target.y - target.height / 2
        });
      } else {
        // 本地模式，直接讓對手受擊
        target.takeDamage(dmg, kb, hs);
      }
    }
  }

  // 受到傷害
  takeDamage(damage, knockbackX, hitStunTicks) {
    if (this.hp <= 0 || this.invulnerable) return;

    // 判斷是否處於防守狀態且受擊方向正確
    const isBlocking = this.action === 'block';

    if (isBlocking) {
      // 防禦成功：傷害大減 90%，且無硬直與擊退 (只有極小滑行)
      this.hp = Math.max(0, this.hp - damage * 0.1);
      this.vx = knockbackX * 0.15;
      
      // 粒子特效 (藍色防禦盾粒子)
      createHitParticles(this.x + (this.facing === 'right' ? -20 : 20), this.y - this.height/2, '#00ffcc');
      
      // 防守方累積少量能量
      this.energy = Math.min(100, this.energy + 8);
    } else {
      // 受擊成功
      this.hp = Math.max(0, this.hp - damage);
      this.vx = knockbackX;
      this.vy = -4.5; // 輕微挑空
      this.isGrounded = false; // 離開地面
      this.action = 'hit';
      this.actionTimer = hitStunTicks;
      this.lockControls = true;

      // 進入短暫無敵，避免連續受擊
      this.invulnerable = true;
      this.invulnerableTimer = 25;

      // 噴射角色專屬顏色的粒子
      let particleColor = '#ff0055'; // Ryder 紅色
      if (this.characterType === 'swift') particleColor = '#00f0ff';
      if (this.characterType === 'titan') particleColor = '#ffbd00';
      
      createHitParticles(this.x, this.y - this.height / 2, particleColor);
    }

    // 更新 HUD
    updateHUD(player1.hp, player2.hp, player1.energy, player2.energy);

    // 檢查是否 KO
    if (this.hp <= 0) {
      this.ko();
    }
  }

  // KO 判定
  ko() {
    this.action = 'ko';
    this.hp = 0;
    this.lockControls = true;
    this.vy = -7.5; // 飛起倒地
    this.isGrounded = false; // 離開地面
    this.vx = this.facing === 'right' ? -4 : 4;
    
    // 遊戲結束判定
    endGame();
  }

  // 實體狀態更新
  update() {
    // 殘影特效處理 (Swift 移動或重拳時)
    if (this.characterType === 'swift' || this.action === 'heavy_punch') {
      this.ghosts.push({ x: this.x, y: this.y, height: this.height, width: this.width, facing: this.facing, alpha: 0.4 });
      if (this.ghosts.length > 5) this.ghosts.shift();
    } else {
      this.ghosts = [];
    }

    // 減少無敵計時
    if (this.invulnerableTimer > 0) {
      this.invulnerableTimer--;
      if (this.invulnerableTimer === 0) this.invulnerable = false;
    }

    // 減少冷卻
    if (this.lightPunchCooldown > 0) this.lightPunchCooldown--;
    if (this.heavyPunchCooldown > 0) this.heavyPunchCooldown--;

    // 動作定時解鎖
    if (this.actionTimer > 0) {
      this.actionTimer--;
      if (this.actionTimer === 0) {
        this.lockControls = false;
        if (this.action === 'light_punch' || this.action === 'heavy_punch' || this.action === 'hit') {
          this.action = this.isDucking ? 'duck' : 'idle';
        }
      }
    }

    // 應用速度與物理
    this.x += this.vx;
    this.y += this.vy;

    // 空中重力
    if (!this.isGrounded) {
      this.vy += GRAVITY;
      if (this.y >= FLOOR_Y) {
        this.y = FLOOR_Y;
        this.vy = 0;
        this.isGrounded = true;
        if (this.action === 'jump') this.action = 'idle';
      }
    }

    // 阻力與摩擦力 (在地面的水平速度衰減)
    if (this.isGrounded) {
      this.vx *= 0.8;
    } else {
      this.vx *= 0.95; // 空中阻力較小
    }

    // 邊界限制 (不超出 Canvas)
    const padding = this.width / 2;
    if (this.x < padding) this.x = padding;
    if (this.x > CANVAS_WIDTH - padding) this.x = CANVAS_WIDTH - padding;

    // 手套動畫回彈 (插值平滑)
    const targetGloveX = this.action === 'light_punch' || this.action === 'heavy_punch' 
      ? this.rightGlove.targetX 
      : (this.facing === 'right' ? 20 : -20);
    const targetGloveY = this.action === 'light_punch' || this.action === 'heavy_punch' 
      ? this.rightGlove.targetY 
      : -this.height * 0.6;

    this.rightGlove.x += (targetGloveX - this.rightGlove.x) * 0.25;
    this.rightGlove.y += (targetGloveY - this.rightGlove.y) * 0.25;

    const targetLeftGloveX = this.action === 'heavy_punch'
      ? this.leftGlove.targetX
      : (this.facing === 'right' ? -15 : 15);
    const targetLeftGloveY = -this.height * 0.65;

    this.leftGlove.x += (targetLeftGloveX - this.leftGlove.x) * 0.25;
    this.leftGlove.y += (targetLeftGloveY - this.leftGlove.y) * 0.25;
  }

  // 繪製格鬥家剪影與霓虹光效
  draw(context) {
    // 1. 繪製殘影
    this.ghosts.forEach((ghost, idx) => {
      ghost.alpha -= 0.08;
      if (ghost.alpha > 0) {
        context.save();
        context.globalAlpha = ghost.alpha;
        context.fillStyle = this.color;
        context.shadowBlur = 10;
        context.shadowColor = this.color;
        
        context.beginPath();
        // 繪製殘影身體
        context.roundRect(
          ghost.x - ghost.width / 2, 
          ghost.y - ghost.height, 
          ghost.width, 
          ghost.height, 
          8
        );
        context.fill();
        context.restore();
      }
    });

    context.save();

    // 閃爍效果 (受傷無敵狀態)
    if (this.invulnerable && Math.floor(Date.now() / 50) % 2 === 0) {
      context.globalAlpha = 0.2;
    }

    // 霓虹發光配置
    context.shadowBlur = 18;
    context.shadowColor = this.color;

    // 2. 繪製身體
    context.fillStyle = '#111116'; // 深色身體背景
    context.strokeStyle = this.color;
    context.lineWidth = 3.5;
    context.beginPath();
    
    // 繪製圓角矩形身體
    const bodyX = this.x - this.width / 2;
    const bodyY = this.y - this.height;
    context.roundRect(bodyX, bodyY, this.width, this.height, 10);
    context.fill();
    context.stroke();

    // 3. 繪製義體發光核心
    const coreX = this.x;
    const coreY = this.y - this.height * 0.6;
    context.save();
    context.shadowBlur = 8;
    context.shadowColor = this.color;
    context.fillStyle = '#fff';
    context.beginPath();
    context.arc(coreX, coreY, 6, 0, Math.PI * 2);
    context.fill();
    
    // 核心外環
    context.strokeStyle = this.color;
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(coreX, coreY, 12, 0, Math.PI * 2);
    context.stroke();
    context.restore();

    // 4. 繪製眼睛 (霓虹發光條)
    const eyeDir = this.facing === 'right' ? 1 : -1;
    const eyeY = this.y - this.height * 0.85;
    const eyeX = this.x + (this.width * 0.15) * eyeDir;
    
    context.strokeStyle = '#ffffff';
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(eyeX - 5 * eyeDir, eyeY);
    context.lineTo(eyeX + 12 * eyeDir, eyeY);
    context.stroke();

    // 5. 繪製防守光盾
    if (this.action === 'block') {
      context.save();
      context.strokeStyle = '#00ffcc';
      context.shadowColor = '#00ffcc';
      context.shadowBlur = 20;
      context.lineWidth = 4;
      context.beginPath();
      
      const shieldAngleStart = this.facing === 'right' ? -Math.PI/2 : Math.PI/2;
      const shieldAngleEnd = this.facing === 'right' ? Math.PI/2 : Math.PI*1.5;
      
      context.arc(
        this.x + (this.width*0.4) * eyeDir, 
        this.y - this.height/2, 
        this.height * 0.6, 
        shieldAngleStart, 
        shieldAngleEnd
      );
      context.stroke();
      context.restore();
    }

    // 6. 繪製懸浮拳套 (Gloves)
    context.save();
    context.fillStyle = this.color;
    context.shadowColor = this.color;
    context.shadowBlur = 15;
    
    // 繪製左手套
    context.beginPath();
    context.arc(this.x + this.leftGlove.x, this.y + this.leftGlove.y, 11, 0, Math.PI*2);
    context.fill();

    // 繪製右手套
    context.fillStyle = '#ffffff'; // 右手套(出拳手)用亮色突出
    context.beginPath();
    context.arc(this.x + this.rightGlove.x, this.y + this.rightGlove.y, 13, 0, Math.PI*2);
    context.fill();
    context.restore();

    context.restore();
  }
}

// 建立背景與舞台
function drawStage() {
  // 1. 繪製賽博天空漸層
  const skyGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
  skyGrad.addColorStop(0, '#04020a');
  skyGrad.addColorStop(0.7, '#110b24');
  skyGrad.addColorStop(1, '#080512');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // 2. 繪製背景發光大樓 (霓虹剪影)
  ctx.save();
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = '#3a216e';
  
  // 大樓 1
  ctx.fillRect(150, 150, 100, 310);
  ctx.strokeStyle = '#00f0ff';
  ctx.lineWidth = 1;
  ctx.strokeRect(150, 150, 100, 310);

  // 大樓 2
  ctx.fillRect(320, 80, 140, 380);
  ctx.strokeRect(320, 80, 140, 380);

  // 大樓 3
  ctx.fillRect(600, 180, 120, 280);
  ctx.strokeRect(600, 180, 120, 280);

  // 大樓 4
  ctx.fillRect(800, 100, 110, 360);
  ctx.strokeRect(800, 100, 110, 360);
  ctx.restore();

  // 3. 繪製 3D 霓虹透視地板 (Perspective Grid)
  ctx.save();
  // 地板填滿色
  const floorGrad = ctx.createLinearGradient(0, FLOOR_Y, 0, CANVAS_HEIGHT);
  floorGrad.addColorStop(0, '#100c24');
  floorGrad.addColorStop(1, '#030206');
  ctx.fillStyle = floorGrad;
  ctx.fillRect(0, FLOOR_Y, CANVAS_WIDTH, CANVAS_HEIGHT - FLOOR_Y);

  // 地板頂部發光霓虹線 (擂台邊界線)
  ctx.strokeStyle = '#ff0055';
  ctx.shadowColor = '#ff0055';
  ctx.shadowBlur = 15;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, FLOOR_Y);
  ctx.lineTo(CANVAS_WIDTH, FLOOR_Y);
  ctx.stroke();

  // 繪製透視網格線
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.2)';
  ctx.lineWidth = 1.5;
  ctx.shadowBlur = 0;
  const numGridLines = 14;
  for (let i = 0; i <= numGridLines; i++) {
    const xTop = (CANVAS_WIDTH / numGridLines) * i;
    // 透視發散效果：下方 x 座標比上方更往兩側展開
    const xBottom = CANVAS_WIDTH/2 + (xTop - CANVAS_WIDTH/2) * 1.6;
    ctx.beginPath();
    ctx.moveTo(xTop, FLOOR_Y);
    ctx.lineTo(xBottom, CANVAS_HEIGHT);
    ctx.stroke();
  }

  // 繪製水平網格線 (間距遞增，符合透視)
  let y = FLOOR_Y;
  let gap = 6;
  while (y < CANVAS_HEIGHT) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(CANVAS_WIDTH, y);
    ctx.stroke();
    gap *= 1.35; // 越往下間距越寬
    y += gap;
  }
  ctx.restore();

  // 4. 繪製兩側發光的霓虹招牌/燈柱
  ctx.save();
  ctx.shadowBlur = 20;
  
  // 左燈柱
  ctx.fillStyle = '#111';
  ctx.fillRect(30, 100, 15, 360);
  ctx.strokeStyle = '#ff0055';
  ctx.shadowColor = '#ff0055';
  ctx.lineWidth = 3;
  ctx.strokeRect(30, 100, 15, 360);

  // 右燈柱
  ctx.fillRect(CANVAS_WIDTH - 45, 100, 15, 360);
  ctx.strokeStyle = '#00f0ff';
  ctx.shadowColor = '#00f0ff';
  ctx.strokeRect(CANVAS_WIDTH - 45, 100, 15, 360);
  
  ctx.restore();
}

// 啟動遊戲
function startGame(p1Type, p2Type, mode, side) {
  localMode = mode;
  localSide = side;
  gameActive = true;
  timeLeft = 99;
  currentRound = 1;
  document.getElementById('game-timer').innerText = timeLeft;
  document.getElementById('round-text').innerText = `ROUND ${currentRound}`;
  
  // 建立 Player 1 (左邊)
  player1 = new Player({
    x: 200,
    y: FLOOR_Y,
    width: charStats[p1Type].width,
    height: charStats[p1Type].height,
    color: '#ff0055', // 霓虹紅
    side: 'left',
    characterType: p1Type,
    name: 'Player 1'
  });

  // 建立 Player 2 (右邊)
  player2 = new Player({
    x: 824,
    y: FLOOR_Y,
    width: charStats[p2Type].width,
    height: charStats[p2Type].height,
    color: '#00f0ff', // 霓虹藍
    side: 'right',
    characterType: p2Type,
    name: 'Player 2'
  });

  // 綁定鍵盤監聽事件
  window.removeEventListener('keydown', handleKeyDown);
  window.removeEventListener('keyup', handleKeyUp);
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);

  // 清除舊的計時器與粒子
  clearInterval(gameTimerInterval);
  particles = [];
  
  // 啟動 99 秒倒數
  gameTimerInterval = setInterval(() => {
    if (gameActive && timeLeft > 0) {
      timeLeft--;
      document.getElementById('game-timer').innerText = timeLeft;
      if (timeLeft === 0) {
        determineTimeoutWinner();
      }
    }
  }, 1000);

  // 顯示操作提示，並在 5 秒後自動隱藏
  const helpEl = document.getElementById('controls-help');
  if (helpEl) {
    helpEl.classList.remove('hidden');
    if (window.controlsHelpTimeout) clearTimeout(window.controlsHelpTimeout);
    window.controlsHelpTimeout = setTimeout(() => {
      helpEl.classList.add('hidden');
    }, 5000);
  }

  // 啟動繪製與物理循環
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  animationFrameId = requestAnimationFrame(gameLoop);
}

// 結束遊戲判定
function endGame() {
  if (!gameActive) return;
  gameActive = false;
  clearInterval(gameTimerInterval);

  let winnerText = "";
  if (player1.hp <= 0 && player2.hp <= 0) {
    winnerText = "DRAW GAME - 雙亡！";
  } else if (player1.hp <= 0) {
    winnerText = localMode === 'online' && clientSide === 'left' ? "YOU LOSE - 挑戰失敗！" : "PLAYER 2 WINS!";
  } else if (player2.hp <= 0) {
    winnerText = localMode === 'online' && clientSide === 'right' ? "YOU LOSE - 挑戰失敗！" : "PLAYER 1 WINS!";
  }

  setTimeout(() => {
    showGameOverScreen(winnerText);
  }, 1500); // 延遲 1.5 秒讓玩家倒地動畫播完才顯示畫面
}

// 時間結束，血多者勝
function determineTimeoutWinner() {
  gameActive = false;
  clearInterval(gameTimerInterval);

  let winnerText = "";
  if (player1.hp === player2.hp) {
    winnerText = "DRAW GAME - 平手！";
  } else if (player1.hp > player2.hp) {
    winnerText = localMode === 'online' && clientSide === 'right' ? "YOU LOSE - 時間結束！" : "PLAYER 1 WINS!";
  } else {
    winnerText = localMode === 'online' && clientSide === 'left' ? "YOU LOSE - 時間結束！" : "PLAYER 2 WINS!";
  }

  showGameOverScreen(winnerText);
}

// 本地重置遊戲
function resetLocalGame() {
  startGame(player1.characterType, player2.characterType, localMode, localSide);
  showScreen('gameScreen');
}

// 線上重置遊戲
function resetOnlineGame(selfData, opponentData) {
  startGame(player1.characterType, player2.characterType, 'online', clientSide);
  showScreen('gameScreen');
}

// 清除遊戲
function cleanupGame() {
  gameActive = false;
  clearInterval(gameTimerInterval);
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  window.removeEventListener('keydown', handleKeyDown);
  window.removeEventListener('keyup', handleKeyUp);
  particles = [];

  // 恢復控制提示顯示
  const helpEl = document.getElementById('controls-help');
  if (helpEl) {
    helpEl.classList.remove('hidden');
  }
  if (window.controlsHelpTimeout) clearTimeout(window.controlsHelpTimeout);
}

// 處理鍵盤按下
function handleKeyDown(e) {
  if (!gameActive) return;

  // 線上模式限制操控：只能控自己那側的角色
  if (localMode === 'online') {
    if (clientSide === 'left') {
      handleP1Input(e.key, true);
    } else {
      handleP2Input(e.key, true);
    }
  } else if (localMode === 'local') {
    // 本地雙人：兩個都控
    handleP1Input(e.key, true);
    handleP2Input(e.key, true);
  } else {
    // AI 模式：只控 P1
    handleP1Input(e.key, true);
  }
}

// 處理鍵盤放開
function handleKeyUp(e) {
  if (localMode === 'online') {
    if (clientSide === 'left') {
      handleP1Input(e.key, false);
    } else {
      handleP2Input(e.key, false);
    }
  } else if (localMode === 'local') {
    handleP1Input(e.key, false);
    handleP2Input(e.key, false);
  } else {
    handleP1Input(e.key, false);
  }
}

// P1 操控輸入對應
function handleP1Input(key, isPressed) {
  const k = key.toLowerCase();
  if (k === 'a') keys.a = isPressed;
  if (k === 'd') keys.d = isPressed;
  
  if (isPressed) {
    if (k === 'w') player1.jump();
    if (k === 's') player1.duck(true);
    if (k === 'j') player1.lightPunch();
    if (k === 'k') player1.heavyPunch();
    if (k === 'l') player1.block(true);
  } else {
    if (k === 's') player1.duck(false);
    if (k === 'l') player1.block(false);
  }
}

// P2 操控輸入對應
function handleP2Input(key, isPressed) {
  if (key === 'ArrowLeft') keys.ArrowLeft = isPressed;
  if (key === 'ArrowRight') keys.ArrowRight = isPressed;
  
  if (isPressed) {
    if (key === 'ArrowUp') player2.jump();
    if (key === 'ArrowDown') player2.duck(true);
    if (key === '1') player2.lightPunch(); // 支援小鍵盤或主鍵盤數字
    if (key === '2') player2.heavyPunch();
    if (key === '3') player2.block(true);
  } else {
    if (key === 'ArrowDown') player2.duck(false);
    if (key === '3') player2.block(false);
  }
}

// 簡單 AI 邏輯
function updateAI() {
  if (localMode !== 'ai' || !gameActive || player2.hp <= 0 || player2.lockControls) return;

  const dx = player1.x - player2.x;
  const dist = Math.abs(dx);

  // 朝著玩家方向
  player2.facing = dx > 0 ? 'right' : 'left';

  // 隨機行為機率計數
  const rnd = Math.random();

  if (dist > 150) {
    // 距離太遠，靠近玩家
    player2.vx = dx > 0 ? player2.speed * 0.6 : -player2.speed * 0.6;
    player2.action = 'walk';
    
    // 機率跳躍接近
    if (rnd < 0.01 && player2.isGrounded) {
      player2.jump();
    }
  } else if (dist <= 150 && dist > 70) {
    // 距離適中，有時候往前有時候退後，偶爾防守
    if (rnd < 0.3) {
      player2.vx = dx > 0 ? player2.speed * 0.4 : -player2.speed * 0.4;
      player2.action = 'walk';
    } else if (rnd < 0.4) {
      // 後退
      player2.vx = dx > 0 ? -player2.speed * 0.4 : player2.speed * 0.4;
      player2.action = 'walk';
    } else if (rnd < 0.45) {
      // 蹲下
      player2.duck(true);
      setTimeout(() => player2.duck(false), 500);
    }
  } else {
    // 近身格鬥範圍
    player2.vx = 0;
    
    if (rnd < 0.07) {
      // 輕拳
      player2.lightPunch();
    } else if (rnd < 0.11) {
      // 重拳
      player2.heavyPunch();
    } else if (rnd < 0.16) {
      // 防禦
      player2.block(true);
      setTimeout(() => player2.block(false), 400);
    } else if (rnd < 0.2) {
      // 下蹲防禦
      player2.duck(true);
      player2.block(true);
      setTimeout(() => {
        player2.duck(false);
        player2.block(false);
      }, 500);
    }
  }
}

// 玩家物理位移與控制套用
function applyPlayerControls() {
  // P1 移動
  if (!player1.lockControls && player1.action !== 'block') {
    if (keys.a) {
      player1.vx = -player1.speed;
      player1.facing = 'left';
      player1.action = 'walk';
    } else if (keys.d) {
      player1.vx = player1.speed;
      player1.facing = 'right';
      player1.action = 'walk';
    } else {
      if (player1.isGrounded && player1.action === 'walk') player1.action = 'idle';
    }
  }

  // P2 移動 (本地雙人模式下生效)
  if (localMode === 'local' && !player2.lockControls && player2.action !== 'block') {
    if (keys.ArrowLeft) {
      player2.vx = -player2.speed;
      player2.facing = 'left';
      player2.action = 'walk';
    } else if (keys.ArrowRight) {
      player2.vx = player2.speed;
      player2.facing = 'right';
      player2.action = 'walk';
    } else {
      if (player2.isGrounded && player2.action === 'walk') player2.action = 'idle';
    }
  }
}

// --- 線上對戰同步功能 ---

// 接收對手更新
function receiveOpponentUpdate(data) {
  // 找出誰是對手
  const opp = clientSide === 'left' ? player2 : player1;
  if (!opp) return;

  // 使用平滑插值 (儲存目標位置)
  opp.targetX = data.x;
  opp.targetY = data.y;
  opp.vx = data.vx;
  opp.vy = data.vy;
  opp.facing = data.facing;
  opp.action = data.action;
  opp.hp = data.hp;
  
  // 同步高度狀態
  if (data.action === 'duck' && !opp.isDucking) {
    opp.isDucking = true;
    opp.height = opp.baseHeight * 0.55;
  } else if (data.action !== 'duck' && opp.isDucking) {
    opp.isDucking = false;
    opp.height = opp.baseHeight;
  }

  // 更新 HUD
  updateHUD(player1.hp, player2.hp, player1.energy, player2.energy);
}

// 接收受擊事件 (我們是受害者，攻擊方在他們的本地端算出了命中)
function receiveHitData(hitData) {
  const me = clientSide === 'left' ? player1 : player2;
  if (!me) return;

  // 本地執行扣血與受擊效果
  me.takeDamage(hitData.damage, hitData.knockbackX, hitData.hitStunTicks);
}

// 發送本地狀態給對手
let lastSentTime = 0;
function syncLocalPlayerOnline() {
  if (localMode !== 'online' || !gameActive) return;

  const now = Date.now();
  // 限制每秒發送約 45 次，節省頻寬
  if (now - lastSentTime > 22) {
    const me = clientSide === 'left' ? player1 : player2;
    if (me) {
      sendPlayerUpdate({
        x: me.x,
        y: me.y,
        vx: me.vx,
        vy: me.vy,
        facing: me.facing,
        action: me.action,
        hp: me.hp
      });
      lastSentTime = now;
    }
  }
}

// 對手位置平滑插值 (處理延遲抖動)
function interpolateOpponent() {
  if (localMode !== 'online') return;
  const opp = clientSide === 'left' ? player2 : player1;
  if (opp && opp.targetX !== undefined) {
    // 平滑朝向目標點移動
    opp.x += (opp.targetX - opp.x) * 0.35;
    opp.y += (opp.targetY - opp.y) * 0.35;
  }
}

// 遊戲主迴圈 (Game Loop)
function gameLoop() {
  if (!gameActive) return;

  // 1. 套用輸入控制與 AI
  applyPlayerControls();
  updateAI();

  // 2. 物理與狀態更新
  player1.update();
  player2.update();

  // 線上同步與插值
  syncLocalPlayerOnline();
  interpolateOpponent();

  // 3. 格鬥面朝方向調整 (非攻擊硬直期間，兩個角色應該始終面對面)
  if (localMode !== 'online') {
    if (!player1.lockControls && player1.action !== 'block') {
      player1.facing = player1.x < player2.x ? 'right' : 'left';
    }
    if (!player2.lockControls && player2.action !== 'block' && localMode !== 'ai') {
      player2.facing = player2.x < player1.x ? 'right' : 'left';
    }
  }

  // 更新粒子
  particles.forEach((p, idx) => {
    p.update();
    if (p.alpha <= 0) {
      particles.splice(idx, 1);
    }
  });

  // 4. Canvas 繪製準備 (套用震屏)
  ctx.save();
  if (shakeIntensity > 0) {
    const dx = (Math.random() - 0.5) * shakeIntensity;
    const dy = (Math.random() - 0.5) * shakeIntensity;
    ctx.translate(dx, dy);
    shakeIntensity *= shakeDecay;
    if (shakeIntensity < 0.2) shakeIntensity = 0;
  }

  // 清除畫布並繪製場景
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  drawStage();

  // 繪製格鬥家
  player1.draw(ctx);
  player2.draw(ctx);

  // 繪製粒子特效
  particles.forEach(p => p.draw(ctx));

  // 恢復 Canvas 變形
  ctx.restore();

  // 繼續下一幀
  animationFrameId = requestAnimationFrame(gameLoop);
}
