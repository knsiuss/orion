/**
 * @file browser-som.test.ts
 * @description Unit/integration tests for agents\.__tests__\.browser-som.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const playwrightState = vi.hoisted(() => ({
	launch: vi.fn(),
}))

vi.mock("../../security/prompt-filter.js", () => ({
	filterToolResult: (input: string) => ({ sanitized: input }),
}))

vi.mock("playwright", () => ({
	chromium: {
		launch: playwrightState.launch,
	},
}))

import {
	__browserTestUtils,
	browserTool,
	extractInteractableElements,
	injectSetOfMark,
	shutdownBrowser,
} from "../tools/browser.js"

function createMockPage(options?: {
	title?: string
	url?: string
	content?: string
	elements?: Array<Record<string, unknown>>
	links?: Array<Record<string, unknown>>
}) {
	const page = {
		isClosed: vi.fn(() => false),
		setExtraHTTPHeaders: vi.fn(async () => undefined),
		goto: vi.fn(async () => undefined),
		title: vi.fn(async () => options?.title ?? "GitHub"),
		url: vi.fn(() => options?.url ?? "https://github.com/knsiuss/orion"),
		click: vi.fn(async () => undefined),
		fill: vi.fn(async () => undefined),
		waitForLoadState: vi.fn(async () => undefined),
		goBack: vi.fn(async () => undefined),
		screenshot: vi.fn(async () => Buffer.from("png")),
		accessibility: {
			snapshot: vi.fn(async () => ({
				role: "document",
				name: options?.title ?? "GitHub",
				value: options?.content ?? "Personal AI companion platform.",
			})),
		},
		evaluate: vi.fn(async (arg: unknown) => {
			if (typeof arg === "string") {
				return 7
			}

			const source = String(arg)
			if (source.includes("data-edith-id")) {
				return options?.elements ?? [
					{
						id: "e01",
						tag: "a",
						text: "EDITH",
						role: "link",
						ariaLabel: "",
						placeholder: "",
						href: "https://github.com/knsiuss/orion",
						isVisible: true,
					},
				]
			}

			if (source.includes("querySelectorAll(\"a[href]\")")) {
				return options?.links ?? [
					{
						text: "EDITH",
						href: "https://github.com/knsiuss/orion",
					},
				]
			}

			return options?.content ?? "Personal AI companion platform."
		}),
	}

	return page
}

describe("browser SoM helpers", () => {
	beforeEach(() => {
		const page = createMockPage()
		const browser = {
			isConnected: vi.fn(() => true),
			newPage: vi.fn(async () => page),
			close: vi.fn(async () => undefined),
		}
		playwrightState.launch.mockResolvedValue(browser)
	})

	afterEach(async () => {
		await shutdownBrowser()
		vi.clearAllMocks()
	})

	it("injects a data-edith-id script into the page", async () => {
		const evaluate = vi.fn(async () => 7)
		const page = { evaluate }

		const count = await injectSetOfMark(page)
		const firstCall = evaluate.mock.calls[0] as unknown[] | undefined

		expect(count).toBe(7)
		expect(evaluate).toHaveBeenCalledTimes(1)
		expect(String(firstCall?.[0] ?? "")).toContain("dataset.edithId")
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
		const page = createMockPage({
			elements: [
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
			],
		})

		const elements = await extractInteractableElements(page)

		expect(elements).toHaveLength(1)
		expect(elements[0].id).toBe("e01")
		expect(elements[0].text).toBe("Sign in")
	})

	it("builds selectors from data-edith-id instead of pixel coordinates", () => {
		expect(__browserTestUtils.buildEdithSelector("e14")).toBe('[data-edith-id="e14"]')
	})

	it("navigate auto-injects Set-of-Mark before returning the observation", async () => {
		const result = await (browserTool as { execute: Function }).execute({
			action: "navigate",
			url: "https://github.com/knsiuss/orion",
		})

		const parsed = JSON.parse(result) as { url: string; elements: Array<{ id: string }> }
		expect(parsed.url).toBe("https://github.com/knsiuss/orion")
		expect(parsed.elements[0]?.id).toBe("e01")
	})

	it("click_element uses the data-edith-id selector", async () => {
		await (browserTool as { execute: Function }).execute({
			action: "navigate",
			url: "https://github.com/knsiuss/orion",
		})

		const browser = await playwrightState.launch.mock.results[0]?.value
		const page = await browser.newPage.mock.results[0]?.value

		await (browserTool as { execute: Function }).execute({
			action: "click_element",
			edithId: "e01",
		})

		expect(page.click).toHaveBeenLastCalledWith('[data-edith-id="e01"]', { timeout: 5_000 })
	})

	it("fill_element uses the data-edith-id selector", async () => {
		await (browserTool as { execute: Function }).execute({
			action: "navigate",
			url: "https://github.com/knsiuss/orion",
		})

		const browser = await playwrightState.launch.mock.results[0]?.value
		const page = await browser.newPage.mock.results[0]?.value

		await (browserTool as { execute: Function }).execute({
			action: "fill_element",
			edithId: "e02",
			value: "search text",
		})

		expect(page.fill).toHaveBeenLastCalledWith('[data-edith-id="e02"]', "search text")
	})

	it("rejects blocked domains before launching the browser", async () => {
		const result = await (browserTool as { execute: Function }).execute({
			action: "navigate",
			url: "http://127.0.0.1:3000/private",
		})

		expect(result).toContain("Access to internal network is not allowed")
		expect(playwrightState.launch).not.toHaveBeenCalled()
	})

	it("extracts structured links from the current page", async () => {
		const browser = {
			isConnected: vi.fn(() => true),
			newPage: vi.fn(async () => createMockPage({
				links: [
					{ text: "Repo", href: "https://github.com/knsiuss/orion" },
					{ text: "Docs", href: "https://github.com/knsiuss/orion/tree/main/docs" },
				],
			})),
			close: vi.fn(async () => undefined),
		}
		playwrightState.launch.mockResolvedValueOnce(browser)

		await (browserTool as { execute: Function }).execute({
			action: "navigate",
			url: "https://github.com/knsiuss/orion",
		})
		const result = await (browserTool as { execute: Function }).execute({
			action: "extract",
			extractType: "links",
		})

		expect(result).toContain("https://github.com/knsiuss/orion")
		expect(result).toContain("Docs")
	})

	it("back re-injects Set-of-Mark and returns a fresh observation", async () => {
		await (browserTool as { execute: Function }).execute({
			action: "navigate",
			url: "https://github.com/knsiuss/orion",
		})

		const browser = await playwrightState.launch.mock.results[0]?.value
		const page = await browser.newPage.mock.results[0]?.value
		const result = await (browserTool as { execute: Function }).execute({ action: "back" })
		const parsed = JSON.parse(result) as { title: string }

		expect(page.goBack).toHaveBeenCalled()
		expect(parsed.title).toBe("GitHub")
	})
})
