/**
 * LINTest-M 通信协议模块
 * 基于 LINTest-M 通信协议 V1.0.0
 *
 * 帧格式 (16字节):
 * [CMD, CHANNEL, ID, DIR, CHECK_TYPE, LEN, DATA0..DATA7, LIN_CHECK, FRAME_CRC]
 *
 * BLE桥接帧格式:
 * [0x3A, 0x01, ...16字节LINTest-M帧..., 0x0D, 0x0A]
 */

// ─── 常量定义 ──────────────────────────────────────────────

/** 命令头 */
const CMD = {
  MODE_CONFIG:   0x11,  // 模式配置
  MASTER_SEND:   0x22,  // 主模式发送
  READ_SLAVE:    0x33,  // 读取从机数据
  MONITOR_RECV:  0x44,  // 监听模式接收
  SLAVE_SEND:    0x55,  // 从机模式发送
  SLAVE_ENABLE:  0x66   // 从机通道使能/禁止
}

/** 工作模式 */
const MODE = {
  MONITOR: 0,  // 监听模式
  MASTER:  1,  // 主模式
  SLAVE:   2,  // 从机模式
  SNIFFER: 3   // 嗅探模式
}

/** 传输方向 */
const DIR = {
  SEND: 0,  // 发送
  READ: 1   // 读取
}

/** 校验类型 */
const CHECK_TYPE = {
  NONE:     0,  // 无校验
  CLASSIC:  1,  // 经典校验 (LIN V1.x)
  ENHANCED: 2   // 增强校验 (LIN V2.x)
}

/** 波特率预设 */
const BAUD_RATE_PRESETS = {
  20000: { b1: 0x4E, b0: 0x20, label: '20000 bps' },
  19200: { b1: 0x4B, b0: 0x00, label: '19200 bps' },
  10400: { b1: 0x28, b0: 0xA0, label: '10400 bps' },
  9600:  { b1: 0x25, b0: 0x80, label: '9600 bps' },
  4800:  { b1: 0x12, b0: 0xC0, label: '4800 bps' }
}

/** 从机通道数 */
const SLAVE_CHANNELS = 16

/** BLE 桥接帧边界 */
const FRAME_START = [0x3A, 0x01]
const FRAME_END   = [0x0D, 0x0A]

/** LIN ID 范围 */
const LIN_ID_MIN = 0x00
const LIN_ID_MAX = 0x3F

// ─── 工具函数 ──────────────────────────────────────────────

/**
 * 解析HEX字符串为整数
 */
function parseHex(hex, min, max, errMsg) {
  const value = (hex || '00').trim()
  if (!/^[0-9a-fA-F]{1,2}$/.test(value)) {
    throw new Error(errMsg || 'HEX格式错误')
  }
  const n = parseInt(value, 16)
  if (min !== undefined && n < min) throw new Error(errMsg || '值超出范围')
  if (max !== undefined && n > max) throw new Error(errMsg || '值超出范围')
  return n
}

/**
 * 解析多字节HEX字符串为字节数组
 * @param {string} hex - HEX字符串 (如 "11 22 33")
 * @param {number} len - 期望长度
 * @param {boolean} pad - 是否填充到len (true=发送模式补0, false=读取模式)
 * @returns {number[]}
 */
function parseData(hex, len, pad) {
  const clean = (hex || '').replace(/\s+/g, '').trim()

  if (clean.length === 0) {
    return pad ? new Array(len).fill(0x00) : []
  }

  if (clean.length % 2 !== 0) {
    throw new Error('数据HEX长度必须为偶数')
  }

  const list = []
  for (let i = 0; i < clean.length; i += 2) {
    const item = clean.substring(i, i + 2)
    if (!/^[0-9a-fA-F]{2}$/.test(item)) {
      throw new Error('数据HEX格式错误: ' + item)
    }
    list.push(parseInt(item, 16))
  }

  if (!pad) {
    if (list.length > len) throw new Error('读取命令数据不可超过长度')
    return list
  }

  if (list.length > len) throw new Error('发送数据超过长度(' + len + '): ' + list.length)
  while (list.length < len) list.push(0x00)
  return list
}

