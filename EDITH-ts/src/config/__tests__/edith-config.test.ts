import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  DEFAULT_WORKSPACE_PATH,
  resolveConfiguredWorkspaceDir,
} from "../edith-config.js"

describe("resolveConfiguredWorkspaceDir", () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "edith-config-workspace-"))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it("defaults to the testing workbench when no config exists", () => {
    const resolved = resolveConfiguredWorkspaceDir({
      cwd: tempDir,
      env: {} as NodeJS.ProcessEnv,
    })

    expect(resolved).toBe(path.resolve(tempDir, DEFAULT_WORKSPACE_PATH))
  })

  it("reads the configured workbench from edith.json", async () => {
    await fs.writeFile(
      path.join(tempDir, "edith.json"),
      JSON.stringify({
        agents: {
          defaults: {
            workspace: "./workbenches/edith",
          },
        },
      }),
      "utf-8",
    )

    const resolved = resolveConfiguredWorkspaceDir({
      cwd: tempDir,
      env: {} as NodeJS.ProcessEnv,
    })

    expect(resolved).toBe(path.resolve(tempDir, "workbenches", "edith"))
  })

  it("lets EDITH_WORKSPACE override the persisted workbench", async () => {
    await fs.writeFile(
      path.join(tempDir, "edith.json"),
      JSON.stringify({
        agents: {
          defaults: {
            workspace: "./workbenches/edith",
          },
        },
      }),
      "utf-8",
    )

    const resolved = resolveConfiguredWorkspaceDir({
      cwd: tempDir,
      env: {
        EDITH_WORKSPACE: "./workbenches/testing",
      } as NodeJS.ProcessEnv,
    })

    expect(resolved).toBe(path.resolve(tempDir, "workbenches", "testing"))
  })
})
