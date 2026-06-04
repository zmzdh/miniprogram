/**
 * BLE 连接管理器 (重构)
 *
 * 支持可配置的服务UUID、MTU协商、自动重连、RSSI监控等
 */

// 预设服务配置
const SERVICE_PRESETS = {
  'HC-08/HM-10': {
    serviceId: '0000ffe0-0000-1000-8000-00805f9b34fb',
    writeId:   '0000ffe1-0000-1000-8000-00805f9b34fb',
    notifyId:  '0000ffe1-0000-1000-8000-00805f9b34fb'
  },
  'CH340 BLE': {
    serviceId: '49535343-FE7D-4AE5-8FA9-9FAFD205E455',
    writeId:   '49535343-8841-43F4-A8D4-ECBE34729BB3',
    notifyId:  '49535343-1E4D-4BD9-BA61-23C647249616'
  }
}

/**
 * BLE 管理器
 */
class BleManager {
  /**
   * @param {Object} options
   * @param {Function} options.onLog - 日志回调
   * @param {Function} options.onDeviceFound - 发现设备回调
   * @param {Function} options.onStatusChange - 状态变化回调 (state, msg)
   * @param {Function} options.onReceiveData - 接收数据回调 (bytes)
   * @param {Function} options.onSendNum - 发送字节数回调
   * @param {Function} options.onRSSI - RSSI 回调 (rssi)
   * @param {Object} [options.serviceConfig] - 自定义服务UUID配置
   * @param {number} [options.scanTimeout] - 扫描超时(ms), 默认10000
   * @param {number} [options.connectTimeout] - 连接超时(ms), 默认10000
   * @param {number} [options.serviceRetryCount] - 服务发现重试次数, 默认5
   * @param {number} [options.serviceRetryDelay] - 服务发现重试延迟(ms), 默认1200
   * @param {boolean} [options.autoReconnect] - 是否自动重连
   * @param {number} [options.maxReconnectAttempts] - 最大重连次数, 默认3
   */
  constructor(options = {}) {
    // 回调
    this.onLog = options.onLog || function () {}
    this.onDeviceFound = options.onDeviceFound || function () {}
    this.onStatusChange = options.onStatusChange || function () {}
    this.onReceiveData = options.onReceiveData || function () {}
    this.onSendNum = options.onSendNum || function () {}
    this.onRSSI = options.onRSSI || function () {}

    // 配置
    this.serviceConfig = options.serviceConfig || SERVICE_PRESETS['HC-08/HM-10']
    this.scanTimeout = options.scanTimeout || 10000
    this.connectTimeout = options.connectTimeout || 10000
    this.serviceRetryCount = options.serviceRetryCount || 5
    this.serviceRetryDelay = options.serviceRetryDelay || 1200
    this.autoReconnect = options.autoReconnect || false
    this.maxReconnectAttempts = options.maxReconnectAttempts || 3

    // 状态
    this.deviceMap = new Map()
    this.deviceId = ''
    this.connected = false
    this.serviceId = ''
    this.writeCharacteristicId = ''
    this.notifyCharacteristicId = ''

    // 发送队列
    this.sendQueue = []
    this.isSending = false
    this.sendChunkSize = 50  // BLE MTU默认20, 保守50字节分块

    // 扫描
    this.scanning = false
    this.scanTimer = null

    // 重连
    this.reconnectTimer = null
    this.reconnectAttempts = 0
    this.reconnectBackoff = 1000  // 初始1秒

    // 监听器
    this.listenersRegistered = false

    this._registerListeners()
  }

  // ─── 日志 & 状态 ────────────────────────────────

  _log(msg) {
    console.log('[BLE]', msg)
    this.onLog(msg)
  }

  _status(state, msg = '') {
    this.onStatusChange(state, msg)
  }

  // ─── 监听器注册 ────────────────────────────────