/**
 * 字节数组求和折叠到单字节
 */
function foldChecksum(sum) {
  while (sum > 0xFF) {
    sum = (sum & 0xFF) + (sum >> 8)
  }
  return sum
}

/**
 * 计算帧CRC (前15字节求和取反加1)
 * @param {number[]} bytes - 前15字节
 * @returns {number} CRC值
 */
function calcFrameCRC(bytes) {
  let sum = 0
  for (const b of bytes) sum += b
  sum = foldChecksum(sum)
  return (~sum + 1) & 0xFF
}

// ─── LIN协议核心 ────────────────────────────────────────────

/**
 * 计算 Protected ID (PID)
 * P0 = ID0 ^ ID1 ^ ID2 ^ ID4
 * P1 = ¬(ID1 ^ ID3 ^ ID4 ^ ID5)
 * PID = ID | (P0 << 6) | (P1 << 7)
 */
function buildProtectedId(id) {
  const b0 = (id >> 0) & 0x01
  const b1 = (id >> 1) & 0x01
  const b2 = (id >> 2) & 0x01
  const b3 = (id >> 3) & 0x01
  const b4 = (id >> 4) & 0x01
  const b5 = (id >> 5) & 0x01

  const p0 = b0 ^ b1 ^ b2 ^ b4
  const p1 = (b1 ^ b3 ^ b4 ^ b5) ^ 0x01

  return (id | (p0 << 6) | (p1 << 7)) & 0xFF
}

/**
 * 增强校验 (LIN V2.x)
 * Checksum = ¬(PID + Data[0] + ... + Data[n-1])
 */
function buildLinEnhancedChecksum(linId, data) {
  const protectedId = buildProtectedId(linId)
  let sum = protectedId
  for (const b of data) sum += b
  sum = foldChecksum(sum)
  return (~sum) & 0xFF
}

/**
 * 经典校验 (LIN V1.x)
 * Checksum = ¬(Data[0] + ... + Data[n-1])
 */
function buildLinClassicChecksum(data) {
  let sum = 0
  for (const b of data) sum += b
  sum = foldChecksum(sum)
  return (~sum) & 0xFF
}

/**
 * 根据校验类型计算LIN校验和
 */
function buildLinChecksum(linId, data, checkType) {
  if (checkType === CHECK_TYPE.NONE) return 0x00
  if (checkType === CHECK_TYPE.CLASSIC) return buildLinClassicChecksum(data)
  return buildLinEnhancedChecksum(linId, data) // 默认增强
}

// ─── 帧构建 ────────────────────────────────────────────────

/**
 * 构建 LINTest-M 16字节标准帧
 * @param {Object} cfg
 * @param {number} cfg.cmd - 命令头
 * @param {number} cfg.channel - 通道 (0-15)
 * @param {number} cfg.linId - LIN ID (0x00-0x3F)
 * @param {number} cfg.dir - 方向 (0=发送, 1=接收)
 * @param {number} cfg.checkType - 校验类型
 * @param {number} cfg.dataLen - 数据长度 (1-8)
 * @param {number[]} cfg.data - 数据字节 [0-7]
 * @param {boolean} [cfg.padData] - 是否填充数据到dataLen
 * @returns {number[]} 16字节帧
 */
