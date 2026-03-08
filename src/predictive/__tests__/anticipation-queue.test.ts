import { describe, it, expect } from "vitest"
import { anticipationQueue } from "../anticipation-queue.js"

describe("AnticipationQueue", () => {
  it("enqueues and peeks items", () => {
    anticipationQueue.enqueue("user1", "check weather", 0.8)
    const items = anticipationQueue.peek("user1", 0.5)
    expect(items.length).toBe(1)
    expect(items[0].prediction).toBe("check weather")
  })

  it("filters by confidence threshold", () => {
    anticipationQueue.enqueue("user2", "low confidence", 0.2)
    const items = anticipationQueue.peek("user2", 0.5)
    expect(items.length).toBe(0)
  })

  it("marks items as delivered", () => {
    anticipationQueue.enqueue("user3", "test", 0.9)
    const items = anticipationQueue.peek("user3", 0.5)
    anticipationQueue.markDelivered(items[0].id)
    const after = anticipationQueue.peek("user3", 0.5)
    expect(after.length).toBe(0)
  })
})