  _registerListeners() {
    if (this.listenersRegistered) return
    this.listenersRegistered = true

    // 设备发现
    wx.onBluetoothDeviceFound((res) => {
      const devices = res.devices || []
      for (const item of devices) {
        const deviceId = item.deviceId
        if (!deviceId) continue

        const name = item.name || item.localName || 'N/A'
        const device = {
          name,
          deviceId,
          RSSI: item.RSSI,
          advertisData: item.advertisData,
          localName: item.localName
        }

        const existed = this.deviceMap.has(deviceId)
        this.deviceMap.set(deviceId, device)
        this.onDeviceFound(device)

        if (!existed) {
          this._log('发现: ' + name + ' RSSI=' + item.RSSI)
        }
      }
    })

    // 特征值变化 (接收数据)
    wx.onBLECharacteristicValueChange((res) => {
      const bytes = new Uint8Array(res.value)
      this.onReceiveData(bytes)
    })

    // 连接状态变化
    wx.onBLEConnectionStateChange((res) => {
      this._log('连接状态变化: connected=' + res.connected + ' id=' + res.deviceId)
      if (!res.connected) {
        this.connected = false
        this._status('disconnected', '设备意外断开')

        // 自动重连
        if (this.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this._scheduleReconnect()
        }
      }
    })
  }

  // ─── 适配器管理 ────────────────────────────────

  openAdapter() {
    return new Promise((resolve, reject) => {
      this._log('打开蓝牙适配器...')
      wx.openBluetoothAdapter({
        success: () => {
          this._log('蓝牙适配器已打开')
          resolve()
        },
        fail: (err) => {
          this._log('适配器打开失败: ' + JSON.stringify(err))
          this._status('error', '请开启手机蓝牙并使用真机调试')
          reject(err)
        }
      })
    })
  }

  getAdapterState() {
    return new Promise((resolve, reject) => {
      wx.getBluetoothAdapterState({
        success: (res) => {
          this._log('适配器: available=' + res.available + ' discovering=' + res.discovering)
          resolve(res)
        },
        fail: reject
      })
    })
  }

  // ─── 扫描 ──────────────────────────────────────

  async startScan(timeout) {
    const tm = timeout || this.scanTimeout
    this.deviceMap.clear()
    this.scanning = false

    await this.openAdapter()
    const state = await this.getAdapterState()

    if (!state.available) {
      throw new Error('手机蓝牙不可用，请先开启系统蓝牙')
    }

    this._status('scanning', '')
    this._log('开始BLE扫描 (超时' + (tm / 1000) + 's)...')

    await new Promise((resolve, reject) => {
      wx.startBluetoothDevicesDiscovery({
        allowDuplicatesKey: false,
        success: () => {
          this.scanning = true
          this._log('扫描已启动')
          resolve()
        },
        fail: (err) => {
          this._log('启动扫描失败: ' + JSON.stringify(err))
          reject(err)
        }
      })
    })

    // 超时自动停止
    if (this.scanTimer) clearTimeout(this.scanTimer)
    this.scanTimer = setTimeout(() => {
      this.stopScan()
    }, tm)
  }

  stopScan() {
    return new Promise((resolve) => {
      if (this.scanTimer) {
        clearTimeout(this.scanTimer)
        this.scanTimer = null
      }

      wx.stopBluetoothDevicesDiscovery({
        complete: () => {
          if (this.scanning) {
            this._log('扫描已停止')
          }
          this.scanning = false
          this._status('scanned', '')
          resolve()
        }
      })
    })
  }

  // ─── 连接 ──────────────────────────────────────

  async connect(deviceId) {
    // 清除重连状态
    this._clearReconnect()
    this.deviceId = deviceId
    this.connected = false
    this.serviceId = ''
    this.writeCharacteristicId = ''
    this.notifyCharacteristicId = ''

    try {
      await this.stopScan()
      this._status('connecting', '')
      this._log('连接设备: ' + deviceId)

      // 建立BLE连接
      await new Promise((resolve, reject) => {
        wx.createBLEConnection({
          deviceId,
          timeout: this.connectTimeout,
          success: (res) => {
            this._log('BLE连接成功: ' + JSON.stringify(res))
            resolve()
          },
          fail: (err) => {
            this._log('BLE连接失败: ' + JSON.stringify(err))
            reject(err)
          }
        })
      })

      this._log('等待服务稳定 (2s)...')
      await this._sleep(2000)

      // MTU协商 (iOS 6.5.6+)
      try {
        await this._negotiateMTU(deviceId, 185)
      } catch (_) {
        this._log('MTU协商跳过 (可能不支持)')
      }

      // 服务发现 (带重试)
      this._log('开始服务发现...')
      await this._discoverWithRetry(deviceId, this.serviceRetryCount, this.serviceRetryDelay)

      // 开启Notify
      await this._enableNotify()

      // 读取RSSI
      this._readRSSI()

      this.connected = true
      this._log('设备已连接')
      this._status('connected', deviceId)

    } catch (err) {
      this._log('连接失败: ' + (err.errMsg || err.message || JSON.stringify(err)))
      this._status('error', err.errMsg || err.message || '连接失败')

      try { await this.disconnect() } catch (_) {}

      throw err
    }
  }