function buildFrame(cfg) {
  const cmd = cfg.cmd
  const channel = cfg.channel || 0
  const linId = cfg.linId
  const dir = cfg.dir || 0
  const checkType = cfg.checkType !== undefined ? cfg.checkType : CHECK_TYPE.ENHANCED
  const dataLen = cfg.dataLen || 1

  // 验证: LIN ID 范围仅对 LIN 数据帧有效
  // MODE_CONFIG(0x11) / SLAVE_ENABLE(0x66) 复用 linId/dir 字段传递配置参数
  const isLinDataCmd = (cmd === CMD.MASTER_SEND || cmd === CMD.READ_SLAVE ||
                        cmd === CMD.SLAVE_SEND || cmd === CMD.MONITOR_RECV)
  if (isLinDataCmd && (linId < LIN_ID_MIN || linId > LIN_ID_MAX)) {
    throw new Error('LIN ID 超出 0x00~0x3F 范围')
  }
  if (dataLen < 1 || dataLen > 8) {
    throw new Error('数据长度必须在 1~8 之间')
  }

  // 处理数据
  let data = cfg.data || []
  if (cfg.padData !== false) {
    // 默认补齐到 dataLen
    data = [...data]
    while (data.length < dataLen) data.push(0x00)
    if (data.length > dataLen) data = data.slice(0, dataLen)
  }

  // 补齐到8字节数据区
  const dataArea = [...data]
  while (dataArea.length < 8) dataArea.push(0x00)

  // LIN校验 (基于实际数据长度)
  const linCheck = buildLinChecksum(linId, data.slice(0, dataLen), checkType)

  // 构建帧 (前15字节)
  const frame = [
    cmd, channel, linId, dir, checkType, dataLen,
    ...dataArea,
    linCheck
  ]
  // frame 现在是 1+1+1+1+1+1+8+1 = 15 字节

  // 帧CRC (第16字节)
  const crc = calcFrameCRC(frame)
  frame.push(crc)

  return frame // 16字节
}

/**
 * 用 HEX 字符串参数构建帧 (高层接口)
 * @param {Object} cfg
 * @param {string} cfg.frameIdHex - ID (HEX字符串)
 * @param {string} cfg.dataHex - 数据 (HEX字符串)
 * @param {number|string} cfg.dataLength - 数据长度
 * @param {string} cfg.direction - 'send' | 'read'
 * @param {number} [cfg.mode] - 模式 (MASTER/SLAVE)
 * @param {number} [cfg.channel] - 通道
 * @param {number} [cfg.checkType] - 校验类型
 */
function buildPacket(cfg) {
  const dataLen = Number(cfg.dataLength)
  if (!Number.isInteger(dataLen) || dataLen < 1 || dataLen > 8) {
    throw new Error('数据长度必须在 1~8')
  }

  const linId = parseHex(cfg.frameIdHex, 0, 0x3F, 'LIN ID 超出 0x00~0x3F')
  const isSend = cfg.direction === 'send'
  const dir = isSend ? DIR.SEND : DIR.READ
  const checkType = cfg.checkType !== undefined ? cfg.checkType : CHECK_TYPE.ENHANCED
  const mode = cfg.mode || MODE.MASTER
  const channel = cfg.channel !== undefined ? cfg.channel : (isSend ? 0 : 1)

  // 确定命令头
  let cmd
  if (mode === MODE.MASTER) {
    cmd = isSend ? CMD.MASTER_SEND : CMD.READ_SLAVE
  } else if (mode === MODE.SLAVE) {
    cmd = CMD.SLAVE_SEND
  } else {
    cmd = isSend ? CMD.MASTER_SEND : CMD.READ_SLAVE
  }

  const data = parseData(cfg.dataHex, dataLen, isSend)

  return buildFrame({
    cmd,
    channel,
    linId,
    dir,
    checkType,
    dataLen,
    data,
    padData: isSend
  })
}

/**
 * 构建模式配置帧 (0x11)
 * @param {number} mode - MODE.MONITOR / MASTER / SLAVE / SNIFFER
 * @param {number} baudRate - 波特率 (如 19200)
 * @returns {number[]} 16字节帧
 */
function buildModeConfig(mode, baudRate) {
  const preset = BAUD_RATE_PRESETS[baudRate]
  if (!preset) {
    // 自定义波特率
    const b1 = (baudRate >> 8) & 0xFF
    const b0 = baudRate & 0xFF
    return buildFrame({
      cmd: CMD.MODE_CONFIG,
      channel: mode,
      linId: b1,
      dir: b0,
      checkType: 0,
      dataLen: 1,
      data: [0],
      padData: true
    })
  }

  return buildFrame({
    cmd: CMD.MODE_CONFIG,
    channel: mode,
    linId: preset.b1,
    dir: preset.b0,
    checkType: 0,
    dataLen: 1,
    data: [0],
    padData: true
  })
}

