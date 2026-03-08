import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

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
})