  /**
   * MTU协商
   */
  _negotiateMTU(deviceId, mtu) {
    return new Promise((resolve, reject) => {
      if (!wx.setBLEMTU) {
        reject(new Error('SDK不支持MTU协商'))
        return
      }
      wx.setBLEMTU({
        deviceId,
        mtu,
        success: (res) => {
          this._log('MTU协商: ' + (res.mtu || mtu))
          // 调整发送分块大小
          if (res.mtu && res.mtu > 20) {
            this.sendChunkSize = Math.floor((res.mtu - 3) * 0.9)
          }
          resolve(res)
        },
        fail: reject
      })
    })
  }

  /**
   * 读取RSSI
   */
  _readRSSI() {
    if (!this.deviceId || !this.connected) return
    wx.getBLEDeviceRSSI({
      deviceId: this.deviceId,
      success: (res) => {
        this.onRSSI(res.RSSI)
      },
      fail: () => {}
    })
  }

  // ─── 服务发现 ──────────────────────────────────

  _discoverWithRetry(deviceId, retryCount, delayMs) {
    return new Promise(async (resolve, reject) => {
      let lastErr = null
      for (let i = 0; i < retryCount; i++) {
        try {
          this._log('服务发现 ' + (i + 1) + '/' + retryCount)
          await this._discover(deviceId)
          return resolve()
        } catch (err) {
          lastErr = err
          this._log('服务发现失败 (尝试' + (i + 1) + '): ' + (err.errMsg || err.message))
          if (i < retryCount - 1) {
            await this._sleep(delayMs)
          }
        }
      }
      reject(lastErr || new Error('服务发现失败'))
    })
  }

  _discover(deviceId) {
    return new Promise(async (resolve, reject) => {
      try {
        // 获取服务列表
        const services = await new Promise((res, rej) => {
          wx.getBLEDeviceServices({
            deviceId,
            success: r => res(r.services || []),
            fail: rej
          })
        })

        this._log('发现 ' + services.length + ' 个服务')
        services.forEach((s, i) => {
          this._log('  服务[' + i + ']: ' + s.uuid + (s.isPrimary ? ' (主)' : ''))
        })

        // 匹配服务
        let matchedService = null
        const svcCfg = this.serviceConfig

        // 先用配置的UUID精确匹配
        for (const s of services) {
          if (s.uuid.toLowerCase() === svcCfg.serviceId.toLowerCase()) {
            matchedService = s
            break
          }
        }

        // 再用FFE0模糊匹配 (兼容HC-08系列)
        if (!matchedService) {
          for (const s of services) {
            if (s.uuid.toLowerCase().includes('ffe0')) {
              matchedService = s
              break
            }
          }
        }

        if (!matchedService) {
          throw new Error('未找到匹配的服务 (需要包含FFE0)')
        }

        this.serviceId = matchedService.uuid
        this._log('匹配服务: ' + this.serviceId)

        // 获取特征列表
        const chars = await new Promise((res, rej) => {
          wx.getBLEDeviceCharacteristics({
            deviceId,
            serviceId: this.serviceId,
            success: r => res(r.characteristics || []),
            fail: rej
          })
        })

        this._log('发现 ' + chars.length + ' 个特征')
        chars.forEach((c, i) => {
          const props = []
          if (c.properties) {
            if (c.properties.write) props.push('写')
            if (c.properties.read) props.push('读')
            if (c.properties.notify) props.push('通知')
            if (c.properties.indicate) props.push('指示')
          }
          this._log('  特征[' + i + ']: ' + c.uuid + ' [' + props.join(',') + ']')
        })

        // 匹配特征
        let writeChar = null
        let notifyChar = null

        // 精确匹配
        for (const c of chars) {
          if (c.uuid.toLowerCase() === svcCfg.writeId.toLowerCase()) {
            writeChar = c
          }
          if (c.uuid.toLowerCase() === svcCfg.notifyId.toLowerCase()) {
            notifyChar = c
          }
        }

        // 模糊匹配 FFE1
        if (!writeChar || !notifyChar) {
          for (const c of chars) {
            if (c.uuid.toLowerCase().includes('ffe1')) {
              writeChar = c
              notifyChar = c
              break
            }
          }
        }

        if (!writeChar) {
          throw new Error('未找到写特征 (需要包含FFE1)')
        }

        this.writeCharacteristicId = writeChar.uuid
        this.notifyCharacteristicId = (notifyChar || writeChar).uuid
        this._log('写特征: ' + this.writeCharacteristicId)
        this._log('通知特征: ' + this.notifyCharacteristicId)

        resolve()
      } catch (err) {
        reject(err)
      }
    })
  }