/**
 * 构建主模式发送帧 (0x22)
 */
function buildMasterSend(frameIdHex, dataHex, dataLength, checkType) {
  const linId = parseHex(frameIdHex, 0, 0x3F)
  const dataLen = Number(dataLength)
  const data = parseData(dataHex, dataLen, true)
  const ct = checkType !== undefined ? checkType : CHECK_TYPE.ENHANCED

  return buildFrame({
    cmd: CMD.MASTER_SEND,
    channel: 0,
    linId,
    dir: DIR.SEND,
    checkType: ct,
    dataLen,
    data
  })
}

/**
 * 构建读取从机数据帧 (0x33)
 */
function buildReadSlave(frameIdHex, dataLength, checkType) {
  const linId = parseHex(frameIdHex, 0, 0x3F)
  const dataLen = Number(dataLength)
  const ct = checkType !== undefined ? checkType : CHECK_TYPE.ENHANCED

  return buildFrame({
    cmd: CMD.READ_SLAVE,
    channel: 1,
    linId,
    dir: DIR.READ,
    checkType: ct,
    dataLen,
    data: [],
    padData: true
  })
}

/**
 * 构建从机模式发送帧 (0x55)
 * @param {number} channel - 从机通道 (0-15)
 * @param {string} frameIdHex - LIN ID
 * @param {string} dataHex - 数据
 * @param {number} dataLength - 长度
 * @param {number} checkType - 校验类型
 * @param {number} direction - 0=从机接收, 1=从机发送
 */
function buildSlaveSend(channel, frameIdHex, dataHex, dataLength, checkType, direction) {
  const linId = parseHex(frameIdHex, 0, 0x3F)
  const dataLen = Number(dataLength)
  const data = parseData(dataHex, dataLen, direction === 1)
  const ct = checkType !== undefined ? checkType : CHECK_TYPE.ENHANCED
  const dir = direction !== undefined ? direction : 1

  return buildFrame({
    cmd: CMD.SLAVE_SEND,
    channel: channel & 0x0F,
    linId,
    dir,
    checkType: ct,
    dataLen,
    data
  })
}

/**
 * 构建从机通道使能/禁止帧 (0x66)
 * @param {number} channel - 通道 (0-15)
 * @param {boolean} enable - true=使能, false=禁止
 */
function buildSlaveEnable(channel, enable) {
  return buildFrame({
    cmd: CMD.SLAVE_ENABLE,
    channel: channel & 0x0F,
    linId: 0,
    dir: enable ? 1 : 0,
    checkType: 0,
    dataLen: 1,
    data: [0],
    padData: true
  })
}

// ─── BLE桥接帧 ──────────────────────────────────────────────

/**
 * 将 LINTest-M 16字节帧包装为 BLE 发送帧
 * @param {number[]} frame - 16字节 LINTest-M 帧
 * @returns {Uint8Array} 可发送的完整帧
 */
function wrapForBLE(frame) {
  const full = [...FRAME_START, ...frame, ...FRAME_END]
  return new Uint8Array(full)
}

/**
 * 构建并包装帧 (一步完成)
 * @returns {Uint8Array}
 */
function buildAndWrap(cfg) {
  const frame = buildFrame(cfg)
  return wrapForBLE(frame)
}

// ─── 帧解析 ────────────────────────────────────────────────

/**
 * 解析 LINTest-M 16字节帧
 * @param {number[]|Uint8Array} bytes - 原始字节
 * @returns {Object} 解析结果
 */
