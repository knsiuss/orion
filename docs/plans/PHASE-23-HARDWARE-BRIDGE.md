# Phase 23 — Hardware & Physical World Bridge

> "Tony bangun suit dari besi dan kabel di gua. EDITH juga harus bisa sentuh dunia fisik."

**Prioritas:** 🟢 MEDIUM — Niche tapi powerful: maker community + smart desk setup
**Depends on:** Phase 4 (IoT smart home), Phase 7 (computer use), Phase 20 (HUD for dashboard)
**Status:** ❌ Not started

---

## 1. Tujuan

Expand Phase 4 IoT ke **direct hardware communication**: Arduino, Raspberry Pi, ESP32,
USB devices, monitor control, LED strips, 3D printers. EDITH bukan hanya software
companion — EDITH bisa kontrol **dunia fisik** di sekitar user.

Bedanya dengan Phase 4:
- Phase 4 = smart home APIs (Philips Hue, Tuya, Home Assistant)
- Phase 23 = **serial communication, GPIO, BLE, USB, DDC/CI** — direct hardware

```mermaid
flowchart TD
    User["🗣️ 'EDITH, nyalain lampu meja,\nset monitor ke mode presentasi'"]
    
    subgraph EDITH["🧠 EDITH Hardware Bridge"]
        Parser["Intent Parser\n(NL → hardware command)"]
        Registry["Device Registry\n(discovered devices)"]
        Protocol["Protocol Handlers\n(serial, MQTT, BLE, GPIO)"]
    end

    subgraph Physical["🔧 Physical World"]
        Arduino["🔌 Arduino/ESP32\n(serial / WiFi)"]
        RPi["🍓 Raspberry Pi\n(GPIO / I2C)"]
        Monitor["🖥️ Monitor\n(DDC/CI brightness/input)"]
        LED["💡 LED Strip\n(WS2812B / SK6812)"]
        Printer3D["🖨️ 3D Printer\n(OctoPrint / Bambu)"]
        USB["🔗 USB Relay\n(power control)"]
        Sensors["🌡️ Sensors\n(temp, humidity, motion)"]
    end

    User --> Parser --> Registry --> Protocol
    Protocol --> Arduino & RPi & Monitor & LED & Printer3D & USB & Sensors
```

---

## 2. Research References

| # | Paper / Project | ID | Kontribusi ke EDITH |
|---|-----------------|-----|---------------------|
| 1 | Firmata Protocol (open standard) | firmata.org | Standard protocol for Arduino communication — stable, well-tested |
| 2 | Web Bluetooth API (W3C) | w3.org/community/web-bluetooth | BLE device discovery and control from browser/Electron |
| 3 | Serialport (Node.js) | github.com/serialport/node-serialport | Cross-platform serial communication library |
| 4 | MQTT.js | github.com/mqttjs/MQTT.js | MQTT client for Node.js — lightweight IoT messaging protocol |
| 5 | DDC/CI Protocol (VESA standard) | VESA MCCS 3.0 | Monitor control: brightness, contrast, input source via I2C |
| 6 | OctoPrint REST API | docs.octoprint.org/en/master/api | 3D printer control: upload, start, monitor, cancel prints |
| 7 | Matter Protocol (CSA) | buildwithmatter.com | Unified IoT standard — bridge Phase 4 and Phase 23 devices |
| 8 | Home Assistant + ESPHome | esphome.io | ESP32 firmware generator — EDITH bisa flash custom firmware |
| 9 | NaturalLanguage → Arduino (MIT Media Lab) | doi:10.1145/3491102.3517620 | NL intent → hardware action mapping — basis parser design |

---

## 3. Arsitektur

### 3.1 Kontrak Arsitektur

```
Rule 1: ALL hardware actions gated behind permissions.
        User must explicitly enable each device category.
        Default = all hardware OFF.

Rule 2: Device registry as single source of truth.
        Every connected device registered with capabilities.
        No command sent to unknown device.

Rule 3: Hardware errors are SOFT failures.
        Device offline → log warning, continue.
        NEVER crash EDITH because a USB device disconnected.
        Retry with backoff: 3s, 10s, 30s.

Rule 4: Physical safety first.
        Relay/motor commands have confirmation for first use.
        "EDITH, nyalain relay" → "Confirm: power on relay at COM3?"
        After first confirmation, same device auto-confirmed (opt-in).
```

