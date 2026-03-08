/**
 * @file github-copilot.ts
 * @description GitHub Copilot as a free LLM backend via OAuth token exchange.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Uses GitHub Copilot's internal API with token refresh.
 *   Requires GITHUB_TOKEN env var (GitHub personal access token with copilot scope).
 *   Token auto-refreshes before expiry.
 */
import config from '../config.js'
import { createLogger } from '../logger.js'
import type { Engine, GenerateOptions } from './types.js'

const log = createLogger('engines.github-copilot')
const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token'
const COPILOT_COMPLETIONS_URL = 'https://api.githubcopilot.com/chat/completions'

class GitHubCopilotEngine implements Engine {
  readonly name = 'github-copilot'
  readonly provider = 'github-copilot'
  readonly defaultModel = 'gpt-4o'

  private accessToken: string | null = null
  private tokenExpiry = 0

  private async refreshToken(githubToken: string): Promise<string> {
    const res = await fetch(COPILOT_TOKEN_URL, {
      headers: {
        Authorization: `token ${githubToken}`,
        'Editor-Version': 'vscode/1.85.0',
        'Editor-Plugin-Version': 'copilot-chat/0.11.1',
      },
    })
    if (!res.ok) throw new Error(`Copilot token refresh failed: ${res.status}`)
    const data = await res.json() as { token: string; expires_at: number }
    this.tokenExpiry = data.expires_at * 1000
    return data.token
  }

  async generate(options: GenerateOptions): Promise<string> {
    const githubToken = config.GITHUB_TOKEN
    if (!githubToken) throw new Error('GITHUB_TOKEN not set')

    if (!this.accessToken || Date.now() > this.tokenExpiry - 60_000) {
      this.accessToken = await this.refreshToken(githubToken)
    }

    const messages: Array<{ role: string; content: string }> = []
    if (options.systemPrompt) messages.push({ role: 'system', content: options.systemPrompt })
    if (options.context) messages.push(...options.context)
    messages.push({ role: 'user', content: options.prompt })

    const res = await fetch(COPILOT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        'Editor-Version': 'vscode/1.85.0',
        'Copilot-Integration-Id': 'vscode-chat',
      },
      body: JSON.stringify({
        model: options.model ?? this.defaultModel,
        messages,
        stream: false,
        max_tokens: options.maxTokens ?? 4096,
      }),
    })
    if (!res.ok) {
      log.error('copilot api error', { status: res.status })
      throw new Error(`Copilot API error: ${res.status}`)
    }
    const data = await res.json() as { choices: Array<{ message: { content: string } }> }
    return data.choices[0]?.message?.content ?? ''
  }

  isAvailable(): boolean {
    return !!config.GITHUB_TOKEN
  }
}

/** Singleton GitHub Copilot engine instance. */
export const githubCopilotEngine = new GitHubCopilotEngine()
