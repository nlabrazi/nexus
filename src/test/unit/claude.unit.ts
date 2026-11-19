import * as assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, it } from 'node:test'

import childProcess = require('node:child_process')

import { ClaudeCodeClient } from '../../claude/client'
import { ClaudeCodeService } from '../../claude/service'
import type { KeyValueStorage } from '../../runtime/types'

class FakeClaudeProcess extends EventEmitter {
  public readonly stdout = new PassThrough()
  public readonly stderr = new PassThrough()
  public readonly stdin = new PassThrough()
  public killed = false
  public killSignal?: string

  public kill(signal?: string): boolean {
    this.killed = true
    this.killSignal = signal
    return true
  }
}

class InMemoryStorage implements KeyValueStorage {
  private readonly store = new Map<string, unknown>()

  public get<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined
  }

  public async update(key: string, value: unknown): Promise<void> {
    this.store.set(key, value)
  }
}

describe('Claude Code Integration', () => {
  it('instantiates client and reports available status', () => {
    const client = new ClaudeCodeClient()
    const status = client.getStatus()
    assert.equal(status.available, true)
    assert.ok(status.binaryPath)
  })

  it('lists default models for Claude Code', async () => {
    const service = new ClaudeCodeService()
    const models = await service.listModels()
    assert.ok(models.length >= 3)
    assert.equal(models[0].id, 'claude-sonnet-4-6')
    assert.equal(models[0].isDefault, true)
    assert.ok(models.some((m) => m.id === 'claude-opus-4-6'))
    assert.ok(models.some((m) => m.id === 'claude-haiku-4-5'))
  })

  it('handles unauthenticated or missing credentials cleanly without throwing', async (t) => {
    t.mock.method(childProcess, 'spawn', () => {
      const proc = new FakeClaudeProcess()
      queueMicrotask(() => {
        proc.stdout.write(
          `${JSON.stringify({
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'Not logged in · Please run /login' }],
            },
            error: 'authentication_failed',
          })}\n`,
        )
        proc.emit('close', 1)
      })
      return proc as unknown as childProcess.ChildProcessWithoutNullStreams
    })

    const service = new ClaudeCodeService({ binaryPath: 'claude' })
    const result = await service.sendPrompt('ping test', process.cwd())
    assert.ok(result)
    assert.ok(
      result.includes("Claude Code n'est pas authentifié") ||
        result.includes('Not logged in') ||
        result.includes('claude login'),
    )
  })

  it('persists and restores model selection, aliases, menu and session lifecycle', async () => {
    const storage = new InMemoryStorage()
    await storage.update('nexus.claude.model', { model: 'claude-opus-4-6', effort: 'high' })
    await storage.update('nexus.claude.telemetry', {
      inputTokens: 10,
      outputTokens: 5,
      cachedInputTokens: 2,
      totalTokens: 17,
      totalCostUsd: 0.01,
      turns: 1,
    })
    await storage.update('nexus.claude.sessions', {
      [resolve('/tmp/ws-a')]: 'sess-a',
    })

    const service = new ClaudeCodeService({ binaryPath: 'claude', storage })
    const initialMenu = await service.getModelMenu('/tmp/ws-a')
    assert.equal(initialMenu.current.model, 'claude-opus-4-6')
    assert.equal(initialMenu.current.effort, 'high')
    assert.equal(initialMenu.context, 'claude-global')
    assert.equal(service.getActiveWorkspacePath(), undefined)
    assert.equal(service.getCurrentSessionId(), undefined)
    await service.refreshStatus()

    const haiku = await service.selectModel('haiku')
    assert.equal(haiku.model, 'claude-haiku-4-5')
    assert.equal(service.getStatus().effort, 'low')

    await service.selectModelChoice('/tmp/ws-a', { model: 'opus', effort: 'max' })
    assert.equal(service.getStatus().model, 'claude-opus-4-6')
    assert.equal(service.getStatus().effort, 'max')

    await service.selectModel({ model: 'sonnet', effort: 'invalid-effort' })
    assert.equal(service.getStatus().model, 'claude-sonnet-4-6')
    assert.equal(service.getStatus().effort, 'medium')

    await assert.rejects(() => service.selectModel('unknown-model'), /Modèle Claude Code inconnu/)

    const resumed = await service.resumeSession('/tmp/ws-b', '  sess-b  ')
    assert.equal(resumed, 'sess-b')
    await assert.rejects(() => service.resumeSession('/tmp/ws-b', '   '), /session valide/)
    await assert.rejects(() => service.resumeSession('/tmp/ws-b', 'bad id'), /session valide/)

    const createdId = await service.newSession('/tmp/ws-b')
    assert.match(createdId, /^claude:/)
    service.resetSession()
    assert.deepEqual(storage.get('nexus.claude.sessions'), {})
  })

  it('streams chunks, tracks changed files, records telemetry and resumes session on next turn', async (t) => {
    const storage = new InMemoryStorage()
    const capturedArgs: string[][] = []

    t.mock.method(childProcess, 'spawn', (_bin: string, args: readonly string[]) => {
      capturedArgs.push([...args])
      const proc = new FakeClaudeProcess()
      queueMicrotask(() => {
        if (capturedArgs.length === 1) {
          proc.stdout.write('not-json-noise\n')
          proc.stdout.write(
            `${JSON.stringify({
              type: 'assistant',
              session_id: 'claude-sess-42',
              message: {
                content: [
                  { type: 'text', text: 'Updated file. ' },
                  { type: 'tool_use', input: { file_path: 'src/a.ts' } },
                  { type: 'tool_use', input: { path: 'src/b.ts' } },
                  { type: 'tool_use', input: { target_file: 'src/c.ts' } },
                ],
              },
            })}\n`,
          )
          proc.stdout.write(
            `${JSON.stringify({
              type: 'result',
              result: 'Done cleanly',
              total_cost_usd: 0.025,
              usage: {
                input_tokens: 100,
                output_tokens: 40,
                cache_read_input_tokens: 10,
                cache_creation_input_tokens: 5,
              },
            })}\n`,
          )
        }
        proc.emit('close', 0)
      })
      return proc as unknown as childProcess.ChildProcessWithoutNullStreams
    })

    const service = new ClaudeCodeService({ binaryPath: 'claude', storage })
    const chunks: string[] = []
    let changedFiles: readonly string[] = []

    const firstReply = await service.sendPrompt(
      'edit files',
      '/tmp/claude-ws',
      (files) => {
        changedFiles = files
      },
      (delta) => chunks.push(delta),
    )

    assert.equal(firstReply, 'Done cleanly')
    assert.deepEqual(chunks, ['Updated file. '])
    assert.deepEqual(changedFiles, ['src/a.ts', 'src/b.ts', 'src/c.ts'])

    const status = service.getStatus()
    assert.equal(status.telemetry?.inputTokens, 100)
    assert.equal(status.telemetry?.outputTokens, 40)
    assert.equal(status.telemetry?.cachedInputTokens, 15)
    assert.equal(status.telemetry?.totalTokens, 155)
    assert.equal(status.telemetry?.totalCostUsd, 0.025)
    assert.equal(status.telemetry?.turns, 1)

    // Second turn uses --resume and returns empty-response fallback when no text was emitted
    const secondReply = await service.sendPrompt('follow-up', '/tmp/claude-ws')
    assert.equal(secondReply, '(Tâche terminée sans réponse textuelle)')
    assert.ok(capturedArgs[1].includes('--resume'))
    assert.ok(capturedArgs[1].includes('claude-sess-42'))
  })

  it('rejects on process failure or spawn error and supports cancellation', async (t) => {
    let activeProc: FakeClaudeProcess | undefined
    let mode: 'fail' | 'spawn-error' | 'hang' = 'fail'

    t.mock.method(childProcess, 'spawn', () => {
      const proc = new FakeClaudeProcess()
      activeProc = proc
      queueMicrotask(() => {
        if (mode === 'fail') {
          proc.stderr.write('fatal cli error')
          proc.emit('close', 2)
        } else if (mode === 'spawn-error') {
          proc.emit('error', new Error('ENOENT'))
        }
      })
      return proc as unknown as childProcess.ChildProcessWithoutNullStreams
    })

    const service = new ClaudeCodeService({ binaryPath: 'claude' })
    assert.equal(service.cancelCurrentWork(), false)

    await assert.rejects(
      () => service.sendPrompt('fail me', '/tmp/ws'),
      /Claude Code a échoué \(code 2\) : fatal cli error/,
    )

    mode = 'spawn-error'
    await assert.rejects(
      () => service.sendPrompt('missing bin', '/tmp/ws'),
      /Impossible de lancer le CLI Claude Code.*ENOENT/,
    )

    mode = 'hang'
    const pending = service.sendPrompt('long task', '/tmp/ws')
    assert.equal(service.cancelCurrentWork(), true)
    assert.equal(activeProc?.killed, true)
    assert.equal(activeProc?.killSignal, 'SIGINT')
    activeProc?.emit('close', 0)
    await pending

    // stop() delegates to client.cancel() cleanly even when idle
    service.stop()
  })
})