### 3.2 System Architecture

```mermaid
flowchart TD
    subgraph Gateway["🌐 EDITH Gateway"]
        Pipeline["Message Pipeline"]
        HardwareTool["Hardware Tool\n(registered as tool)"]
    end

    subgraph Bridge["🔧 Hardware Bridge Service"]
        DeviceRegistry["Device Registry\n{id, type, protocol, capabilities, status}"]
        ProtocolRouter["Protocol Router"]
        
        subgraph Protocols["Protocol Handlers"]
            Serial["Serial (Firmata)\nArduino, ESP32"]
            MQTT["MQTT Client\nESPHome, custom"]
            BLE["BLE (Web Bluetooth)\nwearables, sensors"]
            DDC["DDC/CI\nmonitor control"]
            HTTP["HTTP REST\nOctoPrint, Bambu"]
            GPIO["GPIO (pigpio)\nRaspberry Pi direct"]
        end
    end

    subgraph Devices["🔌 Physical Devices"]
        D1["Arduino Uno\nCOM3"]
        D2["ESP32\nmqtt://iot.local"]
        D3["Dell Monitor\nDDC bus 0"]
        D4["LED Strip\nGPIO 18"]
        D5["Ender 3\noctoprint.local"]
        D6["Temperature\nBLE sensor"]
    end

    Pipeline --> HardwareTool --> DeviceRegistry --> ProtocolRouter
    ProtocolRouter --> Protocols
    Serial --> D1
    MQTT --> D2
    DDC --> D3
    GPIO --> D4
    HTTP --> D5
    BLE --> D6
```

### 3.3 Cross-Device Hardware Control

```mermaid
flowchart LR
    subgraph Phone["📱 Phone"]
        VoiceCmd["Voice: 'EDITH,\nnyalain lampu meja'"]
    end

    subgraph Gateway["🌐 EDITH Gateway\n(running on laptop)"]
        Pipeline["Message Pipeline"]
        HW["Hardware Bridge"]
    end

    subgraph Desk["🖥️ Desk Hardware"]
        LED["💡 Desk LED"]
        Monitor["🖥️ Monitor"]
    end

    VoiceCmd -->|"ws:// (different network → tunnel/VPN)"| Pipeline
    Pipeline --> HW --> LED & Monitor

    Note["User bisa kontrol hardware di meja\ndari HP di mana saja.\nGateway = bridge antara phone dan hardware."]
```

---

## 4. Sub-Phase Breakdown

```mermaid
flowchart LR
    A["23A\nDevice Discovery\n& Registry"]
    B["23B\nSerial Protocol\n(Arduino/ESP32)"]
    C["23C\nDesk Environment\n(Monitor, LED, USB)"]
    D["23D\nSensor Dashboard\n(temp, humidity, motion)"]
    E["23E\n3D Print Manager\n(OctoPrint/Bambu)"]
    F["23F\nArduino Code Gen\n(NL → sketch)"]

    A --> B --> C --> D
    A --> E
    A --> F
```

---

### Phase 23A — Device Discovery & Registry

**Goal:** Auto-detect connected hardware, maintain device registry.

```mermaid
sequenceDiagram
    participant EDITH
    participant Scanner as Device Scanner
    participant USB as USB Ports
    participant MQTT as MQTT Broker
    participant BLE as BLE Radio

    EDITH->>Scanner: scan_all_protocols()
    
    par Parallel Discovery
        Scanner->>USB: List serial ports (COM*)
        USB-->>Scanner: COM3: Arduino Uno, COM5: ESP32
        
        Scanner->>MQTT: Subscribe discovery topic
        MQTT-->>Scanner: 2 ESPHome devices found
        
        Scanner->>BLE: Scan nearby BLE
        BLE-->>Scanner: 1 temperature sensor
    end
    
    Scanner->>Scanner: Build device registry
    Scanner-->>EDITH: 5 devices found:\n- Arduino Uno (COM3)\n- ESP32 (COM5)\n- ESPHome-Light (mqtt)\n- ESPHome-Fan (mqtt)\n- BLE Temp Sensor
    
    EDITH-->>User: "Sir, gue detected 5 hardware devices.\nMau gue list capabilities-nya?"
```

