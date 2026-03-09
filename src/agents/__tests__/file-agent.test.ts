/**
 * @file file-agent.test.ts
 * @description Unit/integration tests for agents\.__tests__\.file-agent.test.ts.
 */
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { camelGuard } from "../../security/camel-guard.js"
import { FileAgent, __fileAgentTestUtils } from "../tools/file-agent.js"

describe("FileAgent", () => {
  let tempDir: string
  let agent: FileAgent

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "edith-file-agent-"))
    agent = new FileAgent({ allowedRoots: [tempDir] })
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it("reads file content inside an allowed root", async () => {
    const filePath = path.join(tempDir, "notes.txt")
    await fs.writeFile(filePath, "hello from EDITH", "utf-8")

    const result = await agent.execute({ action: "read", path: filePath })
    const parsed = JSON.parse(result) as { content: string }

    expect(parsed.content).toContain("hello from EDITH")
  })

  it("creates a backup before overwriting a file", async () => {
    const filePath = path.join(tempDir, "notes.txt")
    await fs.writeFile(filePath, "old content", "utf-8")

    const result = await agent.execute({ action: "write", path: filePath, content: "new content" })
    const parsed = JSON.parse(result) as { backupPath: string | null }

    expect(parsed.backupPath).toBe(`${filePath}.bak`)
    await expect(fs.readFile(`${filePath}.bak`, "utf-8")).resolves.toBe("old content")
  })

  it("requires a capability token for delete", async () => {
    const filePath = path.join(tempDir, "danger.txt")
    await fs.writeFile(filePath, "keep me", "utf-8")

    await expect(agent.execute({ action: "delete", path: filePath })).rejects.toThrow(
      "Capability token required for delete",
    )
  })

  it("blocks sensitive file names even inside allowed roots", async () => {
    const sensitivePath = path.join(tempDir, ".env")

    await expect(
      __fileAgentTestUtils.ensurePathAllowed(sensitivePath, [tempDir]),
    ).rejects.toThrow("Sensitive file access blocked")
  })

  it("allows delete with a valid capability token", async () => {
    const filePath = path.join(tempDir, "danger.txt")
    await fs.writeFile(filePath, "remove me", "utf-8")
    const capabilityToken = camelGuard.issueCapabilityToken({
      actorId: "file-agent",
      toolName: "fileAgent",
      action: "delete",
      taintedSources: ["web_content"],
    })

    const result = await agent.execute({
      action: "delete",
      path: filePath,
      capabilityToken,
      taintedSources: ["web_content"],
    })

    expect(JSON.parse(result)).toMatchObject({ deleted: true })
    await expect(fs.stat(filePath)).rejects.toThrow()
  })

  it("rejects delete when the capability token scope is invalid", async () => {
    const filePath = path.join(tempDir, "danger.txt")
    await fs.writeFile(filePath, "remove me", "utf-8")
    const capabilityToken = camelGuard.issueCapabilityToken({
      actorId: "file-agent",
      toolName: "fileAgent",
      action: "move",
      taintedSources: ["web_content"],
    })

    await expect(agent.execute({
      action: "delete",
      path: filePath,
      capabilityToken,
      taintedSources: ["web_content"],
    })).rejects.toThrow("Capability token scope mismatch")
  })

  it("blocks tainted write without a capability token", async () => {
    const filePath = path.join(tempDir, "generated.txt")

    await expect(agent.execute({
      action: "write",
      path: filePath,
      content: "unsafe",
      taintedSources: ["web_content"],
    })).rejects.toThrow("CaMeL guard blocked tainted fileAgent.write")
  })
})