function parseFrame(bytes) {
  const arr = Array.from(bytes || [])

  if (arr.length < 16) {
    return {
      rawHex: bytesToHex(arr),
      valid: false,
      reason: '帧长度不足 (需16字节, 实际' + arr.length + ')',
      fullFrame: false
    }
  }

  const cmd = arr[0]
  const channel = arr[1]
  const linId = arr[2]
  const dir = arr[3]
  const checkType = arr[4]
  const dataLen = arr[5]
  const dataBytes = arr.slice(6, 14)  // Data0..Data7 (8 bytes)
  const linCheck = arr[14]
  const frameCRC = arr[15]

  // 验证帧CRC
  const calcCRC = calcFrameCRC(arr.slice(0, 15))
  const crcValid = calcCRC === frameCRC

  // 解析命令类型
  const cmdName = getCmdName(cmd)
  const modeName = getModeName()
  const checkTypeName = getCheckTypeName(checkType)

  return {
    rawHex: bytesToHex(arr),
    valid: true,
    crcValid,
    fullFrame: true,

    // 帧字段
    cmd,
    cmdName,
    channel,
    linId,
    linIdHex: linId.toString(16).padStart(2, '0').toUpperCase(),
    pid: buildProtectedId(linId),
    pidHex: buildProtectedId(linId).toString(16).padStart(2, '0').toUpperCase(),
    dir,
    dirName: dir === 0 ? '发送' : '接收',
    checkType,
    checkTypeName,
    dataLen,
    dataHex: bytesToHex(dataBytes.slice(0, dataLen)),
    dataAreaHex: bytesToHex(dataBytes),
    linCheck,
    linCheckHex: linCheck.toString(16).padStart(2, '0').toUpperCase(),
    frameCRC,
    frameCRCHex: frameCRC.toString(16).padStart(2, '0').toUpperCase(),

    // 校验验证
    expectedCRC: calcCRC,
    expectedCRCHex: calcCRC.toString(16).padStart(2, '0').toUpperCase()
  }
}

/**
 * 从接收字节中提取 LINTest-M 帧 (处理 BLE 桥接帧封装)
 * @param {Uint8Array|number[]} bytes - 接收到的原始数据
 * @returns {Object} 解析结果
 */
function parseReceivedFrame(bytes) {
  const arr = Array.from(bytes || [])
  const rawHex = bytesToHex(arr)

  if (arr.length < 16) {
    // 可能是被 BLE 桥接帧包装的
    // 尝试查找 0x3A 0x01 ... 0x0D 0x0A 并提取中间的16字节
    const startIdx = arr.indexOf(0x3A)
    if (startIdx >= 0 && startIdx + 19 <= arr.length) {
      const inner = arr.slice(startIdx + 2, startIdx + 18)
      if (inner.length === 16) {
        const result = parseFrame(inner)
        result.rawHex = rawHex
        return result
      }
    }

    return {
      rawHex,
      valid: false,
      reason: '数据不足',
      fullFrame: false
    }
  }

  // 直接尝试作为16字节LINTest-M帧
  return parseFrame(arr)
}

// ─── 预览 ──────────────────────────────────────────────────

/**
 * 预览帧详情 (发送前预览)
 * @param {Object} cfg - 同 buildPacket 参数
 * @returns {Object} 预览信息
 */