```typescript
interface HardwareDevice {
  id: string;                    // unique device ID
  name: string;                  // user-friendly name
  type: 'arduino' | 'esp32' | 'rpi' | 'monitor' | 'led' | 'printer' | 'sensor' | 'relay';
  protocol: 'serial' | 'mqtt' | 'ble' | 'ddc' | 'http' | 'gpio';
  address: string;               // COM3, mqtt://..., BLE UUID, etc.
  capabilities: string[];        // ['digital_write', 'analog_read', 'pwm']
  status: 'online' | 'offline' | 'error';
  lastSeen: number;
  firmwareVersion?: string;
  metadata?: Record<string, unknown>;
}
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/os-agent/hardware/device-registry.ts` | CREATE | ~120 |
| `EDITH-ts/src/os-agent/hardware/device-scanner.ts` | CREATE | ~100 |
| `EDITH-ts/src/os-agent/hardware/types.ts` | CREATE | ~50 |

---

### Phase 23B — Serial Protocol (Arduino/ESP32)

**Goal:** Communicate dengan Arduino/ESP32 via serial (Firmata protocol).

```mermaid
sequenceDiagram
    participant User
    participant EDITH
    participant Bridge as Hardware Bridge
    participant Arduino as Arduino (COM3)

    User->>EDITH: "Set LED pin 13 ke HIGH"
    EDITH->>Bridge: hardware_command({device: "arduino-1", action: "digital_write", pin: 13, value: 1})
    Bridge->>Arduino: Firmata: SET_PIN_MODE(13, OUTPUT)\nFirmata: DIGITAL_WRITE(13, HIGH)
    Arduino-->>Bridge: ACK
    Bridge-->>EDITH: success: pin 13 = HIGH
    EDITH-->>User: "Done, LED di pin 13 nyala."
```

```typescript
// DECISION: Use Firmata protocol, not raw AT commands
// WHY: Firmata is standardized, battle-tested, supports all Arduino boards
// ALTERNATIVES: Raw serial (fragile), johnny-five (too much abstraction)
// REVISIT: If custom protocol needed for performance-critical MCU

import { Board, Led, Sensor } from 'firmata.js';

class ArduinoDriver {
  private board: Board;
  
  async connect(port: string): Promise<void> {
    this.board = new Board(port);
    return new Promise((resolve) => this.board.on('ready', resolve));
  }
  
  async digitalWrite(pin: number, value: 0 | 1): Promise<void> {
    this.board.pinMode(pin, this.board.MODES.OUTPUT);
    this.board.digitalWrite(pin, value);
  }
  
  async analogRead(pin: number): Promise<number> {
    this.board.pinMode(pin, this.board.MODES.ANALOG);
    return new Promise((resolve) => {
      this.board.analogRead(pin, (value) => resolve(value));
    });
  }
}
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/os-agent/hardware/drivers/serial-driver.ts` | CREATE | ~120 |
| `EDITH-ts/src/os-agent/hardware/drivers/firmata-adapter.ts` | CREATE | ~80 |

---

### Phase 23C — Desk Environment Control

**Goal:** Control monitor (brightness, input), LED strip, USB relay.

```mermaid
flowchart TD
    subgraph Monitor["🖥️ Monitor Control (DDC/CI)"]
        Bright["setBrightness(70)"]
        Input["setInput('HDMI-1')"]
        Contrast["setContrast(50)"]
        Power["setPower('standby')"]
    end

    subgraph LED["💡 LED Strip (WS2812B)"]
        Color["setColor('#0066FF')"]
        Effect["setEffect('breathing')"]
        Status["syncWithEDITHStatus()"]
    end

    subgraph USB["🔗 USB Relay"]
        On["relay(1, ON)"]
        Off["relay(1, OFF)"]
        Schedule["schedule(relay=1, on='09:00', off='18:00')"]
    end

    EDITH["🧠 EDITH"] --> Monitor & LED & USB
```

**LED Strip ↔ EDITH Status Sync:**
```
EDITH idle       → soft blue breathing
EDITH listening  → bright blue solid
EDITH thinking   → amber chase effect
EDITH speaking   → green pulse
EDITH error      → red flash
Mission running  → purple rotation
```

