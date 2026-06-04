/**
 * LDF (LIN Description File) 解析器
 *
 * 解析 LIN 总线标准 LDF 配置文件，提取节点、信号、帧定义，
 * 自动生成设备 Profile 及命令模板数据结构。
 *
 * 支持的 LDF 版本: 1.3, 2.0, 2.1, 2.2
 * 支持的编码: ISO-8859-1, UTF-8
 */

// ─── 预处理 ────────────────────────────────────────────────

// 移除行注释和块注释
function stripComments(text) {
  // 移除块注释
  text = text.replace(/\/\*[\s\S]*?\*\//g, '')
  // 移除行注释
  text = text.replace(/\/\/.*$/gm, '')
  return text
}

/**
 * 提取花括号内的内容 ({ ... })
 * 处理嵌套花括号
 */
function extractBlock(text, startIdx) {
  let depth = 0
  let i = startIdx
  while (i < text.length) {
    const ch = text[i]
    if (ch === '{') { depth++; i++; continue }
    if (ch === '}') {
      depth--
      if (depth === 0) return text.substring(startIdx + 1, i)
      i++
      continue
    }
    if (ch === '"' || ch === "'") {
      // 跳过引号字符串
      const quote = ch
      i++
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') i++
        i++
      }
      i++ // skip closing quote
      continue
    }
    i++
  }
  return null
}

/**
 * 查找节关键字后的花括号块
 */
function findSection(text, keyword) {
  // 匹配 "keyword" 或 "keyword {" 或 "keyword \n {"
  const re = new RegExp(keyword + '\\s*\\{', 'i')
  const match = text.match(re)
  if (!match) return null
  return extractBlock(text, match.index + match[0].length - 1)
}

// ─── 节点解析 ──────────────────────────────────────────────

/**
 * 解析 Nodes 节
 * 返回 { master: string, slaves: string[] }
 */
function parseNodes(text) {
  const block = findSection(text, 'Nodes')
  if (!block) return { master: '', slaves: [] }

  // 匹配 Master: Name, ...
  const masterMatch = block.match(/Master\s*:\s*(\w+)/i)
  const master = masterMatch ? masterMatch[1] : ''

  // 匹配 Slaves: Name1, Name2, ...;
  const slaveMatch = block.match(/Slaves\s*:\s*([^;]+)/i)
  const slaves = []
  if (slaveMatch) {
    const names = slaveMatch[1].split(',').map(s => s.trim()).filter(Boolean)
    slaves.push(...names)
  }

  return { master, slaves }
}

// ─── 波特率解析 ─────────────────────────────────────────────

function parseSpeed(text) {
  // LIN_speed = 19.2 kbps;
  const match = text.match(/LIN_speed\s*=\s*([\d.]+)\s*kbps/i)
  if (!match) return 19200
  const kbps = parseFloat(match[1])
  return Math.round(kbps * 1000)
}

// ─── 信号解析 ──────────────────────────────────────────────

/**
 * 解析 Signals 节
 * 返回 Map: signalName → { size, offset, publisher, subscriber }
 */
function parseSignals(text) {
  const block = findSection(text, 'Signals')
  if (!block) return new Map()

  const map = new Map()
  // SignalName: size, offset, publisher, subscriber[, init_value];
  const re = /(\w+)\s*:\s*(\d+)\s*,\s*(\d+)\s*,\s*(\w+)\s*,\s*(\w+)\s*([^;]*)/g
  let match
  while ((match = re.exec(block)) !== null) {
    map.set(match[1], {
      size: parseInt(match[2]),
      offset: parseInt(match[3]),
      publisher: match[4],
      subscriber: match[5]
    })
  }
  return map
}

// ─── 帧解析 ────────────────────────────────────────────────

/**
 * 解析 Frames 节 (无条件帧)
 * 返回 [{ name, id, idHex, publisher, length, signals }]
 */
