import { describe, expect, it, vi } from "vitest"

vi.mock("../../security/prompt-filter.js", () => ({
  filterToolResult: (input: string) => ({ sanitized: input }),
}))

import {
  __browserTestUtils,
  extractInteractableElements,
  injectSetOfMark,
} from "../tools/browser.js"

describe("browser SoM helpers", () => {
  it("injects a data-edith-id script into the page", async () => {
    const evaluate = vi.fn(async () => 7)
    const page = { evaluate }

    const count = await injectSetOfMark(page)

    expect(count).toBe(7)
    expect(evaluate).toHaveBeenCalledTimes(1)
    expect(String(evaluate.mock.calls[0][0])).toContain("dataset.edithId")
  })

  it("normalizes element lists to visible entries under the context budget", () => {
    const elements = Array.from({ length: 60 }, (_, index) => ({
      id: `e${index}`,
      tag: "button",
      text: `Button ${index}`,
      role: "button",
      ariaLabel: "",
      placeholder: "",
      href: "",
      isVisible: index !== 1,
    }))

    const normalized = __browserTestUtils.normalizeInteractableElements(elements)

    expect(normalized).toHaveLength(50)
    expect(normalized.some((element: { id: string }) => element.id === "e1")).toBe(false)
  })

  it("extracts interactable elements through the injected marker list", async () => {
    const page = {
      evaluate: vi.fn(async () => [
        {
          id: "e01",
          tag: "button",
          text: "Sign in",
          role: "button",
          ariaLabel: "",
          placeholder: "",
          href: "",
          isVisible: true,
        },
      ]),
    }

    const elements = await extractInteractableElements(page)

    expect(elements).toHaveLength(1)
    expect(elements[0].id).toBe("e01")
    expect(elements[0].text).toBe("Sign in")
  })

  it("builds selectors from data-edith-id instead of pixel coordinates", () => {
    expect(__browserTestUtils.buildEdithSelector("e14")).toBe('[data-edith-id="e14"]')
  })
})