```typescript
// DECISION: LED status sync is an opt-in novelty feature
// WHY: Cool "arc reactor" vibes, but not essential
// ALTERNATIVES: No LED integration (boring)
// REVISIT: If users actually want this (track adoption)

interface DeskConfig {
  monitor?: {
    enabled: boolean;
    ddcBus: number;           // 0 for auto-detect
    presets: Record<string, { brightness: number; input: string }>;
  };
  led?: {
    enabled: boolean;
    type: 'ws2812b' | 'sk6812' | 'addressable_rgb';
    pin: number;              // GPIO pin (RPi) or serial address
    count: number;            // number of LEDs
    syncWithStatus: boolean;
  };
  relay?: {
    enabled: boolean;
    ports: { name: string; address: string }[];
  };
}
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/os-agent/hardware/drivers/ddc-driver.ts` | CREATE | ~100 |
| `EDITH-ts/src/os-agent/hardware/drivers/led-driver.ts` | CREATE | ~80 |
| `EDITH-ts/src/os-agent/hardware/drivers/relay-driver.ts` | CREATE | ~60 |
| `EDITH-ts/src/os-agent/hardware/desk-controller.ts` | CREATE | ~100 |

---

### Phase 23D — Sensor Dashboard

**Goal:** Read sensor data, display in HUD, trigger automations.

```mermaid
flowchart TD
    Sensors["🌡️ Sensors\n(BLE / Serial / MQTT)"]
    
    subgraph Processing["Data Processing"]
        Buffer["Ring Buffer\n(last 100 readings)"]
        Avg["Moving Average\n(smooth noise)"]
        Threshold["Threshold Detector\n(high temp, motion, etc.)"]
    end

    subgraph Output["📊 Output"]
        HUD["HUD Card\n(Phase 20)"]
        Proactive["Proactive Trigger\n(Phase 6)"]
        Memory["Memory Log\n(Phase 13)"]
    end

    Sensors --> Buffer --> Avg --> Threshold
    Threshold --> HUD & Proactive & Memory
```

**Automation Examples:**
```
IF temperature > 30°C AND relay_fan.status == OFF:
  → "Suhu kamar 32°C. Mau gue nyalain kipas via relay?"

IF motion_detected AND time > 22:00 AND user.status == away:
  → "Motion detected di ruang kerja jam 10 malam. Lu udah pulang kan?"

IF humidity < 30%:
  → "Kelembaban rendah (28%). Pertimbangkan humidifier."
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/os-agent/hardware/sensor-reader.ts` | CREATE | ~100 |
| `EDITH-ts/src/os-agent/hardware/sensor-automation.ts` | CREATE | ~80 |

---

### Phase 23E — 3D Print Manager

**Goal:** Monitor dan kontrol 3D printer via OctoPrint / Bambu Lab API.

```mermaid
sequenceDiagram
    participant User
    participant EDITH
    participant Octo as OctoPrint API

    User->>EDITH: "Print file benchy.gcode, PLA hitam, infill 20%"
    EDITH->>Octo: POST /api/files/local (upload gcode)
    Octo-->>EDITH: file uploaded
    EDITH->>Octo: POST /api/job (start print)
    Octo-->>EDITH: printing started

    loop Every 30s
        EDITH->>Octo: GET /api/job
        Octo-->>EDITH: {progress: 45%, timeLeft: 2h15m, temps: {bed: 60, nozzle: 200}}
    end

    alt Print fails
        Octo-->>EDITH: error: "thermal runaway"
        EDITH-->>User: "⚠️ Print gagal di layer 127: thermal runaway. Printer paused."
    else Print completes
        Octo-->>EDITH: {progress: 100%}
        EDITH-->>User: "🎉 Print selesai! Benchy siap diambil."
    end
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/os-agent/hardware/drivers/octoprint-driver.ts` | CREATE | ~100 |
| `EDITH-ts/src/os-agent/hardware/print-manager.ts` | CREATE | ~80 |

---

### Phase 23F — Arduino Code Generator

**Goal:** EDITH bisa generate Arduino sketch dari natural language.