function parseFrames(text) {
  const block = findSection(text, 'Frames')
  if (!block) return []

  const frames = []

  // 匹配帧定义:
  // FrameName: id, publisher, length {
  //     signal, offset;
  //     ...
  // }
  // id 可以是 0x12 或 18 格式
  const frameRe = /(\w+)\s*:\s*(0x[0-9a-fA-F]+|\d+)\s*,\s*(\w+)\s*,\s*(\d+)\s*\{/g
  let match
  while ((match = frameRe.exec(block)) !== null) {
    const name = match[1]
    let id
    if (match[2].startsWith('0x') || match[2].startsWith('0X')) {
      id = parseInt(match[2], 16)
    } else {
      id = parseInt(match[2], 10)
    }
    const publisher = match[3]
    const length = parseInt(match[4])
    const blockStart = match.index + match[0].length

    // 提取帧内的信号列表
    const signalBlock = extractBlock(block, blockStart - 1)
    const signals = []
    if (signalBlock) {
      // SignalName, offset;
      const sigRe = /(\w+)\s*,\s*(\d+)\s*/g
      let sigMatch
      while ((sigMatch = sigRe.exec(signalBlock)) !== null) {
        signals.push({ name: sigMatch[1], offset: parseInt(sigMatch[2]) })
      }
    }

    frames.push({
      name,
      id,
      idHex: id.toString(16).toUpperCase(),
      publisher,
      length,
      signals
    })
  }

  return frames
}

// ─── 描述文件头解析 ─────────────────────────────────────────

function parseDescription(text) {
  // LIN_description_file "filename";
  const match = text.match(/LIN_description_file\s*;\s*$/im)
  if (match) return ''

  // 尝试从文件获取名称
  const nodeInfo = parseNodes(text)
  if (nodeInfo.master) {
    return nodeInfo.master
  }
  return ''
}

// ─── 主解析入口 ────────────────────────────────────────────

/**
 * 解析 LDF 文本，生成设备 Profile 数据结构
 *
 * @param {string} text - LDF 文件原始文本
 * @returns {Object} { name, description, baudRate, groups }
 */
function parseLDF(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('LDF 内容为空')
  }

  const clean = stripComments(text)

  // 提取基本信息
  const nodes = parseNodes(clean)
  const baudRate = parseSpeed(clean)
  const frames = parseFrames(clean)
  const signals = parseSignals(clean)

  if (frames.length === 0) {
    throw new Error('未找到 Frames 定义，请检查 LDF 文件格式')
  }

  // 构建名称
  let name = ''
  // 尝试用 LDF 文件名或节点关系命名
  if (nodes.master && nodes.slaves.length > 0) {
    name = nodes.slaves.join('_')
  } else if (nodes.master) {
    name = nodes.master
  } else {
    name = 'LDF_Device'
  }

  // 构建描述
  const parts = []
  if (nodes.master) parts.push('Master: ' + nodes.master)
  if (nodes.slaves.length > 0) parts.push('Slaves: ' + nodes.slaves.join(', '))
  parts.push((baudRate / 1000).toFixed(1) + ' kbps')
  parts.push(frames.length + ' 帧')
  const description = parts.join(' | ')

  // 按发布者分组帧
  const groupMap = new Map()

  for (const frame of frames) {
    let groupName
    if (nodes.master && frame.publisher === nodes.master) {
      groupName = '主模式命令'
    } else {
      groupName = '从机: ' + frame.publisher
    }

    if (!groupMap.has(groupName)) {
      groupMap.set(groupName, [])
    }

    // 生成命令
    const direction = (nodes.master && frame.publisher === nodes.master) ? 'send' : 'read'

    // 生成占位数据和描述
    const dataHex = new Array(frame.length).fill('00').join(' ')
    let cmdDesc = '发布者: ' + frame.publisher
    if (frame.signals.length > 0) {
      const sigNames = frame.signals.map(s => s.name).join(', ')
      cmdDesc = '信号: ' + sigNames
    }

    groupMap.get(groupName).push({
      id: 'c_ldf_' + frame.idHex + '_' + frame.publisher,
      name: frame.name + ' (0x' + frame.idHex + ')',
      description: cmdDesc,
      direction,
      frameIdHex: frame.idHex,
      dataLength: frame.length,
      dataHex
    })
  }

  // 转为数组 (保持主模式分组在前)
  const groups = []
  if (groupMap.has('主模式命令')) {
    groups.push({
      id: 'g_ldf_master',
      name: '主模式命令',
      commands: groupMap.get('主模式命令')
    })
    groupMap.delete('主模式命令')
  }
  for (const [groupName, commands] of groupMap) {
    groups.push({
      id: 'g_ldf_' + groupName.replace(/[^a-zA-Z0-9_一-鿿]/g, '_'),
      name: groupName,
      commands
    })
  }

  return { name, description, baudRate, groups }
}

// ─── 导出 ──────────────────────────────────────────────────

module.exports = {
  parseLDF
}
