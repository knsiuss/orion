import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
} from "../bootstrap.js"
import { ensureWorkbenchReady } from "../workbench.js"

describe("ensureWorkbenchReady", () => {
  let tempDir: string
  let templateDir: string
  let targetDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "edith-workbench-"))
    templateDir = path.join(tempDir, "workspace-template")
    targetDir = path.join(tempDir, "workbenches", "testing")

    await fs.mkdir(path.join(templateDir, "skills", "stark-jarvis"), { recursive: true })
    await fs.mkdir(path.join(templateDir, "memory"), { recursive: true })
    await fs.writeFile(path.join(templateDir, DEFAULT_AGENTS_FILENAME), "# Agents\n", "utf-8")
    await fs.writeFile(path.join(templateDir, DEFAULT_HEARTBEAT_FILENAME), "# Heartbeat\n", "utf-8")
    await fs.writeFile(path.join(templateDir, "skills", "stark-jarvis", "SKILL.md"), "# Skill\n", "utf-8")
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it("copies template bootstrap files and workspace skills into a new workbench", async () => {
    const resolved = await ensureWorkbenchReady(targetDir, { templateDir })

    expect(resolved).toBe(path.resolve(targetDir))
    await expect(fs.readFile(path.join(targetDir, DEFAULT_AGENTS_FILENAME), "utf-8")).resolves.toContain("Agents")
    await expect(fs.readFile(path.join(targetDir, DEFAULT_HEARTBEAT_FILENAME), "utf-8")).resolves.toContain("Heartbeat")
    await expect(fs.readFile(path.join(targetDir, "skills", "stark-jarvis", "SKILL.md"), "utf-8")).resolves.toContain("Skill")
  })

  it("preserves existing workbench files when reprovisioning", async () => {
    await fs.mkdir(targetDir, { recursive: true })
    await fs.writeFile(path.join(targetDir, DEFAULT_AGENTS_FILENAME), "# Custom\n", "utf-8")

    await ensureWorkbenchReady(targetDir, { templateDir })

    await expect(fs.readFile(path.join(targetDir, DEFAULT_AGENTS_FILENAME), "utf-8")).resolves.toBe("# Custom\n")
  })
})
