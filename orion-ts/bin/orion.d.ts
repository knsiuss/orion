export function getCliConfigDir(): string
export function getCliConfigPath(): string

export function parseOrionCliArgs(argv: string[]): {
  repoOverride: string | null
  positionals: string[]
  help: boolean
}

export function loadCliConfig(fsModule?: {
  readFile: (path: string, encoding: string) => Promise<string>
}): Promise<Record<string, unknown>>

export function saveCliConfig(
  config: Record<string, unknown>,
  fsModule?: {
    mkdir: (path: string, options?: { recursive?: boolean }) => Promise<unknown>
    writeFile: (path: string, content: string, encoding: string) => Promise<unknown>
  },
): Promise<void>

export function isOrionRepoDir(
  repoDir: string,
  fsModule?: { readFile: (path: string, encoding: string) => Promise<string> },
): Promise<boolean>

export function findOrionRepoUpwards(
  startDir: string,
  fsModule?: { readFile: (path: string, encoding: string) => Promise<string> },
): Promise<string | null>

export function main(argv?: string[]): Promise<void>
