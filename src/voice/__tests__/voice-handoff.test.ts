/**
 * @file voice-handoff.test.ts
 * @description Unit tests for VoiceHandoff — handoff initiation, capability
 * checking, and event dispatch.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

// ── Mocks ─────────────────────────────────────────────────────────────────────
const { getMock, dispatchMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  dispatchMock: vi.fn(),
}))

vi.mock("../../pairing/device-registry.js", () => ({
  pairedDeviceRegistry: { get: getMock },
}))

vi.mock("../../core/event-bus.js", () => ({
  eventBus: { dispatch: dispatchMock },
}))

import { VoiceHandoff } from "../voice-handoff.js"
import type { DeviceRegistration } from "../../pairing/device-registry.js"

function makeDevice(overrides: Partial<DeviceRegistration> = {}): DeviceRegistration {
  return {
    deviceId: "device-1",
    userId: "user-1",
    name: "Test Device",
    os: "ios",
    type: "phone",
    gatewayId: "gw-1",
    capabilities: ["voice", "push"],
    lastSeen: Date.now(),
    paired: Date.now(),
    authToken: "tok",
    ...overrides,
  }
}

describe("VoiceHandoff", () => {
  let handoff: VoiceHandoff

  beforeEach(() => {
    handoff = new VoiceHandoff()
    vi.clearAllMocks()
  })

  // ── acceptHandoff() ──────────────────────────────────────────────────────
  describe("acceptHandoff()", () => {
    it("returns true when device has voice capability", async () => {
      getMock.mockReturnValue(makeDevice({ capabilities: ["voice"] }))
      expect(await handoff.acceptHandoff("device-1")).toBe(true)
    })

    it("returns true when device has microphone capability", async () => {
      getMock.mockReturnValue(makeDevice({ capabilities: ["microphone"] }))
      expect(await handoff.acceptHandoff("device-1")).toBe(true)
    })

    it("returns false when device lacks voice capability", async () => {
      getMock.mockReturnValue(makeDevice({ capabilities: ["push"] }))
      expect(await handoff.acceptHandoff("device-1")).toBe(false)
    })

    it("returns false when device is not registered", async () => {
      getMock.mockReturnValue(undefined)
      expect(await handoff.acceptHandoff("unknown-device")).toBe(false)
    })
  })

  // ── initiateHandoff() ────────────────────────────────────────────────────
  describe("initiateHandoff()", () => {
    it("dispatches handoff.initiated event when target accepts", async () => {
      getMock.mockReturnValue(makeDevice({ capabilities: ["voice"] }))

      await handoff.initiateHandoff("device-from", "device-1")

      expect(dispatchMock).toHaveBeenCalledWith(
        "voice.handoff.initiated",
        expect.objectContaining({
          fromDeviceId: "device-from",
          toDeviceId: "device-1",
        })
      )
    })

    it("does not dispatch event when target lacks voice capability", async () => {
      getMock.mockReturnValue(makeDevice({ capabilities: [] }))

      await handoff.initiateHandoff("device-from", "device-1")

      expect(dispatchMock).not.toHaveBeenCalled()
    })

    it("does not dispatch event when target device is unknown", async () => {
      getMock.mockReturnValue(undefined)

      await handoff.initiateHandoff("device-from", "unknown")

      expect(dispatchMock).not.toHaveBeenCalled()
    })
  })

  // ── completeHandoff() ────────────────────────────────────────────────────
  describe("completeHandoff()", () => {
    it("dispatches handoff.completed event", () => {
      handoff.completeHandoff("device-from", "device-to")

      expect(dispatchMock).toHaveBeenCalledWith(
        "voice.handoff.completed",
        expect.objectContaining({
          fromDeviceId: "device-from",
          toDeviceId: "device-to",
        })
      )
    })
  })
})
