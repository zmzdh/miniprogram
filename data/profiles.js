/**
 * 设备配置 - 初始数据
 *
 * 首次启动时自动导入 storage。
 * 后续通过「配置」页面增删改。
 */

const deviceProfiles = [
  {
    id: 'seat_a',
    name: 'Seat A',
    description: '座椅A型控制器 - 状态读取与气泵控制',
    groups: [
      {
        id: 'g_status_a',
        name: '状态读取',
        commands: [
          {
            id: 'read_status',
            name: '读取状态',
            description: '读取当前设备完整状态 (4字节)',
            direction: 'read',
            frameIdHex: '12',
            dataLength: 4,
            dataHex: ''
          },
          {
            id: 'read_temp',
            name: '读取温度',
            description: '读取当前温度信息 (2字节)',
            direction: 'read',
            frameIdHex: '15',
            dataLength: 2,
            dataHex: ''
          }
        ]
      },
      {
        id: 'g_pump_a',
        name: '气泵控制',
        commands: [
          {
            id: 'pump_on',
            name: '启动气泵',
            description: '启动气泵输出 (Ch1=ON, Ch2=ON)',
            direction: 'send',
            frameIdHex: '21',
            dataLength: 2,
            dataHex: '01 01'
          },
          {
            id: 'pump_off',
            name: '关闭气泵',
            description: '关闭气泵输出 (Ch1=ON, Ch2=OFF)',
            direction: 'send',
            frameIdHex: '21',
            dataLength: 2,
            dataHex: '01 00'
          }
        ]
      }
    ]
  },
  {
    id: 'seat_b',
    name: 'Seat B',
    description: '座椅B型控制器 - 状态读取与按摩控制',
    groups: [
      {
        id: 'g_status_b',
        name: '状态读取',
        commands: [
          {
            id: 'read_status_b',
            name: '读取状态',
            description: '读取当前设备状态 (4字节)',
            direction: 'read',
            frameIdHex: '18',
            dataLength: 4,
            dataHex: ''
          }
        ]
      },
      {
        id: 'g_massage_b',
        name: '按摩控制',
        commands: [
          {
            id: 'massage_on',
            name: '启动按摩',
            description: '启动按摩模式 (Mode=ON)',
            direction: 'send',
            frameIdHex: '31',
            dataLength: 2,
            dataHex: '01 01'
          },
          {
            id: 'massage_off',
            name: '关闭按摩',
            description: '关闭按摩模式 (Mode=OFF)',
            direction: 'send',
            frameIdHex: '31',
            dataLength: 2,
            dataHex: '01 00'
          }
        ]
      }
    ]
  }
]

/**
 * 初始化默认数据到 storage (仅在首次时调用)
 */
function initDefaultProfiles(storage) {
  const existing = storage.getDeviceProfiles()
  if (!existing || existing.length === 0) {
    storage.setDeviceProfiles(deviceProfiles)
    console.log('[Profiles] 已导入默认设备配置')
    return true
  }
  return false
}

module.exports = {
  deviceProfiles,
  initDefaultProfiles
}
