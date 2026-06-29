# LINHelper 通信协议 V1.2.0

> 具备一主多从架构，优化帧结构、完整性校验、错误报告、命令确认和设备发现机制
>
> 协议所有者：苏州市振民电子科技有限公司

---

## 目录

1. [协议概述](#1-协议概述)
2. [传输层](#2-传输层)
3. [帧格式](#3-帧格式)
4. [命令定义](#4-命令定义)
5. [状态码](#5-状态码)
6. [时序与流程](#6-时序与流程)
7. [LIN UDS 与固件升级](#7-lin-uds-与固件升级)
8. [附录](#8-附录)

---

## 1. 协议概述

### 1.1 设计目标

- **保持一主多从**：保留 Master/Slave/Monitor/Sniffer 四种工作模式，16 通道从机。
- **更强的完整性**：协议帧使用 CRC-8/ATM 校验，LIN 数据保持 LIN 标准校验和。
- **双向确认**：定义通用 ACK/ERROR 机制，携带原始命令和状态码。
- **设备发现**：PING/PONG 发现设备并获取协议版本、设备类型和能力信息。
- **统一帧格式**：所有命令使用相同的 16 字节 LINHelper 帧结构。
- **可落地实现**：明确 ID/PID、LIN_CKS、BLE 拼帧和请求并发约束，减少小程序端和固件端理解偏差。
- **支持诊断升级**：增加 LIN UDS 透明诊断通道和可选的托管固件升级命令。

### 1.2 V1.2.0 变更摘要

- 明确 CRC-8/ATM 参数，删除 CRC-8-Dallas 混用名称，并增加标准测试向量。
- 增加通用 ACK (0x05)，闭合 ACK_REQ 的响应规则。
- 补齐 SLAVE_CFG_ACK、SET_PARAM、GET_PARAM、PARAM_DATA 命令定义。
- 明确协议帧 ID 字段为 6-bit LIN ID，设备负责生成/校验 PID。
- 明确 LIN_CKS 的填写责任、自动计算规则和诊断帧校验例外。
- 增加 BLE 桥接帧拼包规则、请求并发约束和监听/嗅探错误上报约定。

### 1.3 工作模式

| 模式 | 值 | 说明 |
|------|-----|------|
| MONITOR | 0x00 | 监听模式：仅监听 LIN 总线，不参与通信 |
| MASTER | 0x01 | 主模式：作为主节点发送帧头和数据 |
| SLAVE | 0x02 | 从模式：作为从节点响应主节点请求，最多 16 通道 |
| SNIFFER | 0x03 | 嗅探模式：捕获总线流量和低层事件，包括 break、PID 错误、checksum 错误等 |

模式切换需间隔不小于 100 ms。模式切换期间设备可返回 `ERR_BUSY`。

---

## 2. 传输层

### 2.1 UART 参数

| 参数 | 值 |
|------|-----|
| 波特率 | 460800 bps |
| 数据位 | 8 位 |
| 校验位 | 无 |
| 停止位 | 1 位 |

### 2.2 BLE 桥接帧

```
[0xAA, 0x55, ...16字节 LINHelper 帧..., 0x0D, 0x0A]
```

| 偏移 | 长度 | 值 | 说明 |
|------|------|-----|------|
| 0 | 1 | 0xAA | 帧起始头 |
| 1 | 1 | 0x55 | 帧起始头，双字节防误触 |
| 2-17 | 16 | - | LINHelper 协议帧 |
| 18 | 1 | 0x0D | 帧结束符 CR |
| 19 | 1 | 0x0A | 帧结束符 LF |

BLE 接收端必须按固定 20 字节桥接帧拼包。`0x0D 0x0A` 只作为固定尾标记，不作为流式文本结束符；如果 BLE 通知发生分包或粘包，接收端应缓存后按 `[0xAA,0x55] + 16 字节 payload + [0x0D,0x0A]` 重新组帧。

收到非法帧头、非法尾标记或 CRC8 错误时，接收端丢弃该桥接帧，并从下一个可能的 `0xAA 0x55` 位置重新同步。

**与 LINTest-M 的区别**：起始头由 `[0x3A, 0x01]` 改为 `[0xAA, 0x55]`，去掉冗余的 0x01 字节，使用交替位模式降低误触发概率。

---

## 3. 帧格式

### 3.1 通用帧结构 (16 字节)

所有命令遵循统一的 16 字节帧结构：

| 偏移 | 字段 | 大小 | 说明 |
|------|------|------|------|
| 0 | CMD | 1 | 命令码 (0x01-0x7F) |
| 1 | CHANNEL | 1 | 通道号 (0-15)，非从机命令填 0 |
| 2 | ID | 1 | LIN ID (0x00-0x3F)、原始命令码或参数 ID，按命令定义解释 |
| 3 | FLAGS | 1 | 标志位，详见 §3.1.1 |
| 4 | LEN | 1 | 数据长度 (0-8) |
| 5-12 | DATA[0..7] | 8 | 数据负载，有效长度由 LEN 指定 |
| 13 | LIN_CKS | 1 | LIN 校验和，非 LIN 命令填 0x00 |
| 14 | STATUS | 1 | 状态码；请求填 0x00，应答返回执行结果 |
| 15 | CRC8 | 1 | CRC-8/ATM 帧校验 |

保留字段和未使用的 DATA 字节必须填 0x00。接收端遇到保留位非 0 时，应优先返回 `ERR_INVALID_PARAM`，便于后续版本扩展。

### 3.1.1 FLAGS 标志位定义

| 位 | 名称 | 说明 |
|----|------|------|
| bit0 | LIN_DIR | LIN 总线数据方向：0=设备向 LIN 总线发送数据，1=设备从 LIN 总线接收数据 |
| bit1-2 | CHECK_TYPE | LIN 校验类型：0=无校验, 1=经典(V1.x), 2=增强(V2.x), 3=保留 |
| bit3 | ACK_REQ | 应答请求：1=要求设备在命令执行完成后返回 ACK 或专用应答 |
| bit4 | EXT | 扩展数据：V1.2.0 保留，必须填 0 |
| bit5 | LIN_ERR | 仅上报帧使用：1=捕获到 LIN 错误，错误类型见 STATUS |
| bit6-7 | RSV | 保留位，必须填 0 |

`LIN_DIR` 只描述 LIN 总线方向，不描述手机与设备之间的 BLE/UART 传输方向。手机到设备、设备到手机的方向以命令表中的 H→D/D→H 为准。

### 3.2 ID 与 PID 规则

协议帧中的 `ID` 字段默认表示 6-bit LIN ID，合法范围为 `0x00-0x3F`。设备在真实 LIN 总线上发送时，必须根据 LIN ID 自动生成 Protected ID (PID) 的 P0/P1 校验位。

监听或嗅探上报时，`ID` 默认上报解析后的 6-bit LIN ID。如果捕获到 PID parity 错误，设备仍可上报低 6 位 ID，同时设置 `FLAGS.LIN_ERR=1`，并在 `STATUS` 中填 `ERR_PID_PARITY`。

### 3.3 CRC-8 计算

采用 **CRC-8/ATM** 算法：

| 参数 | 值 |
|------|-----|
| 多项式 | 0x07 (x^8 + x^2 + x + 1) |
| 初始值 | 0x00 |
| 输入反射 | false |
| 输出反射 | false |
| 结果异或 | 0x00 |
| 校验范围 | 前 15 字节，offset 0-14 |
| 标准测试向量 | ASCII `123456789` -> 0xF4 |

```
CRC8 = crc8_atm(frame[0..14])
```

参考实现（JavaScript）：

```javascript
function calcCRC8(bytes) {
  let crc = 0x00
  for (const b of bytes) {
    crc ^= b
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) : (crc << 1)
      crc &= 0xFF
    }
  }
  return crc
}
```

### 3.4 LIN 校验和

保持与 LIN 标准一致的校验和计算，兼容三种类型：

| CHECK_TYPE | 算法 | 适用范围 |
|-----------|------|---------|
| 0 (NONE) | 返回 0x00 | 调试/非标 |
| 1 (CLASSIC) | `~(data[0] + ... + data[n-1])` | LIN V1.x、诊断帧 |
| 2 (ENHANCED) | `~(PID + data[0] + ... + data[n-1])` | LIN V2.x 常规帧，默认 |

数据长度 `LEN` 为实际有效数据字节数，范围为 1-8。

LIN 诊断 ID `0x3C` 和 `0x3D` 使用 classic checksum。即使 `CHECK_TYPE=2`，设备也应按 LIN 规范对这两个 ID 使用 classic checksum，并在应答中保持原 `CHECK_TYPE` 回显。

### 3.5 LIN_CKS 填写规则

对于 `MASTER_SEND` 和 `SLAVE_SEND`：

- 请求帧中 `LIN_CKS=0x00` 表示由设备按 `CHECK_TYPE` 自动计算 LIN 校验和。
- 请求帧中 `LIN_CKS!=0x00` 表示手机端已指定校验和，设备应校验该值；不匹配时返回 `ERR_CHECKSUM`。
- 当合法 LIN checksum 计算结果恰好为 `0x00` 时，手机端无法用单字节区分“指定 0x00”和“自动计算”。如需强制指定该值，应在后续扩展中使用 `EXT` 机制；V1.2.0 默认按自动计算处理。

对于 `READ_SLAVE`：请求帧 `LIN_CKS` 固定填 0x00。`SLAVE_DATA` 中的 `LIN_CKS` 为设备从 LIN 总线实际接收到的 checksum。

对于 `MONITOR_DATA`：`LIN_CKS` 为捕获到的 LIN checksum 原始值。如果 checksum 错误，仍上报捕获值，并设置 `FLAGS.LIN_ERR=1`、`STATUS=ERR_CHECKSUM`。

### 3.6 请求并发约束

V1.2.0 不引入事务序列号。单个 BLE/UART 连接上，手机端同一时间只能存在一个未完成请求。设备主动上报的 `MONITOR_DATA`、`SLAVE_DATA` 和 `HEARTBEAT` 可以穿插出现，手机端必须按 `CMD` 区分主动上报和请求响应。

如后续需要并发请求，应在 V1.2 或更高版本中使用 `EXT` 扩展头增加序列号。

---

## 4. 命令定义

### 4.1 命令码一览

| 命令码 | 方向 | 名称 | 说明 |
|--------|------|------|------|
| 0x01 | H→D | PING | 设备发现 / 健康检查 |
| 0x02 | D→H | PONG | 设备能力应答 |
| 0x03 | H→D | GET_STATUS | 查询设备当前状态 |
| 0x04 | D→H | STATUS | 设备状态应答 |
| 0x05 | D→H | ACK | 通用命令确认 |
| 0x11 | H→D | SET_MODE | 设置工作模式和波特率 |
| 0x12 | D→H | MODE_ACK | 模式设置确认 |
| 0x21 | H→D | MASTER_SEND | 主节点发送 LIN 帧 |
| 0x22 | H→D | READ_SLAVE | 请求读取从节点数据 |
| 0x23 | D→H | SLAVE_DATA | 从节点数据应答 / 从机模式事件上报 |
| 0x31 | D→H | MONITOR_DATA | 监听/嗅探模式数据上报 |
| 0x41 | H→D | SLAVE_SEND | 从节点发送/接收 LIN 帧 |
| 0x42 | H→D | SLAVE_CFG | 从机通道配置，使能/禁止 |
| 0x43 | D→H | SLAVE_CFG_ACK | 从机通道配置确认 |
| 0x51 | H→D | SET_PARAM | 设置设备参数 |
| 0x52 | H→D | GET_PARAM | 读取设备参数 |
| 0x53 | D→H | PARAM_DATA | 设备参数应答 |
| 0x5F | D→H | ERROR | 通用错误应答 |
| 0x61 | H→D | DIAG_SEND | 发送或轮询 LIN UDS 诊断帧 |
| 0x62 | D→H | DIAG_RESP | LIN UDS 诊断响应上报 |
| 0x71 | H→D | FW_BEGIN | 开始托管固件升级 |
| 0x72 | H→D | FW_DATA | 发送固件升级数据块 |
| 0x73 | H→D | FW_END | 结束升级并触发校验/复位 |
| 0x74 | H→D / D→H | FW_STATUS | 查询或上报固件升级状态/进度 |
| 0x75 | H→D | FW_ABORT | 中止托管固件升级 |
| 0x7E | H→D / D→H | HEARTBEAT | 心跳保活 |

> H→D = 手机 → 设备，D→H = 设备 → 手机。

### 4.2 通用 ACK/ERROR 规则

当请求命令设置 `ACK_REQ=1`，且该命令没有专用应答帧时，设备必须返回 `ACK (0x05)` 或 `ERROR (0x5F)`。

当请求命令本身已有专用应答帧时，专用应答帧同时承担 ACK 语义，例如 `SET_MODE -> MODE_ACK`、`SLAVE_CFG -> SLAVE_CFG_ACK`、`GET_PARAM -> PARAM_DATA`。

如果 `ACK_REQ=0`，设备仍可在发生错误时返回 `ERROR (0x5F)`。

---

#### 4.2.1 PING (0x01) 设备发现

**方向**：手机 → 设备

| 字段 | 值 | 说明 |
|------|-----|------|
| CMD | 0x01 | PING |
| CHANNEL | 0x00 | - |
| ID | 0x00 | - |
| FLAGS | 0x00 | - |
| LEN | 0x00 | - |
| DATA[0..7] | 全 0 | - |
| LIN_CKS | 0x00 | - |
| STATUS | 0x00 | - |
| CRC8 | - | 帧校验 |

---

#### 4.2.2 PONG (0x02) 设备能力应答

**方向**：设备 → 手机

| 字段 | 值 | 说明 |
|------|-----|------|
| CMD | 0x02 | PONG |
| CHANNEL | 0x00 | - |
| ID | 0x00 | - |
| FLAGS | 0x00 | - |
| LEN | 0x08 | 数据长度固定 8 |
| DATA[0] | - | 协议版本号主版本，例如 0x01 |
| DATA[1] | - | 协议版本号次版本，例如 0x02 |
| DATA[2] | - | 设备类型：0=通用调试器, 1=LIN 主节点, 2=LIN 从节点, 3=网关 |
| DATA[3] | - | 能力位掩码 |
| DATA[4] | - | 最大 LIN 数据长度，V1.2.0 固定为 8 |
| DATA[5-7] | 0x00 | 保留 |
| LIN_CKS | 0x00 | - |
| STATUS | 0x00 | 成功 |
| CRC8 | - | 帧校验 |

**能力位掩码 (DATA[3])**：

| 位 | 说明 |
|----|------|
| bit0 | 支持主模式 |
| bit1 | 支持从模式 |
| bit2 | 支持监听模式 |
| bit3 | 支持嗅探模式 |
| bit4 | 支持增强校验 (LIN V2.x) |
| bit5 | 支持 LIN UDS 透明诊断通道 |
| bit6 | 支持托管固件升级 |
| bit7 | 保留 |

---

#### 4.2.3 GET_STATUS (0x03)

**方向**：手机 → 设备

| 字段 | 值 | 说明 |
|------|-----|------|
| CMD | 0x03 | GET_STATUS |
| CHANNEL | 0x00 | - |
| 其余字段 | 全 0 | - |

---

#### 4.2.4 STATUS (0x04)

**方向**：设备 → 手机

| 字段 | 值 | 说明 |
|------|-----|------|
| CMD | 0x04 | STATUS |
| CHANNEL | 0x00 | - |
| ID | 0x00 | - |
| FLAGS | 0x00 | - |
| LEN | 0x05 | - |
| DATA[0] | - | 当前工作模式 (0-3) |
| DATA[1] | - | 当前 LIN 波特率高 8 位 |
| DATA[2] | - | 当前 LIN 波特率低 8 位 |
| DATA[3] | - | 已使能的从机通道位掩码 [7:0] |
| DATA[4] | - | 已使能的从机通道位掩码 [15:8] |
| DATA[5-7] | 0x00 | 保留 |
| LIN_CKS | 0x00 | - |
| STATUS | 0x00 | 成功 |
| CRC8 | - | 帧校验 |

---

#### 4.2.5 ACK (0x05) 通用命令确认

**方向**：设备 → 手机

| 字段 | 值 | 说明 |
|------|-----|------|
| CMD | 0x05 | ACK |
| CHANNEL | - | 回显请求 CHANNEL |
| ID | - | 触发 ACK 的原命令码 |
| FLAGS | - | 回显请求 FLAGS，ACK_REQ 位可清 0 |
| LEN | 0x02 | - |
| DATA[0] | - | 原命令码，和 ID 相同，便于解析 |
| DATA[1] | - | 原命令执行结果，0x00=成功 |
| DATA[2-7] | 0x00 | 保留 |
| LIN_CKS | 0x00 | - |
| STATUS | - | 0x00=成功，其他=错误码 |
| CRC8 | - | 帧校验 |

---

#### 4.2.6 SET_MODE (0x11) 设置模式和波特率

**方向**：手机 → 设备

| 字段 | 值 | 说明 |
|------|-----|------|
| CMD | 0x11 | SET_MODE |
| CHANNEL | 0x00 | - |
| ID | - | 工作模式：0=MONITOR, 1=MASTER, 2=SLAVE, 3=SNIFFER |
| FLAGS | 0x00 | - |
| LEN | 0x02 | - |
| DATA[0] | - | LIN 波特率高 8 位 |
| DATA[1] | - | LIN 波特率低 8 位 |
| DATA[2-7] | 0x00 | 填充 |
| LIN_CKS | 0x00 | - |
| STATUS | 0x00 | - |
| CRC8 | - | 帧校验 |

波特率计算公式：`BaudRate = (DATA[0] << 8) | DATA[1]`。

**预设值对照**：

| 波特率 | DATA[0] | DATA[1] |
|--------|---------|---------|
| 20000 | 0x4E | 0x20 |
| 19200 | 0x4B | 0x00 |
| 10400 | 0x28 | 0xA0 |
| 9600 | 0x25 | 0x80 |
| 4800 | 0x12 | 0xC0 |

---

#### 4.2.7 MODE_ACK (0x12) 模式设置确认

**方向**：设备 → 手机

| 字段 | 值 | 说明 |
|------|-----|------|
| CMD | 0x12 | MODE_ACK |
| CHANNEL | 0x00 | - |
| ID | - | 实际切换后的当前模式 |
| FLAGS | 0x00 | - |
| LEN | 0x02 | - |
| DATA[0] | - | 当前 LIN 波特率高 8 位 |
| DATA[1] | - | 当前 LIN 波特率低 8 位 |
| DATA[2-7] | 0x00 | 保留 |
| LIN_CKS | 0x00 | - |
| STATUS | - | 0x00=成功，其他=错误码 |
| CRC8 | - | 帧校验 |

---

#### 4.2.8 MASTER_SEND (0x21) 主节点发送 LIN 帧

**方向**：手机 → 设备

| 字段 | 值 | 说明 |
|------|-----|------|
| CMD | 0x21 | MASTER_SEND |
| CHANNEL | 0x00 | - |
| ID | - | LIN ID (0x00-0x3F) |
| FLAGS | - | LIN_DIR=0，CHECK_TYPE 按需设置，ACK_REQ 可选 |
| LEN | 1-8 | LIN 数据长度 |
| DATA[0..7] | - | 要发送的 LIN 数据，有效数据在前 LEN 字节 |
| LIN_CKS | - | 见 §3.5 |
| STATUS | 0x00 | - |
| CRC8 | - | 帧校验 |

**ID 特殊值说明**：

| ID | 说明 |
|----|------|
| 0x3C | 主请求帧，诊断；Go-to-Sleep 使用该 ID 且数据符合 LIN 规范 |
| 0x3D | 从应答帧，诊断 |
| 0x3E | 用户自定义帧 |
| 0x3F | 保留帧，LIN 2.1 未定义 |

若 `ACK_REQ=1`，设备在确认 LIN 帧发送到总线后返回 `ACK (0x05)`；发送失败返回 `ERROR (0x5F)`。

---

#### 4.2.9 READ_SLAVE (0x22) 请求读取从节点数据

**方向**：手机 → 设备

| 字段 | 值 | 说明 |
|------|-----|------|
| CMD | 0x22 | READ_SLAVE |
| CHANNEL | 0x00 | - |
| ID | - | LIN ID (0x00-0x3F) |
| FLAGS | - | LIN_DIR=1，CHECK_TYPE 按需设置 |
| LEN | 1-8 | 期望的数据长度 |
| DATA[0..7] | 全 0 | - |
| LIN_CKS | 0x00 | - |
| STATUS | 0x00 | - |
| CRC8 | - | 帧校验 |

成功时设备返回 `SLAVE_DATA (0x23)`；失败时返回 `ERROR (0x5F)`。

---

#### 4.2.10 SLAVE_DATA (0x23) 从节点数据应答 / 从机事件上报

**方向**：设备 → 手机

| 字段 | 值 | 说明 |
|------|-----|------|
| CMD | 0x23 | SLAVE_DATA |
| CHANNEL | - | 主模式读取时填 0；从机模式上报时填从机通道号 |
| ID | - | LIN ID |
| FLAGS | - | LIN_DIR 和 CHECK_TYPE |
| LEN | 0-8 | 实际返回或收发的数据长度 |
| DATA[0..7] | - | LIN 数据 |
| LIN_CKS | - | 设备从 LIN 总线接收或发送的 checksum |
| STATUS | - | 0x00=成功，其他=错误码 |
| CRC8 | - | 帧校验 |

---

#### 4.2.11 MONITOR_DATA (0x31) 监听/嗅探模式数据上报

**方向**：设备 → 手机

设备在 MONITOR 或 SNIFFER 模式下捕获到 LIN 总线帧或低层事件时主动上报。

| 字段 | 值 | 说明 |
|------|-----|------|
| CMD | 0x31 | MONITOR_DATA |
| CHANNEL | 0x00 | - |
| ID | - | 捕获到的 LIN ID；PID 错误时为原始 PID 低 6 位 |
| FLAGS | - | LIN_DIR、CHECK_TYPE；出错时置 LIN_ERR=1 |
| LEN | 0-8 | 捕获数据长度；低层事件可为 0 |
| DATA[0..7] | - | 捕获的 LIN 数据或事件参数 |
| LIN_CKS | - | 捕获的 LIN checksum；无 checksum 事件填 0 |
| STATUS | - | 0x00=正常帧，其他=错误/事件码 |
| CRC8 | - | 帧校验 |

SNIFFER 模式可使用以下事件上报：

| STATUS | 事件 | DATA 定义 |
|--------|------|-----------|
| 0x00 | 正常 LIN 帧 | DATA 为 LIN 数据 |
| 0x0A | checksum 错误 | DATA 为捕获数据，LIN_CKS 为捕获 checksum |
| 0x0C | PID parity 错误 | DATA[0] 为原始 PID |
| 0x0D | break 捕获 | DATA[0..1] 为 break 宽度，单位由设备参数定义 |
| 0x0E | sync 错误 | DATA[0] 为捕获到的 sync 字节 |

---

#### 4.2.12 SLAVE_SEND (0x41) 从节点收发 LIN 帧

**方向**：手机 → 设备

在从机模式下，配置从机通道的发送或接收数据。

| 字段 | 值 | 说明 |
|------|-----|------|
| CMD | 0x41 | SLAVE_SEND |
| CHANNEL | 0-15 | 从机通道号 |
| ID | - | LIN ID |
| FLAGS | - | LIN_DIR：0=从机向 LIN 主节点应答，1=从机接收主节点数据 |
| LEN | 0-8 | 数据长度，LIN_DIR=0 时为待发送数据长度 |
| DATA[0..7] | - | 待发送数据或 0 |
| LIN_CKS | - | 见 §3.5 |
| STATUS | 0x00 | - |
| CRC8 | - | 帧校验 |

若 `ACK_REQ=1`，设备完成配置后返回 `ACK (0x05)`。真实 LIN 总线收发结果通过 `SLAVE_DATA (0x23)` 主动上报。

---

#### 4.2.13 SLAVE_CFG (0x42) 从机通道配置

**方向**：手机 → 设备

| 字段 | 值 | 说明 |
|------|-----|------|
| CMD | 0x42 | SLAVE_CFG |
| CHANNEL | 0-15 | 目标从机通道 |
| ID | - | 该通道关联的 LIN ID；禁用通道时可填 0 |
| FLAGS | 0x00 | - |
| LEN | 0x01 | - |
| DATA[0] | - | 0x00=禁止，0x01=使能 |
| DATA[1-7] | 0x00 | - |
| LIN_CKS | 0x00 | - |
| STATUS | 0x00 | - |
| CRC8 | - | 帧校验 |

---

#### 4.2.14 SLAVE_CFG_ACK (0x43) 从机通道配置确认

**方向**：设备 → 手机

| 字段 | 值 | 说明 |
|------|-----|------|
| CMD | 0x43 | SLAVE_CFG_ACK |
| CHANNEL | 0-15 | 回显目标从机通道 |
| ID | - | 回显通道关联 LIN ID |
| FLAGS | 0x00 | - |
| LEN | 0x02 | - |
| DATA[0] | - | 实际状态：0x00=禁止，0x01=使能 |
| DATA[1] | - | 当前已使能通道数量 |
| DATA[2-7] | 0x00 | 保留 |
| LIN_CKS | 0x00 | - |
| STATUS | - | 0x00=成功，其他=错误码 |
| CRC8 | - | 帧校验 |

---

#### 4.2.15 SET_PARAM (0x51) 设置设备参数

**方向**：手机 → 设备

| 字段 | 值 | 说明 |
|------|-----|------|
| CMD | 0x51 | SET_PARAM |
| CHANNEL | 0x00 | 参数全局有效；通道参数可填目标通道 |
| ID | - | 参数 ID，见 §4.3 |
| FLAGS | 0x00 | - |
| LEN | 1-8 | 参数值长度 |
| DATA[0..7] | - | 参数值，小端序 |
| LIN_CKS | 0x00 | - |
| STATUS | 0x00 | - |
| CRC8 | - | 帧校验 |

若 `ACK_REQ=1`，设备返回 `ACK (0x05)`。设置失败返回 `ERROR (0x5F)`。

---

#### 4.2.16 GET_PARAM (0x52) 读取设备参数

**方向**：手机 → 设备

| 字段 | 值 | 说明 |
|------|-----|------|
| CMD | 0x52 | GET_PARAM |
| CHANNEL | 0x00 | 参数全局有效；通道参数可填目标通道 |
| ID | - | 参数 ID，见 §4.3 |
| FLAGS | 0x00 | - |
| LEN | 0x00 | - |
| DATA[0..7] | 全 0 | - |
| LIN_CKS | 0x00 | - |
| STATUS | 0x00 | - |
| CRC8 | - | 帧校验 |

设备返回 `PARAM_DATA (0x53)` 或 `ERROR (0x5F)`。

---

#### 4.2.17 PARAM_DATA (0x53) 设备参数应答

**方向**：设备 → 手机

| 字段 | 值 | 说明 |
|------|-----|------|
| CMD | 0x53 | PARAM_DATA |
| CHANNEL | - | 回显请求 CHANNEL |
| ID | - | 参数 ID |
| FLAGS | 0x00 | - |
| LEN | 1-8 | 参数值长度 |
| DATA[0..7] | - | 参数值，小端序 |
| LIN_CKS | 0x00 | - |
| STATUS | - | 0x00=成功，其他=错误码 |
| CRC8 | - | 帧校验 |

---

#### 4.2.18 DIAG_SEND (0x61) 发送或轮询 LIN UDS 诊断帧

**方向**：手机 → 设备

`DIAG_SEND` 是 LIN UDS 透明通道命令。手机端负责组织 UDS 诊断传输层帧；LINHelper 负责在 LIN 总线上发送诊断请求帧或轮询诊断响应帧。

| 字段 | 值 | 说明 |
|------|-----|------|
| CMD | 0x61 | DIAG_SEND |
| CHANNEL | 0x00 | 默认 LIN 通道 |
| ID | 0x3C/0x3D | 0x3C=发送主请求帧，0x3D=轮询从响应帧 |
| FLAGS | - | CHECK_TYPE 建议填 CLASSIC；诊断 ID 固定使用 classic checksum |
| LEN | 0 或 8 | ID=0x3C 时必须为 8；ID=0x3D 轮询时为 0 |
| DATA[0] | - | NAD，ID=0x3C 时有效 |
| DATA[1] | - | PCI，ID=0x3C 时有效 |
| DATA[2-7] | - | SID/参数/填充字节，ID=0x3C 时有效 |
| LIN_CKS | 0x00 | 由设备自动计算 classic checksum |
| STATUS | 0x00 | - |
| CRC8 | - | 帧校验 |

当 `ID=0x3C` 时，设备发送 LIN 诊断主请求帧。若 `ACK_REQ=1`，设备在请求帧发送完成后返回 `ACK (0x05)`；真实 UDS 响应通过 `DIAG_RESP (0x62)` 上报。

当 `ID=0x3D` 时，设备只发送从响应帧头并读取 8 字节诊断响应，然后用 `DIAG_RESP (0x62)` 上报。该模式适合小程序自行控制 P2/P2* 和多帧轮询。

---

#### 4.2.19 DIAG_RESP (0x62) LIN UDS 诊断响应上报

**方向**：设备 → 手机

| 字段 | 值 | 说明 |
|------|-----|------|
| CMD | 0x62 | DIAG_RESP |
| CHANNEL | 0x00 | 默认 LIN 通道 |
| ID | 0x3D | 从响应帧 |
| FLAGS | - | CHECK_TYPE=CLASSIC；发生 LIN 错误时置 LIN_ERR=1 |
| LEN | 8 | 固定 8 字节诊断帧 |
| DATA[0] | - | NAD |
| DATA[1] | - | PCI |
| DATA[2-7] | - | RSID/NRC/参数/填充字节 |
| LIN_CKS | - | 捕获到的 LIN checksum |
| STATUS | - | 0x00=传输成功；非 0 表示 LINHelper/LIN 传输错误 |
| CRC8 | - | 帧校验 |

UDS 负响应 `0x7F` 属于有效诊断响应，`STATUS` 仍填 `0x00`。手机端应从 `DATA[2..]` 解析 NRC，例如 `7F xx 78` 表示 ResponsePending。

---

#### 4.2.20 FW_BEGIN (0x71) 开始托管固件升级

**方向**：手机 → 设备

托管固件升级由 LINHelper 负责把固件数据映射为 LIN UDS 流程。手机端负责发送固件元信息和数据块；LINHelper 负责执行 RequestDownload、TransferData、RequestTransferExit、可选校验和复位。

| 字段 | 值 | 说明 |
|------|-----|------|
| CMD | 0x71 | FW_BEGIN |
| CHANNEL | 0x00 | 默认 LIN 通道 |
| ID | - | 目标 ECU NAD |
| FLAGS | - | ACK_REQ 建议置 1 |
| LEN | 0x08 | 固定 8 |
| DATA[0] | - | 镜像类型：0=应用, 1=Bootloader, 2=参数区, 0x80-0xFF=厂商自定义 |
| DATA[1] | - | 升级选项 bit0=升级后复位, bit1=要求 CRC32 校验, bit2=保留 |
| DATA[2-5] | - | 固件总长度，小端序，单位字节 |
| DATA[6-7] | - | 期望 UDS TransferData 载荷上限，小端序；0 表示设备默认 |
| LIN_CKS | 0x00 | - |
| STATUS | 0x00 | - |
| CRC8 | - | 帧校验 |

成功后设备返回 `FW_STATUS (0x74)`，状态进入 `DOWNLOADING`。如果目标 ECU 需要 SecurityAccess，手机端应先使用 `DIAG_SEND/DIAG_RESP` 完成解锁，或使用厂商扩展参数配置 LINHelper 的安全算法。

---

#### 4.2.21 FW_DATA (0x72) 发送固件升级数据块

**方向**：手机 → 设备

| 字段 | 值 | 说明 |
|------|-----|------|
| CMD | 0x72 | FW_DATA |
| CHANNEL | 0x00 | 默认 LIN 通道 |
| ID | - | 目标 ECU NAD |
| FLAGS | - | ACK_REQ 可选；高吞吐时建议由 FW_STATUS 周期确认 |
| LEN | 1-8 | `1 + payload_len` |
| DATA[0] | - | 块序号，按 UDS TransferData blockSequenceCounter，0x00-0xFF 循环 |
| DATA[1-7] | - | 固件数据，最多 7 字节 |
| LIN_CKS | 0x00 | - |
| STATUS | 0x00 | - |
| CRC8 | - | 帧校验 |

LINHelper 必须按块序号顺序写入。收到重复块序号时，如果数据与上一块一致，应返回成功状态但不重复写入；收到跳号块时返回 `ERR_UPGRADE_SEQ`。

---

#### 4.2.22 FW_END (0x73) 结束升级并触发校验/复位

**方向**：手机 → 设备

| 字段 | 值 | 说明 |
|------|-----|------|
| CMD | 0x73 | FW_END |
| CHANNEL | 0x00 | 默认 LIN 通道 |
| ID | - | 目标 ECU NAD |
| FLAGS | - | ACK_REQ 建议置 1 |
| LEN | 0x08 | 固定 8 |
| DATA[0-3] | - | 固件 CRC32，小端序；未启用 CRC 时填 0 |
| DATA[4] | - | 完成动作：0=只校验, 1=校验后复位, 2=校验后跳转应用 |
| DATA[5-7] | 0x00 | 保留 |
| LIN_CKS | 0x00 | - |
| STATUS | 0x00 | - |
| CRC8 | - | 帧校验 |

设备完成 RequestTransferExit、校验和可选复位后返回 `FW_STATUS (0x74)`。

---

#### 4.2.23 FW_STATUS (0x74) 固件升级状态/进度

**方向**：双向

手机 → 设备时，LEN=0 表示查询当前升级状态，ID 填目标 ECU NAD，其他字段填 0。设备 → 手机时，使用以下状态帧格式：

| 字段 | 值 | 说明 |
|------|-----|------|
| CMD | 0x74 | FW_STATUS |
| CHANNEL | 0x00 | 默认 LIN 通道 |
| ID | - | 目标 ECU NAD |
| FLAGS | 0x00 | - |
| LEN | 0x08 | 固定 8 |
| DATA[0] | - | 阶段：0=IDLE, 1=SESSION, 2=DOWNLOADING, 3=VERIFYING, 4=RESETTING, 5=DONE, 6=FAILED |
| DATA[1] | - | 进度 0-100；未知填 0xFF |
| DATA[2] | - | 最后成功块序号 |
| DATA[3] | - | 最近一次 UDS NRC；无 NRC 填 0 |
| DATA[4-7] | - | 已传输字节数，小端序 |
| LIN_CKS | 0x00 | - |
| STATUS | - | 0x00=正常；非 0 表示升级错误 |
| CRC8 | - | 帧校验 |

---

#### 4.2.24 FW_ABORT (0x75) 中止托管固件升级

**方向**：手机 → 设备

| 字段 | 值 | 说明 |
|------|-----|------|
| CMD | 0x75 | FW_ABORT |
| CHANNEL | 0x00 | 默认 LIN 通道 |
| ID | - | 目标 ECU NAD；未知或全局中止填 0 |
| FLAGS | - | ACK_REQ 可选 |
| LEN | 0x01 | - |
| DATA[0] | - | 中止原因：0=用户取消, 1=超时, 2=校验失败, 3=通信错误 |
| DATA[1-7] | 0x00 | 保留 |
| LIN_CKS | 0x00 | - |
| STATUS | 0x00 | - |
| CRC8 | - | 帧校验 |

设备收到后应停止后续 TransferData，并返回 `FW_STATUS`，其中 `STATUS=ERR_ABORTED`、阶段为 `FAILED` 或 `IDLE`。
---

#### 4.2.25 ERROR (0x5F) 通用错误应答

**方向**：设备 → 手机

当设备无法处理某命令或执行失败时，用此命令响应。

| 字段 | 值 | 说明 |
|------|-----|------|
| CMD | 0x5F | ERROR |
| CHANNEL | - | 回显请求 CHANNEL，无法解析时填 0 |
| ID | - | 触发错误的原命令码 |
| FLAGS | 0x00 | - |
| LEN | 0x02 | - |
| DATA[0] | - | 错误码，详见 §5 |
| DATA[1] | - | 原命令码，和 ID 相同，便于解析 |
| DATA[2-7] | 0x00 | 保留 |
| LIN_CKS | 0x00 | - |
| STATUS | - | 非零错误码 |
| CRC8 | - | 帧校验 |

---

#### 4.2.26 HEARTBEAT (0x7E) 心跳保活

**方向**：双向

定期发送以维持连接活性。若一方连续 3 个心跳间隔未收到对端心跳，则认为通信超时。

| 字段 | 值 | 说明 |
|------|-----|------|
| CMD | 0x7E | HEARTBEAT |
| CHANNEL | 0x00 | - |
| ID | 0x00 | - |
| FLAGS | 0x00 | - |
| LEN | 0x01 | - |
| DATA[0] | - | 递增序列号，0x00-0xFF 循环 |
| DATA[1-7] | 0x00 | - |
| LIN_CKS | 0x00 | - |
| STATUS | 0x00 | - |
| CRC8 | - | 帧校验 |

心跳间隔推荐：**1000 ms**。

### 4.3 参数 ID 定义

| 参数 ID | 名称 | 长度 | 读写 | 说明 |
|---------|------|------|------|------|
| 0x01 | LIN_BAUDRATE | 2 | R/W | LIN 波特率，单位 bps，小端序 |
| 0x02 | HEARTBEAT_INTERVAL | 2 | R/W | 心跳间隔，单位 ms，小端序 |
| 0x03 | LIN_TIMEOUT | 2 | R/W | LIN 响应超时，单位 ms，小端序 |
| 0x04 | DEFAULT_CHECK_TYPE | 1 | R/W | 默认 LIN checksum 类型 |
| 0x05 | SNIFFER_EVENT_MASK | 1 | R/W | 嗅探事件上报掩码 |
| 0x06 | UDS_P2_TIMEOUT | 2 | R/W | UDS P2 超时，单位 ms，小端序 |
| 0x07 | UDS_P2STAR_TIMEOUT | 2 | R/W | UDS P2* 超时，单位 ms，小端序 |
| 0x08 | DIAG_POLL_INTERVAL | 2 | R/W | 诊断响应轮询间隔，单位 ms，小端序 |
| 0x09 | FW_STATUS_INTERVAL | 2 | R/W | 托管升级自动上报间隔，单位 ms；0 表示仅响应查询 |
| 0x0A | FW_RETRY_LIMIT | 1 | R/W | 单个 UDS 服务或数据块最大重试次数 |
| 0x80-0x9F | 厂商自定义 | 1-8 | R/W | 厂商扩展参数 |
| 0xA0-0xFF | 保留 | - | - | 后续版本使用 |

---

## 5. 状态码

STATUS 字节和 ERROR 命令中的 DATA[0] 使用统一的状态码定义：

| 状态码 | 名称 | 说明 |
|--------|------|------|
| 0x00 | SUCCESS | 成功 |
| 0x01 | ERR_UNKNOWN_CMD | 未知命令码 |
| 0x02 | ERR_INVALID_PARAM | 参数无效 |
| 0x03 | ERR_CRC | 协议帧 CRC 校验失败 |
| 0x04 | ERR_MODE | 当前模式不支持该操作 |
| 0x05 | ERR_TIMEOUT | LIN 总线超时，无从机响应 |
| 0x06 | ERR_CHANNEL | 通道号无效或未使能 |
| 0x07 | ERR_LIN_ID | LIN ID 无效或保留 |
| 0x08 | ERR_BUS | LIN 总线错误 |
| 0x09 | ERR_DATA_LEN | 数据长度超出范围 |
| 0x0A | ERR_CHECKSUM | LIN 校验和不匹配 |
| 0x0B | ERR_BUSY | 设备忙，请稍后重试 |
| 0x0C | ERR_PID_PARITY | LIN PID parity 错误 |
| 0x0D | EVT_BREAK | SNIFFER 捕获到 break 事件 |
| 0x0E | ERR_SYNC | LIN sync 字节错误 |
| 0x0F | ERR_UNSUPPORTED | 当前设备不支持该能力或参数 |
| 0x10 | ERR_DIAG_FORMAT | LIN UDS 诊断帧格式错误 |
| 0x11 | ERR_UDS_NRC | 目标 ECU 返回 UDS 负响应 |
| 0x12 | ERR_UPGRADE_STATE | 当前升级状态不允许该操作 |
| 0x13 | ERR_UPGRADE_SEQ | 固件数据块序号错误 |
| 0x14 | ERR_FLASH_WRITE | 目标 ECU 写入失败 |
| 0x15 | ERR_IMAGE_VERIFY | 固件镜像校验失败 |
| 0x16 | ERR_SECURITY_ACCESS | 安全访问失败或未解锁 |
| 0x17 | ERR_ABORTED | 操作已中止 |
| 0x20-0x2F | 厂商自定义 | 各厂商自行定义 |
| 0x30-0xFF | 保留 | 后续版本使用 |

---

## 6. 时序与流程

### 6.1 设备发现流程

```
手机                          LINHelper 设备
  │                               │
  │────── PING (0x01) ──────────→│
  │                               │
  │←───── PONG (0x02) ──────────│   含能力信息
  │                               │
  │────── SET_MODE (0x11) ──────→│   配置模式 + 波特率
  │                               │
  │←───── MODE_ACK (0x12) ──────│   确认模式切换
  │                               │
```

### 6.2 主模式发送

```
手机 (MASTER)                  LINHelper 设备                    LIN 从节点
  │                               │                               │
  │── MASTER_SEND (0x21) ───────→│                               │
  │                               │── LIN Break ────────────────→│
  │                               │── LIN Sync (0x55) ──────────→│
  │                               │── LIN PID ──────────────────→│
  │                               │── LIN Data[0..n-1] ─────────→│
  │                               │── LIN Checksum ─────────────→│
  │                               │                               │
  │←──── ACK (0x05) ────────────│   ACK_REQ=1 时返回             │
  │                               │                               │
```

### 6.3 读取从节点数据

```
手机 (MASTER)                  LINHelper 设备                    LIN 从节点
  │                               │                               │
  │── READ_SLAVE (0x22) ────────→│                               │
  │                               │── LIN Break ────────────────→│
  │                               │── LIN Sync (0x55) ──────────→│
  │                               │── LIN PID ──────────────────→│
  │                               │←── LIN Data[0..n-1] ────────│
  │                               │←── LIN Checksum ────────────│
  │                               │                               │
  │←── SLAVE_DATA (0x23) ──────│   返回从节点数据               │
  │                               │                               │
```

### 6.4 从机模式

```
手机                             LINHelper 设备 (SLAVE)           LIN 主节点
  │                               │                               │
  │── SLAVE_CFG (0x42) ─────────→│   配置通道/使能               │
  │←── SLAVE_CFG_ACK (0x43) ────│                               │
  │                               │                               │
  │── SLAVE_SEND (0x41) ───────→│   设置预备数据                │
  │←── ACK (0x05) ─────────────│   ACK_REQ=1 时返回             │
  │                               │                               │
  │                               │←── LIN Break ────────────────│   主节点发起
  │                               │←── LIN Sync ─────────────────│
  │                               │←── LIN PID ──────────────────│
  │                               │── LIN Data ─────────────────→│   从机应答
  │                               │── LIN Checksum ─────────────→│
  │                               │                               │
  │←── SLAVE_DATA (0x23) ──────│   上报收发结果                 │
```

### 6.5 监听/嗅探模式数据流

```
手机                             LINHelper 设备 (MONITOR/SNIFFER) LIN 总线
  │                               │                               │
  │                               │←── 总线活动 ─────────────────│
  │                               │                               │
  │←── MONITOR_DATA (0x31) ─────│   捕获到一帧或事件             │
  │                               │                               │
  │                               │←── 总线活动 ─────────────────│
  │                               │                               │
  │←── MONITOR_DATA (0x31) ─────│   捕获到又一帧或事件           │
```

---

## 7. LIN UDS 与固件升级

### 7.1 两种使用方式

V1.2.0 支持两种升级集成方式：

| 方式 | 使用命令 | UDS 状态机位置 | 适用场景 |
|------|----------|----------------|----------|
| 透明诊断通道 | DIAG_SEND / DIAG_RESP | 小程序或上位机 | 需要完全控制 UDS 服务、安全算法、多帧和重试策略 |
| 托管固件升级 | FW_BEGIN / FW_DATA / FW_END / FW_STATUS / FW_ABORT | LINHelper 设备 | 小程序只负责传固件，LINHelper 负责执行标准升级流程 |

如果 ECU 的 SecurityAccess 算法由厂商私有实现，推荐先用透明诊断通道完成 `0x27 SecurityAccess`，再进入托管固件升级；或者通过厂商自定义参数提供安全算法配置。

### 7.2 LIN UDS 诊断帧格式

LIN 诊断帧使用 LIN ID `0x3C` 作为主请求帧，`0x3D` 作为从响应帧。两者均使用 classic checksum。

8 字节诊断数据区固定格式如下：

| 字节 | 名称 | 说明 |
|------|------|------|
| 0 | NAD | Node Address，目标或响应 ECU 地址 |
| 1 | PCI | Protocol Control Information |
| 2-7 | Payload | SID/RSID/NRC/参数/填充 |

PCI 规则：

| 类型 | PCI 高 nibble | 说明 |
|------|--------------|------|
| Single Frame | 0x0 | 低 nibble 表示本帧有效 payload 长度，1-6 |
| First Frame | 0x1 | 低 nibble + 下一字节组成 12-bit 总长度，首帧携带 5 字节 payload |
| Consecutive Frame | 0x2 | 低 nibble 为连续帧序号，0-15 循环，每帧携带 6 字节 payload |

UDS 负响应 `7F <SID> <NRC>` 是诊断层有效响应，不等同于 LINHelper 协议错误。只有 LIN 超时、校验、PID、格式或升级状态错误才写入 `STATUS`。

### 7.3 透明 UDS 推荐流程

```
手机/小程序                      LINHelper 设备                    LIN ECU
  │                                  │                              │
  │── DIAG_SEND ID=0x3C ───────────→│                              │  发送 0x10/0x27/0x34 等请求
  │                                  │── LIN 0x3C request ────────→│
  │                                  │                              │
  │── DIAG_SEND ID=0x3D LEN=0 ─────→│                              │  轮询 0x3D 响应
  │                                  │←── LIN 0x3D response ───────│
  │←─ DIAG_RESP (0x62) ────────────│                              │
```

手机端应处理以下 UDS 服务和时序：

| 服务 | SID | 说明 |
|------|-----|------|
| DiagnosticSessionControl | 0x10 | 进入扩展会话或编程会话 |
| ECUReset | 0x11 | 升级完成后复位 |
| SecurityAccess | 0x27 | 解锁下载权限 |
| RoutineControl | 0x31 | 擦除、校验、切换分区等例程 |
| RequestDownload | 0x34 | 请求下载 |
| TransferData | 0x36 | 传输数据块 |
| RequestTransferExit | 0x37 | 结束下载 |
| TesterPresent | 0x3E | 保持诊断会话 |

P2 超时、P2* 超时、`0x78 ResponsePending` 和 NRC 重试策略由手机端负责。LINHelper 只保证诊断帧的发送、轮询和上报。

### 7.4 托管固件升级推荐流程

```
手机/小程序                      LINHelper 设备                    LIN ECU
  │                                  │                              │
  │── SET_MODE MASTER ─────────────→│                              │
  │←─ MODE_ACK ────────────────────│                              │
  │                                  │                              │
  │── 可选 DIAG_SEND 解锁 ─────────→│── UDS 0x10/0x27 ───────────→│
  │←─ DIAG_RESP ───────────────────│←─ UDS 响应 ─────────────────│
  │                                  │                              │
  │── FW_BEGIN ────────────────────→│── UDS 0x34 RequestDownload →│
  │←─ FW_STATUS DOWNLOADING ───────│←─ UDS 0x74 响应 ────────────│
  │                                  │                              │
  │── FW_DATA seq=n ───────────────→│── UDS 0x36 TransferData ───→│
  │←─ FW_STATUS/ACK ───────────────│←─ UDS 0x76 响应 ────────────│
  │                                  │                              │
  │── FW_END ──────────────────────→│── UDS 0x37/0x31/0x11 ─────→│
  │←─ FW_STATUS DONE/FAILED ───────│←─ UDS 响应/复位 ────────────│
```

托管升级的最小可靠性要求：

- `FW_DATA.DATA[0]` 使用 UDS blockSequenceCounter，按 0x00-0xFF 循环。
- 手机端收到 `ERR_BUSY`、LIN 超时或 `0x78 ResponsePending` 时，应等待 `UDS_P2STAR_TIMEOUT` 内的后续 `FW_STATUS`，不要立即重复发送大量数据。
- 手机端可以重复发送最后一个未确认的 `FW_DATA`。LINHelper 必须识别重复块并避免重复写入目标 ECU。
- 设备升级失败时不得主动擦除当前可运行应用，除非目标 ECU bootloader 已保证 A/B 分区或回滚机制。
- `FW_END` 校验失败时必须返回 `ERR_IMAGE_VERIFY`，且不得执行复位跳转。

### 7.5 吞吐和限制

LIN 总线速率较低。以 19200 bps 为例，考虑诊断帧、主节点轮询、响应间隔和 UDS 应答，实际升级吞吐通常只有几百 B/s 到约 1 KB/s。固件包较大时，应在 UI 上显示进度、预计剩余时间和可恢复错误。

V1.2.0 的 LINHelper 帧仍固定为 16 字节，`FW_DATA` 每个协议帧最多携带 7 字节固件数据。如果需要更高吞吐，应在后续版本中定义 BLE 大包分片或 EXT 扩展头。

---
## 8. 附录

### 8.1 常用 LIN 波特率数值对照

| 波特率 | 16位值 | 高字节 | 低字节 |
|--------|--------|--------|--------|
| 20000 | 0x4E20 | 0x4E | 0x20 |
| 19200 | 0x4B00 | 0x4B | 0x00 |
| 14400 | 0x3840 | 0x38 | 0x40 |
| 10400 | 0x28A0 | 0x28 | 0xA0 |
| 9600 | 0x2580 | 0x25 | 0x80 |
| 4800 | 0x12C0 | 0x12 | 0xC0 |
| 2400 | 0x0960 | 0x09 | 0x60 |

### 8.2 CRC-8/ATM 参考实现

**C 语言**：

```c
#include <stdint.h>

uint8_t calc_crc8_atm(const uint8_t* data, uint8_t len) {
    uint8_t crc = 0x00;
    for (uint8_t i = 0; i < len; i++) {
        crc ^= data[i];
        for (uint8_t j = 0; j < 8; j++) {
            if (crc & 0x80) {
                crc = (uint8_t)((crc << 1) ^ 0x07);
            } else {
                crc = (uint8_t)(crc << 1);
            }
        }
    }
    return crc;
}
```

**Python**：

```python
def calc_crc8_atm(data: bytes) -> int:
    crc = 0
    for b in data:
        crc ^= b
        for _ in range(8):
            if crc & 0x80:
                crc = ((crc << 1) ^ 0x07) & 0xFF
            else:
                crc = (crc << 1) & 0xFF
    return crc

assert calc_crc8_atm(b"123456789") == 0xF4
```

### 8.3 LIN 校验和参考实现

```javascript
// 计算 Protected ID
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

function foldLinSum(sum) {
  while (sum > 0xFF) sum = (sum & 0xFF) + (sum >> 8)
  return sum
}

// 经典校验，LIN V1.x 和诊断帧使用
function classicChecksum(data) {
  return (~foldLinSum(data.reduce((a, b) => a + b, 0))) & 0xFF
}

// 增强校验，LIN V2.x 常规帧使用
function enhancedChecksum(linId, data) {
  if (linId === 0x3C || linId === 0x3D) return classicChecksum(data)
  const pid = buildProtectedId(linId)
  return (~foldLinSum(pid + data.reduce((a, b) => a + b, 0))) & 0xFF
}
```

---

*协议版本 V1.2.0*