function buildPreview(cfg) {
  const dataLen = Number(cfg.dataLength)
  if (!Number.isInteger(dataLen) || dataLen < 1 || dataLen > 8) {
    throw new Error('数据长度必须在 1~8')
  }

  const linId = parseHex(cfg.frameIdHex, 0, 0x3F)
  const isSend = cfg.direction === 'send'
  const checkType = cfg.checkType !== undefined ? cfg.checkType : CHECK_TYPE.ENHANCED
  const data = parseData(cfg.dataHex, dataLen, isSend)
  const pid = buildProtectedId(linId)

  const dataArea = [...data]
  while (dataArea.length < 8) dataArea.push(0x00)

  const enhancedCS = buildLinEnhancedChecksum(linId, data.slice(0, dataLen))
  const classicCS = buildLinClassicChecksum(data.slice(0, dataLen))
  const linCS = checkType === CHECK_TYPE.CLASSIC ? classicCS : enhancedCS

  // 计算帧CRC
  const mode = cfg.mode || MODE.MASTER
  const dir = isSend ? DIR.SEND : DIR.READ
  const channel = cfg.channel !== undefined ? cfg.channel : (isSend ? 0 : 1)
  const cmd = mode === MODE.SLAVE ? CMD.SLAVE_SEND :
              (isSend ? CMD.MASTER_SEND : CMD.READ_SLAVE)

  const frame15 = [cmd, channel, linId, dir, checkType, dataLen, ...dataArea, linCS]
  const frameCRC = calcFrameCRC(frame15)

  return {
    cmdHex: cmd.toString(16).padStart(2, '0').toUpperCase(),
    channelHex: channel.toString(16).padStart(2, '0').toUpperCase(),
    idHex: linId.toString(16).padStart(2, '0').toUpperCase(),
    pidHex: pid.toString(16).padStart(2, '0').toUpperCase(),
    dirHex: dir.toString(16).padStart(2, '0').toUpperCase(),
    checkTypeHex: checkType.toString(16).padStart(2, '0').toUpperCase(),
    lenHex: dataLen.toString(16).padStart(2, '0').toUpperCase(),
    dataHex: bytesToHex(data.slice(0, dataLen)),
    dataAreaHex: bytesToHex(dataArea),
    enhancedChecksumHex: enhancedCS.toString(16).padStart(2, '0').toUpperCase(),
    classicChecksumHex: classicCS.toString(16).padStart(2, '0').toUpperCase(),
    linChecksumHex: linCS.toString(16).padStart(2, '0').toUpperCase(),
    frameCRCHex: frameCRC.toString(16).padStart(2, '0').toUpperCase(),
    fullFrameHex: bytesToHex([...frame15, frameCRC])
  }
}

// ─── 显示工具 ──────────────────────────────────────────────

/**
 * 字节数组转HEX字符串
 */
function bytesToHex(bytes) {
  return Array.from(bytes || [])
    .map(b => b.toString(16).padStart(2, '0').toUpperCase())
    .join(' ')
}

/**
 * 获取命令名称
 */
function getCmdName(cmd) {
  const names = {
    0x11: '模式配置',
    0x22: '主模式发送',
    0x33: '读从机数据',
    0x44: '监听模式接收',
    0x55: '从机模式发送',
    0x66: '从机通道使能'
  }
  return names[cmd] || ('未知(0x' + cmd.toString(16).toUpperCase() + ')')
}

/**
 * 获取模式名称
 */
function getModeName(mode) {
  const names = {
    0: '监听',
    1: '主模式',
    2: '从模式',
    3: '嗅探'
  }
  return names[mode] || '未知'
}

/**
 * 获取校验类型名称
 */
function getCheckTypeName(ct) {
  const names = {
    0: '无校验',
    1: '经典校验',
    2: '增强校验'
  }
  return names[ct] || ('?(' + ct + ')')
}

// ─── 导出 ──────────────────────────────────────────────────

module.exports = {
  // 常量
  CMD,
  MODE,
  DIR,
  CHECK_TYPE,
  BAUD_RATE_PRESETS,
  SLAVE_CHANNELS,
  LIN_ID_MIN,
  LIN_ID_MAX,

  // 核心
  buildProtectedId,
  buildLinEnhancedChecksum,
  buildLinClassicChecksum,
  buildLinChecksum,
  calcFrameCRC,

  // 帧构建
  buildFrame,
  buildPacket,
  buildModeConfig,
  buildMasterSend,
  buildReadSlave,
  buildSlaveSend,
  buildSlaveEnable,

  // BLE桥接
  wrapForBLE,
  buildAndWrap,

  // 解析
  parseFrame,
  parseReceivedFrame,

  // 预览
  buildPreview,

  // 工具
  bytesToHex,
  parseHex,
  parseData,
  getCmdName,
  getModeName,
  getCheckTypeName
}
