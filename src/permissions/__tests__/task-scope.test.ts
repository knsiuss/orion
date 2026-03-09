/**
 * @file task-scope.test.ts
 * @description Unit tests for task-scope helpers — type inference and tool allowlisting.
 */
import { describe, it, expect } from "vitest"

import {
  inferTaskType,
  getScopeForTask,
  isToolAllowed,
  applyTaskScope,
} from "../task-scope.js"

describe("inferTaskType()", () => {
  it("defaults to conversation for generic messages", () => {
    expect(inferTaskType("hello, how are you?")).toBe("conversation")
    expect(inferTaskType("")).toBe("conversation")
  })

  it("classifies system-level requests", () => {
    expect(inferTaskType("restart the edith daemon")).toBe("system")
    expect(inferTaskType("deploy the service to production")).toBe("system")
    expect(inferTaskType("sudo update the credentials")).toBe("system")
  })

  it("classifies coding requests", () => {
    expect(inferTaskType("fix this TypeScript bug in the repo")).toBe("coding")
    // 'unit test' (two words) matches the pattern; 'tests' (plural) does not — test with exact phrase
    expect(inferTaskType("run the unit test")).toBe("coding")
    expect(inferTaskType("build and lint the project")).toBe("coding")
  })

  it("classifies research requests", () => {
    expect(inferTaskType("research the latest llm papers")).toBe("research")
    expect(inferTaskType("search for information about vector databases")).toBe("research")
  })

  it("system takes priority over coding when keywords overlap", () => {
    // 'service' and 'restart' match system first
    expect(inferTaskType("restart the server service")).toBe("system")
  })
})

describe("getScopeForTask()", () => {
  it("returns a copy (not a reference) so mutation is safe", () => {
    const scope1 = getScopeForTask("coding")
    const scope2 = getScopeForTask("coding")
    scope1.allowedTools.push("evilTool")
    expect(scope2.allowedTools).not.toContain("evilTool")
  })

  it("conversation scope has no terminal or file-write tools", () => {
    const scope = getScopeForTask("conversation")
    expect(scope.allowedTools).not.toContain("terminalTool")
    expect(scope.allowedTools).not.toContain("fileWriteTool")
  })

  it("system scope requires explicit approval", () => {
    const scope = getScopeForTask("system")
    expect(scope.requiresExplicitApproval).toBe(true)
  })

  it("coding scope does NOT require explicit approval", () => {
    const scope = getScopeForTask("coding")
    expect(scope.requiresExplicitApproval).toBe(false)
  })
})

describe("isToolAllowed()", () => {
  it("returns true for allowed tools", () => {
    const scope = getScopeForTask("coding")
    expect(isToolAllowed(scope, "terminalTool")).toBe(true)
    expect(isToolAllowed(scope, "fileWriteTool")).toBe(true)
  })

  it("returns false for disallowed tools", () => {
    const scope = getScopeForTask("conversation")
    expect(isToolAllowed(scope, "terminalTool")).toBe(false)
    expect(isToolAllowed(scope, "fileWriteTool")).toBe(false)
  })
})

describe("applyTaskScope()", () => {
  const allTools = {
    searchTool: {},
    terminalTool: {},
    fileWriteTool: {},
    fileReadTool: {},
  }

  it("passes only allowed tools through for conversation scope", () => {
    const scope = getScopeForTask("conversation")
    const result = applyTaskScope(allTools, scope)
    expect(result.approvalRequired).toBe(false)
    expect("terminalTool" in result.tools).toBe(false)
    expect("fileWriteTool" in result.tools).toBe(false)
    expect("searchTool" in result.tools).toBe(true)
    expect(result.blockedTools).toContain("terminalTool")
  })

  it("blocks all tools for system scope when explicitApproval is false", () => {
    const scope = getScopeForTask("system")
    const result = applyTaskScope(allTools, scope, { explicitApproval: false })
    expect(result.approvalRequired).toBe(true)
    expect(Object.keys(result.tools)).toHaveLength(0)
    expect(result.blockedTools).toHaveLength(Object.keys(allTools).length)
  })

  it("allows system tools through when explicitApproval is true", () => {
    const scope = getScopeForTask("system")
    const result = applyTaskScope(allTools, scope, { explicitApproval: true })
    expect(result.approvalRequired).toBe(false)
    expect("terminalTool" in result.tools).toBe(true)
  })

  it("returns empty blockedTools when all tools are in scope", () => {
    const scope = getScopeForTask("coding")
    const codingTools = { terminalTool: {}, fileReadTool: {}, searchTool: {} }
    const result = applyTaskScope(codingTools, scope)
    expect(result.blockedTools).toHaveLength(0)
  })
})