  // ─── Notify ────────────────────────────────────

  _enableNotify() {
    return new Promise((resolve, reject) => {
      wx.notifyBLECharacteristicValueChange({
        deviceId: this.deviceId,
        serviceId: this.serviceId,
        characteristicId: this.notifyCharacteristicId,
        state: true,
        success: () => {
          this._log('Notify 已开启')
          resolve()
        },
        fail: (err) => {
          this._log('Notify 开启失败: ' + JSON.stringify(err))
          reject(err)
        }
      })
    })
  }

  // ─── 断开连接 ──────────────────────────────────

  disconnect() {
    this._clearReconnect()
    this.sendQueue = []
    this.isSending = false

    return new Promise((resolve) => {
      if (!this.deviceId) {
        this.connected = false
        this._status('disconnected', '已断开')
        resolve()
        return
      }

      wx.closeBLEConnection({
        deviceId: this.deviceId,
        complete: () => {
          this.connected = false
          this.serviceId = ''
          this.writeCharacteristicId = ''
          this.notifyCharacteristicId = ''
          this._log('已断开连接')
          this._status('disconnected', '已手动断开')
          resolve()
        }
      })
    })
  }

  // ─── 数据发送 ──────────────────────────────────

  /**
   * 发送字节数组
   * @param {Uint8Array|number[]} uint8Array
   */
  sendBytes(uint8Array) {
    if (!this.connected || !this.writeCharacteristicId) {
      throw new Error('请先连接蓝牙设备')
    }

    const arr = uint8Array instanceof Uint8Array ? uint8Array : new Uint8Array(uint8Array)
    const chunks = this._splitArray(arr, this.sendChunkSize)
    this.sendQueue.push(...chunks)
    this._processSendQueue()
  }

  _splitArray(uint8Array, batchSize) {
    const result = []
    for (let i = 0; i < uint8Array.length; i += batchSize) {
      result.push(uint8Array.slice(i, i + batchSize))
    }
    return result
  }

  _processSendQueue() {
    if (this.isSending || this.sendQueue.length === 0) return

    const data = this.sendQueue.shift()
    this.isSending = true

    wx.writeBLECharacteristicValue({
      deviceId: this.deviceId,
      serviceId: this.serviceId,
      characteristicId: this.writeCharacteristicId,
      value: data.buffer,
      success: () => {
        this.onSendNum(data.length)
      },
      fail: (err) => {
        this._log('写入失败: ' + JSON.stringify(err))
        // 失败时重新放入队列 (最多重试一次)
        if (!data._retried) {
          data._retried = true
          this.sendQueue.unshift(data)
        }
      },
      complete: () => {
        this.isSending = false
        // 间隔20ms发送下一块
        setTimeout(() => this._processSendQueue(), 20)
      }
    })
  }

  // ─── 自动重连 ──────────────────────────────────

  _scheduleReconnect() {
    if (this.reconnectTimer) return

    this.reconnectAttempts++
    const delay = this.reconnectBackoff * Math.pow(2, this.reconnectAttempts - 1)

    this._log('计划重连 (尝试 ' + this.reconnectAttempts + '/' +
      this.maxReconnectAttempts + ', ' + delay + 'ms 后)')

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null
      try {
        if (this.deviceId) {
          await this.connect(this.deviceId)
          this.reconnectAttempts = 0
          this._log('重连成功')
        }
      } catch (err) {
        this._log('重连失败: ' + (err.errMsg || err.message))
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this._scheduleReconnect()
        } else {
          this._log('达到最大重连次数，停止重连')
          this._status('error', '连接失败，已达最大重试次数')
        }
      }
    }, delay)
  }

  _clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.reconnectAttempts = 0
    this.reconnectBackoff = 1000
  }

  // ─── 工具 ──────────────────────────────────────

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

module.exports = {
  BleManager,
  SERVICE_PRESETS
}
