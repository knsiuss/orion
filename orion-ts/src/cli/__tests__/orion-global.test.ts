import path from "node:path"

import { describe, expect, it, vi } from "vitest"

import {
  parseOrionCliArgs,
  findOrionRepoUpwards,
  isOrionRepoDir,
} from "../../../bin/orion.js"

describe("global orion CLI helpers", () => {
  it("parses repo override and positionals", () => {
    const parsed = parseOrionCliArgs([
      "--repo",
      "C:\\repo\\orion-ts",
      "wa",
      "scan",
    ])

    expect(parsed).toEqual({
      repoOverride: "C:\\repo\\orion-ts",
      positionals: ["wa", "scan"],
      help: false,
    })
  })

  it("detects help flag early", () => {
    expect(parseOrionCliArgs(["--help"])).toEqual({
      repoOverride: null,
      positionals: [],
      help: true,
    })
  })

  it("validates Orion repo by package name", async () => {
    const fsMock = {
      readFile: vi.fn(async (filePath: string) => {
        if (filePath.endsWith(`${path.sep}package.json`)) {
          return JSON.stringify({ name: "orion" })
        }
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      }),
    }

    await expect(isOrionRepoDir("C:\\repo\\orion-ts", fsMock as any)).resolves.toBe(true)
  })

  it("finds nested orion-ts repo while walking upward", async () => {
    const validDirs = new Set([
      path.resolve("C:\\work\\mono\\orion-ts"),
    ])

    const fsMock = {
      readFile: vi.fn(async (filePath: string) => {
        const dir = path.dirname(filePath)
        if (path.basename(filePath) === "package.json" && validDirs.has(dir)) {
          return JSON.stringify({ name: "orion" })
        }
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      }),
    }

    const found = await findOrionRepoUpwards("C:\\work\\mono\\apps\\demo", fsMock as any)
    expect(found).toBe(path.resolve("C:\\work\\mono\\orion-ts"))
  })
})
