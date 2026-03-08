/**
 * @file research-queue.ts
 * @description Queues user research requests for background processing.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Allows EDITH to queue deep research tasks that run asynchronously.
 *   Results are stored and delivered proactively when ready.
 */
import { createLogger } from "../logger.js"

const log = createLogger("ambient.research-queue")

export interface ResearchTask {
  id: string
  userId: string
  query: string
  status: "queued" | "in-progress" | "done" | "failed"
  result?: string
  createdAt: Date
  completedAt?: Date
}

class ResearchQueue {
  private tasks: ResearchTask[] = []
  private counter = 0

  enqueue(userId: string, query: string): ResearchTask {
    const task: ResearchTask = {
      id: `research-${++this.counter}`,
      userId,
      query,
      status: "queued",
      createdAt: new Date(),
    }
    this.tasks.push(task)
    log.info("research queued", { userId, taskId: task.id })
    return task
  }

  getQueued(): ResearchTask[] {
    return this.tasks.filter(t => t.status === "queued")
  }

  getForUser(userId: string): ResearchTask[] {
    return this.tasks.filter(t => t.userId === userId)
  }

  complete(id: string, result: string): void {
    const task = this.tasks.find(t => t.id === id)
    if (task) {
      task.status = "done"
      task.result = result
      task.completedAt = new Date()
      log.info("research completed", { taskId: id })
    }
  }

  fail(id: string): void {
    const task = this.tasks.find(t => t.id === id)
    if (task) {
      task.status = "failed"
      task.completedAt = new Date()
    }
  }
}

export const researchQueue = new ResearchQueue()