```mermaid
sequenceDiagram
    participant User
    participant EDITH
    participant LLM
    participant Arduino as Arduino IDE

    User->>EDITH: "Bikin sketch Arduino yang baca sensor suhu DHT22\ndi pin 4 dan kirim via serial setiap 5 detik"
    EDITH->>LLM: generate_arduino_sketch(description, board: "uno", libs: ["DHT"])
    LLM-->>EDITH: ```cpp\n#include <DHT.h>\n...\n```
    EDITH-->>User: "Ini sketch-nya:\n[code]\nMau gue verify dulu?"
    
    User->>EDITH: "Verify"
    EDITH->>Arduino: arduino-cli compile --fqbn arduino:avr:uno sketch.ino
    Arduino-->>EDITH: compilation successful
    EDITH-->>User: "Compiled clean. Mau upload ke Arduino di COM3?"
    
    User->>EDITH: "Upload"
    EDITH->>Arduino: arduino-cli upload --port COM3 --fqbn arduino:avr:uno
    Arduino-->>EDITH: upload complete
    EDITH-->>User: "Uploaded! Sensor suhu sekarang broadcasting via serial."
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/os-agent/hardware/arduino-codegen.ts` | CREATE | ~80 |

---

## 5. Acceptance Gates

```
□ Device discovery detects Arduino, ESP32, BLE sensor automatically
□ Serial communication works: digital write, analog read, PWM
□ Monitor brightness/input changeable via voice command
□ LED strip syncs with EDITH status (idle=blue, thinking=amber)
□ Sensor data displayed in HUD card (Phase 20)
□ Temperature threshold triggers proactive suggestion (Phase 6)
□ 3D print job start, monitor, complete/fail notification
□ Arduino sketch generated from NL description + compiled + uploaded
□ All hardware features default OFF, require explicit enable
□ Device offline → graceful degradation, no EDITH crash
□ Remote hardware control from phone via gateway
```

---

## 6. Koneksi ke Phase Lain

| Phase | Koneksi | Data Flow |
|-------|---------|-----------|
| Phase 4 (IoT) | Share device registry + Matter bridge | hardware_device → matter_bridge |
| Phase 6 (Proactive) | Sensor thresholds trigger proactive | sensor_data → proactive_trigger |
| Phase 7 (Computer Use) | Hardware tools registered as computer tools | tool_call → hardware_bridge |
| Phase 20 (HUD) | Sensor dashboard card, LED status sync | sensor → hud_card, status → led |
| Phase 22 (Mission) | Missions can include hardware tasks | mission_task → hardware_command |
| Phase 25 (Simulation) | Simulate hardware command before execute | command → sandbox_simulate |
| Phase 27 (Cross-Device) | Control desk hardware from phone | phone → gateway → hardware |

---

## 7. File Changes Summary

| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/os-agent/hardware/device-registry.ts` | CREATE | ~120 |
| `EDITH-ts/src/os-agent/hardware/device-scanner.ts` | CREATE | ~100 |
| `EDITH-ts/src/os-agent/hardware/types.ts` | CREATE | ~50 |
| `EDITH-ts/src/os-agent/hardware/drivers/serial-driver.ts` | CREATE | ~120 |
| `EDITH-ts/src/os-agent/hardware/drivers/firmata-adapter.ts` | CREATE | ~80 |
| `EDITH-ts/src/os-agent/hardware/drivers/ddc-driver.ts` | CREATE | ~100 |
| `EDITH-ts/src/os-agent/hardware/drivers/led-driver.ts` | CREATE | ~80 |
| `EDITH-ts/src/os-agent/hardware/drivers/relay-driver.ts` | CREATE | ~60 |
| `EDITH-ts/src/os-agent/hardware/drivers/octoprint-driver.ts` | CREATE | ~100 |
| `EDITH-ts/src/os-agent/hardware/desk-controller.ts` | CREATE | ~100 |
| `EDITH-ts/src/os-agent/hardware/sensor-reader.ts` | CREATE | ~100 |
| `EDITH-ts/src/os-agent/hardware/sensor-automation.ts` | CREATE | ~80 |
| `EDITH-ts/src/os-agent/hardware/print-manager.ts` | CREATE | ~80 |
| `EDITH-ts/src/os-agent/hardware/arduino-codegen.ts` | CREATE | ~80 |
| **Total** | | **~1250** |

**New dependencies:** `serialport`, `firmata.js`, `mqtt`, `web-bluetooth` (Electron), `arduino-cli` (external)
