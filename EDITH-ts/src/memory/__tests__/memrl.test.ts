import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import config from "../../config.js"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    memoryNode: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock("../../database/index.js", () => ({
  prisma: prismaMock,
}))

import { MemRLUpdater, __memrlTestUtils } from "../memrl.js"

function makeRow(overrides: Record<string, unknown>): {
  id: string
  userId: string
  content: string
  metadata: string
} & Record<string, unknown> {
  return {
    id: "m1",
    userId: "u1",
    content: "content",
    metadata: "{}",
    ...overrides,
  }
}

describe("MemRL helpers", () => {
  const originalReplayEnabled = config.MEMRL_EXPERIENCE_REPLAY_ENABLED
  const originalLambdaEnabled = config.MEMRL_TD_LAMBDA_ENABLED

  beforeEach(() => {
    prismaMock.memoryNode.findMany.mockReset()
    prismaMock.memoryNode.update.mockReset()
    config.MEMRL_EXPERIENCE_REPLAY_ENABLED = false
    config.MEMRL_TD_LAMBDA_ENABLED = false
  })

  afterEach(() => {
    config.MEMRL_EXPERIENCE_REPLAY_ENABLED = originalReplayEnabled
    config.MEMRL_TD_LAMBDA_ENABLED = originalLambdaEnabled
    vi.clearAllMocks()
  })

  it("converts distance-based and score-based LanceDB rows to bounded similarity", () => {
    expect(__memrlTestUtils.toSimilarityScore(makeRow({ _distance: 0 }))).toBe(1)
    expect(__memrlTestUtils.toSimilarityScore(makeRow({ distance: 3 }))).toBeCloseTo(0.25)
    expect(__memrlTestUtils.toSimilarityScore(makeRow({ similarity: 0.8 }))).toBe(0.8)
    expect(__memrlTestUtils.toSimilarityScore(makeRow({ _score: -4 }))).toBeCloseTo(0.2)
  })

  it("normalizes similarity thresholds safely", () => {
    expect(__memrlTestUtils.normalizeSimilarityThreshold(Number.NaN)).toBe(0.3)
    expect(__memrlTestUtils.normalizeSimilarityThreshold(-1)).toBe(0)
    expect(__memrlTestUtils.normalizeSimilarityThreshold(2)).toBe(1)
  })

  it("extracts intent from the first sentence and clips long text", () => {
    const text = `Plan a migration. Then run tests.${"x".repeat(400)}`
    const intent = __memrlTestUtils.extractIntent(text)

    expect(intent).toBe("Plan a migration")
    expect(intent.length).toBeLessThanOrEqual(200)
  })

  it("blends explicit reward with task-success signal deterministically", () => {
    expect(__memrlTestUtils.computeEffectiveReward(0.8, false)).toBeCloseTo(0.56)
    expect(__memrlTestUtils.computeEffectiveReward(0.8, true)).toBeCloseTo(0.86)
    expect(__memrlTestUtils.computeEffectiveReward(-10, false)).toBe(0)
    expect(__memrlTestUtils.computeEffectiveReward(10, true)).toBe(1)
  })

  it("uses the best global successor q-value instead of the local batch peer max", async () => {
    prismaMock.memoryNode.findMany
      .mockResolvedValueOnce([
        { id: "m1", userId: "u1", utilityScore: 0.2, qValue: 0.2, metadata: {} },
        { id: "m2", userId: "u1", utilityScore: 0.4, qValue: 0.4, metadata: {} },
      ])
      .mockResolvedValueOnce([
        { id: "g1", qValue: 0.9, utilityScore: 0.9 },
        { id: "m2", qValue: 0.4, utilityScore: 0.4 },
      ])
    prismaMock.memoryNode.update.mockResolvedValue({})

    const updater = new MemRLUpdater()
    await updater.updateFromFeedback({
      memoryIds: ["m1", "m2"],
      taskSuccess: true,
      reward: 1,
    })

    const updateCall = prismaMock.memoryNode.update.mock.calls.find(
      ([input]: Array<{ where: { id: string }; data: { qValue: number } }>) => input.where.id === "m1",
    )
    const expectedReward = __memrlTestUtils.computeEffectiveReward(1, true)
    const expectedQ = 0.2 + 0.1 * (expectedReward + config.MEMRL_GAMMA * 0.9 - 0.2)

    expect(updateCall).toBeDefined()
    expect(updateCall?.[0].data.qValue).toBeCloseTo(expectedQ)
    expect(prismaMock.memoryNode.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { userId: "u1" },
      take: 2,
    }))
  })

  it("excludes the memory being updated when it currently has the top q-value", async () => {
    prismaMock.memoryNode.findMany
      .mockResolvedValueOnce([
        { id: "top", userId: "u1", utilityScore: 0.95, qValue: 0.95, metadata: {} },
      ])
      .mockResolvedValueOnce([
        { id: "top", qValue: 0.95, utilityScore: 0.95 },
        { id: "next", qValue: 0.7, utilityScore: 0.7 },
      ])
    prismaMock.memoryNode.update.mockResolvedValue({})

    const updater = new MemRLUpdater()
    await updater.updateFromFeedback({
      memoryIds: ["top"],
      taskSuccess: false,
      reward: 0.2,
    })

    const updateCall = prismaMock.memoryNode.update.mock.calls[0]?.[0]
    const expectedReward = __memrlTestUtils.computeEffectiveReward(0.2, false)
    const expectedQ = 0.95 + 0.1 * (expectedReward + config.MEMRL_GAMMA * 0.7 - 0.95)

    expect(updateCall.where.id).toBe("top")
    expect(updateCall.data.qValue).toBeCloseTo(expectedQ)
  })
})
