---
name: hardware-control
description: "Control connected hardware: monitor brightness, LED effects, relays, desk automation, and 3D printers."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "🔌"
    invokeKey: hardware
    requires:
      env:
        - HARDWARE_ENABLED
---

# Hardware Control

## When to Use

Use for:
- Adjusting monitor brightness or switching input sources
- Setting LED strip colors and effects
- Triggering relay-controlled devices (lights, fans, power strips)
- Checking 3D print job status
- Querying sensor readings (temperature, humidity)

Do NOT use for:
- Operations when `HARDWARE_ENABLED=false`
- Safety-critical equipment without hardware-level interlocks

## Supported Hardware

| Device Type | Driver | Capability |
|-------------|--------|------------|
| Monitor | DDC/CI (ddcci) | Brightness, input source, power |
| LED Strip | Serial (Arduino) | Color, effects (pulse, breathe, rainbow) |
| Relay | Serial (Arduino) | On/off, schedule |
| 3D Printer | OctoPrint API | Start, cancel, status |
| Sensors | Serial (Arduino) | Temperature, humidity, light readings |

## Example Invocations

- "Set my monitor brightness to 40%."
- "Turn the desk LEDs to blue."
- "Turn off the office lights." (relay)
- "What's the status of the 3D print?"
- "What's the current temperature on the desk sensor?"
- "Set the LEDs to pulse red — I need focus mode."

## What It Does

1. Routes the command to the appropriate hardware driver
2. Executes the command via serial, DDC, or OctoPrint API
3. Returns confirmation with current device state
4. Logs hardware events to the sensor history (ring buffer)
5. Triggers automation rules if sensor thresholds are crossed
