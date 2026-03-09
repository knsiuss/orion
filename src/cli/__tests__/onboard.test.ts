/**
 * @file onboard.test.ts
 * @description Unit/integration tests for cli\.__tests__\.onboard.test.ts.
 */
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { __onboardTestUtils } from "../onboard.js"

describe("onboard cli helpers", () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
  })

  it("parses quickstart args with channel/provider/write mode", () => {
    const parsed = __onboardTestUtils.parseOnboardArgs([
      "--channel=telegram",
      "--provider",
      "groq",
      "--whatsapp-mode=scan",
      "--print-only",
      "--non-interactive",
      "--wizard",
    ])

    expect(parsed).toMatchObject({
      flow: "quickstart",
      channel: "telegram",
      provider: "groq",
      whatsappMode: "scan",
      writeMode: "print",
      yes: true,
    })
  })

  it("merges env content while preserving comments and appending missing keys", () => {
    const merged = __onboardTestUtils.mergeEnvContent(
      [
        "# comment",
        "GROQ_API_KEY=",
        "TELEGRAM_BOT_TOKEN=old",
        "",
      ].join("\n"),
      {
        GROQ_API_KEY: "gsk_test_123",
        TELEGRAM_CHAT_ID: "123456",
      },
    )

    expect(merged).toContain("# comment")
    expect(merged).toContain("GROQ_API_KEY=gsk_test_123")
    expect(merged).toContain("TELEGRAM_BOT_TOKEN=old")
    expect(merged).toContain("TELEGRAM_CHAT_ID=123456")
    expect(merged).toContain("# Added by `pnpm onboard` quickstart wizard")
  })

  it("builds provider-specific next steps for Telegram", () => {
    const steps = __onboardTestUtils.buildNextSteps({
      channel: "telegram",
      provider: "groq",
      updates: { TELEGRAM_BOT_TOKEN: "abc" },
      computerUseEnabled: true,
    })

    expect(steps.join("\n")).toContain("/start")
    expect(steps.join("\n")).toContain("docs/channels/telegram.md")
    expect(steps.join("\n")).toContain("docs/platform/onboarding.md")
  })

  it("builds WhatsApp Cloud API next steps and docs reference", () => {
    const steps = __onboardTestUtils.buildNextSteps({
      channel: "whatsapp",
      provider: "openrouter",
      updates: {
        WHATSAPP_ENABLED: "true",
        WHATSAPP_MODE: "cloud",
        WHATSAPP_CLOUD_VERIFY_TOKEN: "verify",
      },
      computerUseEnabled: true,
    })

    expect(steps.join("\n")).toContain("/webhooks/whatsapp")
    expect(steps.join("\n")).toContain("WHATSAPP_CLOUD_VERIFY_TOKEN")
    expect(steps.join("\n")).toContain("docs/channels/whatsapp.md")
  })

  it("builds WhatsApp QR scan next steps (OpenClaw-style quick test)", () => {
    const steps = __onboardTestUtils.buildNextSteps({
      channel: "whatsapp",
      provider: "groq",
      updates: {
        WHATSAPP_ENABLED: "true",
        WHATSAPP_MODE: "baileys",
      },
      computerUseEnabled: true,
    })

    const text = steps.join("\n")
    expect(text).toContain("QR code")
    expect(text).toContain("Linked Devices")
    expect(text).toContain("WHATSAPP_MODE=baileys")
  })

  it("uses global `edith` command hints when wrapper env is present", () => {
    const commands = __onboardTestUtils.defaultNextStepCommands({
      EDITH_ENV_FILE: "C:\\Users\\test\\.edith\\profiles\\default\\.env",
    } as any)

    const steps = __onboardTestUtils.buildNextSteps(
      {
        channel: "whatsapp",
        provider: "groq",
        updates: {
          WHATSAPP_ENABLED: "true",
          WHATSAPP_MODE: "baileys",
        },
        computerUseEnabled: true,
      },
      commands,
    )

    const text = steps.join("\n")
    expect(text).toContain("`edith doctor`")
    expect(text).toContain("`edith all`")
    expect(text).not.toContain("`pnpm all`")
  })

  it("writes the default computerUse config into edith.json", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "edith-onboard-"))
    tempDirs.push(tempDir)

    const configPath = await __onboardTestUtils.writeComputerUseConfig(tempDir, true)
    const parsed = JSON.parse(await fs.readFile(configPath, "utf-8")) as { computerUse: { planner: string; enabled: boolean } }

    expect(parsed.computerUse.planner).toBe("lats")
    expect(parsed.computerUse.enabled).toBe(true)
  })

  it("preserves existing computerUse keys while toggling enabled state", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "edith-onboard-"))
    tempDirs.push(tempDir)
    await fs.writeFile(path.join(tempDir, "edith.json"), JSON.stringify({
      computerUse: {
        planner: "dag",
        maxEpisodes: 12,
      },
    }, null, 2))

    const configPath = await __onboardTestUtils.writeComputerUseConfig(tempDir, false)
    const parsed = JSON.parse(await fs.readFile(configPath, "utf-8")) as { computerUse: { planner: string; maxEpisodes: number; enabled: boolean } }

    expect(parsed.computerUse.planner).toBe("dag")
    expect(parsed.computerUse.maxEpisodes).toBe(12)
    expect(parsed.computerUse.enabled).toBe(false)
  })
})
