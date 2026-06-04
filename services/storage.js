/**
 * 本地存储服务
 *
 * 统一管理所有本地数据的读写
 */

const KEYS = {
  LAST_DEVICE:   'last_connected_device',
  DEVICE_PROFILES: 'device_profiles',
  FRAME_HISTORY: 'frame_history',
  LOG_HISTORY:   'log_history',
  SETTINGS:      'app_settings',
  BLE_SERVICE:   'ble_service_config'
}

const MAX_HISTORY = 500
const MAX_LOGS = 200

// ─── 设备 ─────────────────────────────────────────

function getLastDevice() {
  try {
    return wx.getStorageSync(KEYS.LAST_DEVICE) || null
  } catch (_) { return null }
}

function setLastDevice(device) {
  try {
    wx.setStorageSync(KEYS.LAST_DEVICE, {
      deviceId: device.deviceId,
      name: device.name || '',
      timestamp: Date.now()
    })
  } catch (_) {}
}

function clearLastDevice() {
  try { wx.removeStorageSync(KEYS.LAST_DEVICE) } catch (_) {}
}

// ─── 设备配置 ────────────────────────────────────

function getDeviceProfiles() {
  try {
    const saved = wx.getStorageSync(KEYS.DEVICE_PROFILES)
    return saved || []
  } catch (_) { return [] }
}

function setDeviceProfiles(profiles) {
  try {
    wx.setStorageSync(KEYS.DEVICE_PROFILES, profiles)
  } catch (_) {}
}

function addDeviceProfile(profile) {
  const profiles = getDeviceProfiles()
  profile.id = profile.id || ('p_' + Date.now())
  profile.updatedAt = Date.now()
  profiles.push(profile)
  setDeviceProfiles(profiles)
  return profile
}

function updateDeviceProfile(id, updates) {
  const profiles = getDeviceProfiles()
  const idx = profiles.findIndex(p => p.id === id)
  if (idx >= 0) {
    profiles[idx] = { ...profiles[idx], ...updates, updatedAt: Date.now() }
    setDeviceProfiles(profiles)
    return profiles[idx]
  }
  return null
}

function deleteDeviceProfile(id) {
  const profiles = getDeviceProfiles().filter(p => p.id !== id)
  setDeviceProfiles(profiles)
}

// ─── 帧历史 ──────────────────────────────────────

function getFrameHistory() {
  try {
    return wx.getStorageSync(KEYS.FRAME_HISTORY) || []
  } catch (_) { return [] }
}

function addFrame(frame) {
  const history = getFrameHistory()
  history.unshift({
    ...frame,
    time: _nowTime(),
    timestamp: Date.now()
  })
  // 限制数量
  if (history.length > MAX_HISTORY) {
    history.length = MAX_HISTORY
  }
  try {
    wx.setStorageSync(KEYS.FRAME_HISTORY, history)
  } catch (_) {}
  return history
}

function clearFrameHistory() {
  try { wx.removeStorageSync(KEYS.FRAME_HISTORY) } catch (_) {}
}

// ─── 日志 ────────────────────────────────────────

function getLogs() {
  try {
    return wx.getStorageSync(KEYS.LOG_HISTORY) || []
  } catch (_) { return [] }
}

function addLog(msg) {
  const logs = getLogs()
  logs.unshift({
    time: _nowTime(),
    msg,
    timestamp: Date.now()
  })
  if (logs.length > MAX_LOGS) {
    logs.length = MAX_LOGS
  }
  try {
    wx.setStorageSync(KEYS.LOG_HISTORY, logs)
  } catch (_) {}
  return logs
}

function clearLogs() {
  try { wx.removeStorageSync(KEYS.LOG_HISTORY) } catch (_) {}
}

// ─── 设置 ────────────────────────────────────────

const DEFAULT_SETTINGS = {
  scanTimeout: 10000,
  connectTimeout: 10000,
  autoReconnect: false,
  maxReconnectAttempts: 3,
  defaultBaudRate: 19200,
  defaultCheckType: 2,  // 增强校验
  defaultMode: 1,        // 主模式
  periodicInterval: 500,
  sendChunkSize: 50,
  showRawHex: true,
  showParsedFrame: true,
  darkMode: false
}

function getSettings() {
  try {
    const saved = wx.getStorageSync(KEYS.SETTINGS)
    return { ...DEFAULT_SETTINGS, ...saved }
  } catch (_) { return { ...DEFAULT_SETTINGS } }
}

function setSettings(updates) {
  const current = getSettings()
  const merged = { ...current, ...updates }
  try {
    wx.setStorageSync(KEYS.SETTINGS, merged)
  } catch (_) {}
  return merged
}

// ─── BLE服务配置 ────────────────────────────────

function getBLEServiceConfig() {
  try {
    return wx.getStorageSync(KEYS.BLE_SERVICE) || null
  } catch (_) { return null }
}

function setBLEServiceConfig(config) {
  try {
    wx.setStorageSync(KEYS.BLE_SERVICE, config)
  } catch (_) {}
}

// ─── 导出数据 ────────────────────────────────────

/**
 * 导出帧历史为CSV
 */
function exportFrameHistoryCSV() {
  const history = getFrameHistory()
  if (history.length === 0) return ''

  const header = '时间,方向,Frame ID,长度,数据,校验,原始HEX'
  const rows = history.map(item => {
    const dir = item.dirName || (item.direction === 'send' ? '发送' : '接收')
    return [
      item.time,
      dir,
      item.linIdHex || item.frameIdHex || '',
      item.dataLen || item.lengthHex || '',
      item.dataHex || '',
      item.linCheckHex || item.checksumHex || '',
      item.rawHex || ''
    ].join(',')
  })

  return [header, ...rows].join('\n')
}

/**
 * 导出帧历史为 JSON
 */
function exportFrameHistoryJSON() {
  return JSON.stringify(getFrameHistory(), null, 2)
}

/**
 * 导出设备配置为 JSON
 */
function exportProfilesJSON() {
  return JSON.stringify(getDeviceProfiles(), null, 2)
}

/**
 * 导入设备配置 JSON
 */
function importProfilesJSON(jsonStr) {
  const data = JSON.parse(jsonStr)
  if (!Array.isArray(data)) throw new Error('数据格式错误')
  setDeviceProfiles(data)
  return data
}

// ─── 工具 ────────────────────────────────────────

function _nowTime() {
  const now = new Date()
  return [
    now.getHours().toString().padStart(2, '0'),
    now.getMinutes().toString().padStart(2, '0'),
    now.getSeconds().toString().padStart(2, '0')
  ].join(':')
}

// ─── 导出 ─────────────────────────────────────────

module.exports = {
  KEYS,
  MAX_HISTORY,
  MAX_LOGS,
  DEFAULT_SETTINGS,

  // 设备
  getLastDevice,
  setLastDevice,
  clearLastDevice,

  // 设备配置
  getDeviceProfiles,
  setDeviceProfiles,
  addDeviceProfile,
  updateDeviceProfile,
  deleteDeviceProfile,

  // 帧历史
  getFrameHistory,
  addFrame,
  clearFrameHistory,

  // 日志
  getLogs,
  addLog,
  clearLogs,

  // 设置
  getSettings,
  setSettings,

  // BLE
  getBLEServiceConfig,
  setBLEServiceConfig,

  // 导出
  exportFrameHistoryCSV,
  exportFrameHistoryJSON,
  exportProfilesJSON,
  importProfilesJSON
}
