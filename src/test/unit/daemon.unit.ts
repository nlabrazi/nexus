import * as assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { suite, test } from 'node:test'
import { getGitDiff, NexusDaemonServer, normalizeFishReferenceId } from '../../daemon/daemon-server'
import { NexusRuntime } from '../../runtime/nexus-runtime'
import { AuthGuard } from '../../security/auth'
import { JailGuard } from '../../security/jail'
import { WorkspaceGuard } from '../../workspace/guard'

suite('NexusDaemonServer unified secure daemon', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'nexus-daemon-test-'))
  const projectDir = join(sandbox, 'test-project')
  const outsideDir = join(sandbox, 'outside-secret')

  test('setup test sandbox', () => {
    const { mkdirSync } = require('node:fs')
    mkdirSync(projectDir, { recursive: true })
    mkdirSync(outsideDir, { recursive: true })
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'test-project' }))
    writeFileSync(join(outsideDir, 'secret.txt'), 'confidential')
  })

  const jail = new JailGuard({ allowedRoots: [projectDir] })
  const auth = new AuthGuard(['valid-token-123'])
  const port = 4199

  let daemon: NexusDaemonServer

  test('starts daemon server', async () => {
    const workspaceGuard = new WorkspaceGuard(() => ({
      trusted: true,
      folders: [{ scheme: 'file', path: projectDir }],
      dirtyDocuments: [],
      protectedBranches: ['main', 'master'],
    }))

    const runtime = new NexusRuntime({
      workspaceGuard,
      targetPath: () => projectDir,
      defaultBackend: 'codex',
    })

    daemon = new NexusDaemonServer({
      port,
      host: '127.0.0.1',
      jail,
      auth,
      runtime,
      initialProject: projectDir,
    })

    await daemon.start()
  })

  test('GET /health is public and returns 200 without token', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`)
    assert.equal(res.status, 200)
    const data = (await res.json()) as { status: string; daemon: string }
    assert.equal(data.status, 'ok')
    assert.equal(data.daemon, 'nexus-daemon')
  })

  test('GET /status rejects unauthenticated request with 401', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/status`)
    assert.equal(res.status, 401)
  })

  test('GET /status succeeds with Bearer token', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/status`, {
      headers: { Authorization: 'Bearer valid-token-123' },
    })
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(data)
  })

  test('GET /api/nodes returns the local daemon presence and active project', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/nodes`, {
      headers: { Authorization: 'Bearer valid-token-123' },
    })
    assert.equal(res.status, 200)
    const nodes = (await res.json()) as Array<{
      nodeId: string
      activeProject: { path: string }
      online: boolean
    }>
    assert.equal(nodes.length, 1)
    assert.equal(nodes[0].nodeId, 'local-daemon')
    assert.equal(nodes[0].activeProject.path, projectDir)
    assert.equal(nodes[0].online, true)
  })

  test('GET /api/filesystem blocks path traversal outside the jail with 403', async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}/api/filesystem?path=${encodeURIComponent(outsideDir)}`,
      {
        headers: { Authorization: 'Bearer valid-token-123' },
      },
    )
    assert.equal(res.status, 403)
    const err = (await res.json()) as { code: string; error: string }
    assert.equal(err.code, 'SECURITY_VIOLATION')
    assert.match(err.error, /Violation de confinement/)
  })

  test('POST /api/projects/switch blocks switching to a path outside the jail', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/projects/switch`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token-123',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: outsideDir }),
    })
    assert.equal(res.status, 403)
    const err = (await res.json()) as { code: string; error: string }
    assert.equal(err.code, 'SECURITY_VIOLATION')
  })

  test('GET /api/filesystem returns DirectoryListing schema for valid directory', async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}/api/filesystem?path=${encodeURIComponent(projectDir)}`,
      {
        headers: { Authorization: 'Bearer valid-token-123' },
      },
    )
    assert.equal(res.status, 200)
    const data = (await res.json()) as {
      path: string
      parent: string | null
      home: string
      roots: Array<{ name: string; path: string }>
      directories: Array<{ name: string; path: string; hidden: boolean }>
      entries: Array<{ name: string; path: string; isDirectory: boolean }>
    }
    assert.equal(data.path, projectDir)
    assert.ok(Array.isArray(data.roots))
    assert.ok(Array.isArray(data.directories))
    assert.ok(Array.isArray(data.entries))
  })

  test('POST /api/filesystem/open switches project and returns project metadata', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/filesystem/open`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token-123',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: projectDir }),
    })
    assert.equal(res.status, 200)
    const data = (await res.json()) as { id: string; name: string; path: string }
    assert.equal(data.path, projectDir)
    assert.equal(data.id, projectDir)
  })

  test('GET /api/tasks returns the task list', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/tasks`, {
      headers: { Authorization: 'Bearer valid-token-123' },
    })
    assert.equal(res.status, 200)
    const list = await res.json()
    assert.ok(Array.isArray(list))
  })

  test('GET /api/approvals returns list with pending status', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/approvals`, {
      headers: { Authorization: 'Bearer valid-token-123' },
    })
    assert.equal(res.status, 200)
    const list = await res.json()
    assert.ok(Array.isArray(list))
  })

  test('GET /api/sessions returns persistent sessions list', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/sessions`, {
      headers: { Authorization: 'Bearer valid-token-123' },
    })
    assert.equal(res.status, 200)
    const list = await res.json()
    assert.ok(Array.isArray(list))
  })

  test('POST and GET /api/persona and /api/projects/memory persist persona, project preferences and memory coherently', async () => {
    const postRes = await fetch(`http://127.0.0.1:${port}/api/persona`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token-123',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectPath: projectDir,
        persona: 'Développeur Senior TypeScript',
        projectPreferences: 'Toujours utiliser Biome et Node test runner',
        projectMemory: 'Architecture unifiée autour de NexusDaemonServer.',
      }),
    })
    assert.equal(postRes.status, 200)
    const postData = (await postRes.json()) as {
      status: string
      persona: string
      projectPreferences: string
      projectMemory: string
    }
    assert.equal(postData.status, 'ok')
    assert.equal(postData.persona, 'Développeur Senior TypeScript')
    assert.equal(postData.projectPreferences, 'Toujours utiliser Biome et Node test runner')
    assert.match(postData.projectMemory, /NexusDaemonServer/)

    const getRes = await fetch(
      `http://127.0.0.1:${port}/api/persona?path=${encodeURIComponent(projectDir)}`,
      {
        headers: { Authorization: 'Bearer valid-token-123' },
      },
    )
    assert.equal(getRes.status, 200)
    const getData = (await getRes.json()) as {
      persona: string
      projectPreferences: string
      projectMemory: string
    }
    assert.equal(getData.persona, 'Développeur Senior TypeScript')
    assert.equal(getData.projectPreferences, 'Toujours utiliser Biome et Node test runner')
    assert.match(getData.projectMemory, /NexusDaemonServer/)

    const memRes = await fetch(`http://127.0.0.1:${port}/api/projects/memory`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token-123',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectPath: projectDir,
        preferences: 'Directive mise à jour via /api/projects/memory',
        memory: 'Mémoire mise à jour via /api/projects/memory',
      }),
    })
    assert.equal(memRes.status, 200)
    const memData = (await memRes.json()) as {
      projectPreferences: string
      memory: string
    }
    assert.equal(memData.projectPreferences, 'Directive mise à jour via /api/projects/memory')
    assert.match(memData.memory, /Mémoire mise à jour via \/api\/projects\/memory/)
  })

  test('POST, GET, and DELETE /api/chat/history manage chat history with 50-message bound and Upstash-compatible payload', async () => {
    // Generate 60 test messages
    const testMessages = Array.from({ length: 60 }, (_, i) => ({
      id: `msg-${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      backend: 'brain',
      text: i === 0 ? 'A'.repeat(40000) : `Message numéro ${i}`,
      timestamp: Date.now() + i * 1000,
    }))

    // 1. POST history
    const postRes = await fetch(`http://127.0.0.1:${port}/api/chat/history`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token-123',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        project: projectDir,
        messages: testMessages,
      }),
    })
    assert.equal(postRes.status, 200)
    const postData = (await postRes.json()) as { status: string; count: number }
    assert.equal(postData.status, 'ok')
    assert.equal(postData.count, 50) // Bound to last 50 messages

    // 2. GET history
    const getRes = await fetch(
      `http://127.0.0.1:${port}/api/chat/history?project=${encodeURIComponent(projectDir)}`,
      {
        headers: { Authorization: 'Bearer valid-token-123' },
      },
    )
    assert.equal(getRes.status, 200)
    const history = (await getRes.json()) as Array<{ id: string }>
    assert.equal(history.length, 50)
    assert.equal(history[0].id, 'msg-10') // First 10 were dropped by slice(-50)
    assert.equal(history[49].id, 'msg-59')

    // 3. DELETE history
    const delRes = await fetch(
      `http://127.0.0.1:${port}/api/chat/history?project=${encodeURIComponent(projectDir)}`,
      {
        method: 'DELETE',
        headers: { Authorization: 'Bearer valid-token-123' },
      },
    )
    assert.equal(delRes.status, 200)

    // Verify it is now empty
    const verifyRes = await fetch(
      `http://127.0.0.1:${port}/api/chat/history?project=${encodeURIComponent(projectDir)}`,
      {
        headers: { Authorization: 'Bearer valid-token-123' },
      },
    )
    assert.equal(verifyRes.status, 200)
    const emptyHistory = await verifyRes.json()
    assert.deepEqual(emptyHistory, [])
  })

  test('POST /api/voice/config and /api/voice/Status manage Fish Audio configuration with URL normalization', async () => {
    const cfgRes = await fetch(`http://127.0.0.1:${port}/api/voice/config`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token-123',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ttsProvider: 'fish',
        referenceId: 'https://fish.audio/m/802e3bc2b27e49c2995d23ef70e6ac89/',
        model: 's2.1-pro',
      }),
    })
    assert.equal(cfgRes.status, 200)
    const cfgData = (await cfgRes.json()) as {
      tts: {
        provider: string
        referenceId: string
        model: string
        backupProvider: string
      }
    }
    assert.equal(cfgData.tts.provider, 'fish')
    assert.equal(cfgData.tts.referenceId, '802e3bc2b27e49c2995d23ef70e6ac89')
    assert.equal(cfgData.tts.model, 's2.1-pro')
    assert.equal(cfgData.tts.backupProvider, 'system')

    const synthWithoutKey = await fetch(`http://127.0.0.1:${port}/api/voice/synthesize`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token-123',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: 'Bonjour Nexus' }),
    })
    assert.equal(synthWithoutKey.status, 503)
  })

  test('GET /api/projects/diff and /api/tasks/:taskId/diff expose git diff safely', async () => {
    const projDiffRes = await fetch(`http://127.0.0.1:${port}/api/projects/diff`, {
      headers: { Authorization: 'Bearer valid-token-123' },
    })
    assert.equal(projDiffRes.status, 200)
    const projDiffData = (await projDiffRes.json()) as { path: string; diff: string }
    assert.ok(typeof projDiffData.diff === 'string')

    // Post a task first to test task diff retrieval
    const taskPost = await fetch(`http://127.0.0.1:${port}/api/tasks`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token-123',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        taskId: 'task-diff-test',
        prompt: '/status',
        wait: true,
      }),
    })
    assert.equal(taskPost.status, 200)

    const taskDiffRes = await fetch(`http://127.0.0.1:${port}/api/tasks/task-diff-test/diff`, {
      headers: { Authorization: 'Bearer valid-token-123' },
    })
    assert.equal(taskDiffRes.status, 200)
    const taskDiffData = (await taskDiffRes.json()) as {
      taskId: string
      diff: string
      filesChanged: string[]
    }
    assert.equal(taskDiffData.taskId, 'task-diff-test')
    assert.ok(typeof taskDiffData.diff === 'string')
    assert.ok(Array.isArray(taskDiffData.filesChanged))
  })

  test('normalizeFishReferenceId and getGitDiff handle edge inputs cleanly', async () => {
    assert.equal(normalizeFishReferenceId(''), '')
    assert.equal(
      normalizeFishReferenceId('https://fish.audio/m/802e3bc2b27e49c2995d23ef70e6ac89/'),
      '802e3bc2b27e49c2995d23ef70e6ac89',
    )
    assert.equal(
      normalizeFishReferenceId('https://example.test/models/custom-voice'),
      'custom-voice',
    )
    assert.equal(normalizeFishReferenceId('raw_ref_id'), 'raw_ref_id')

    const diff = await getGitDiff(projectDir, [join(projectDir, 'package.json')])
    assert.equal(diff, '')
  })

  test('serves CORS preflight, 404, projects, dashboard, models, sessions, push and approval endpoints', async () => {
    const authHeaders = {
      Authorization: 'Bearer valid-token-123',
      'Content-Type': 'application/json',
    }

    const optRes = await fetch(`http://127.0.0.1:${port}/api/tasks`, { method: 'OPTIONS' })
    assert.equal(optRes.status, 204)

    const notFoundRes = await fetch(`http://127.0.0.1:${port}/api/unknown-route`, {
      headers: authHeaders,
    })
    assert.equal(notFoundRes.status, 404)

    const projectsRes = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      headers: authHeaders,
    })
    assert.equal(projectsRes.status, 200)
    assert.ok(Array.isArray(await projectsRes.json()))

    const activeRes = await fetch(`http://127.0.0.1:${port}/api/projects/active`, {
      headers: authHeaders,
    })
    assert.equal(activeRes.status, 200)

    const dashRes = await fetch(`http://127.0.0.1:${port}/api/dashboard`, { headers: authHeaders })
    assert.equal(dashRes.status, 200)

    const voiceStatusRes = await fetch(`http://127.0.0.1:${port}/api/voice/status`, {
      headers: authHeaders,
    })
    assert.equal(voiceStatusRes.status, 200)

    const memGetRes = await fetch(
      `http://127.0.0.1:${port}/api/projects/memory?path=${encodeURIComponent(projectDir)}`,
      { headers: authHeaders },
    )
    assert.equal(memGetRes.status, 200)

    const memDelRes = await fetch(
      `http://127.0.0.1:${port}/api/projects/memory?path=${encodeURIComponent(projectDir)}`,
      { method: 'DELETE', headers: authHeaders },
    )
    assert.equal(memDelRes.status, 200)

    const modelsRes = await fetch(`http://127.0.0.1:${port}/api/models?backend=brain`, {
      headers: authHeaders,
    })
    assert.equal(modelsRes.status, 200)

    const badModelRes = await fetch(`http://127.0.0.1:${port}/api/models/select`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ backend: 'brain' }),
    })
    assert.equal(badModelRes.status, 400)

    const sessionFiltered = await fetch(
      `http://127.0.0.1:${port}/api/sessions?project=${encodeURIComponent(projectDir)}`,
      { headers: authHeaders },
    )
    assert.equal(sessionFiltered.status, 200)

    const sessionFound = await fetch(`http://127.0.0.1:${port}/api/sessions/task-diff-test`, {
      headers: authHeaders,
    })
    assert.equal(sessionFound.status, 200)

    const sessionMissing = await fetch(`http://127.0.0.1:${port}/api/sessions/does-not-exist`, {
      headers: authHeaders,
    })
    assert.equal(sessionMissing.status, 404)

    const taskFound = await fetch(`http://127.0.0.1:${port}/api/tasks/task-diff-test`, {
      headers: authHeaders,
    })
    assert.equal(taskFound.status, 200)

    const taskMissing = await fetch(`http://127.0.0.1:${port}/api/tasks/does-not-exist`, {
      headers: authHeaders,
    })
    assert.equal(taskMissing.status, 404)

    const taskDiffMissing = await fetch(`http://127.0.0.1:${port}/api/tasks/does-not-exist/diff`, {
      headers: authHeaders,
    })
    assert.equal(taskDiffMissing.status, 404)

    const pushBad = await fetch(`http://127.0.0.1:${port}/api/push/register`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({}),
    })
    assert.equal(pushBad.status, 400)

    const pushOk = await fetch(`http://127.0.0.1:${port}/api/push/register`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ token: 'fcm-device-token-1234567890' }),
    })
    assert.equal(pushOk.status, 200)

    const resetRes = await fetch(`http://127.0.0.1:${port}/api/sessions/reset`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ backend: 'brain', clearHistory: false }),
    })
    assert.equal(resetRes.status, 200)

    const missingApproval = await fetch(
      `http://127.0.0.1:${port}/api/approvals/unknown-id/decide`,
      {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ decision: 'accept' }),
      },
    )
    assert.equal(missingApproval.status, 404)
  })

  test('handles WebSocket upgrade auth, 404 path, connected event and task cancellation broadcast', async () => {
    const rawUpgrade = (requestPath: string, extraHeaders = ''): Promise<string> =>
      new Promise((resolve, reject) => {
        const socket = createConnection({ host: '127.0.0.1', port })
        let received = ''
        socket.on('connect', () => {
          socket.write(
            `GET ${requestPath} HTTP/1.1\r\n` +
              `Host: 127.0.0.1:${port}\r\n` +
              'Upgrade: websocket\r\n' +
              'Connection: Upgrade\r\n' +
              'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
              'Sec-WebSocket-Version: 13\r\n' +
              extraHeaders +
              '\r\n',
          )
        })
        socket.on('data', (chunk) => {
          received += chunk.toString('utf-8')
          socket.end()
        })
        socket.on('close', () => resolve(received))
        socket.on('error', reject)
      })

    const unauth = await rawUpgrade('/ws')
    assert.ok(unauth.includes('401 Unauthorized'))

    const badPath = await rawUpgrade('/ws-other?token=valid-token-123')
    assert.ok(badPath.includes('404 Not Found'))

    const connectedData = await new Promise<string>((resolve, reject) => {
      const socket = createConnection({ host: '127.0.0.1', port })
      let received = ''
      let cancelSent = false
      socket.on('connect', () => {
        socket.write(
          `GET /ws?token=valid-token-123 HTTP/1.1\r\n` +
            `Host: 127.0.0.1:${port}\r\n` +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
            'Sec-WebSocket-Version: 13\r\n\r\n',
        )
      })
      socket.on('data', (chunk) => {
        received += chunk.toString('utf-8')
        if (!cancelSent && received.includes('connected')) {
          cancelSent = true
          void fetch(`http://127.0.0.1:${port}/api/tasks/task-diff-test/cancel`, {
            method: 'POST',
            headers: { Authorization: 'Bearer valid-token-123' },
          })
        }
        if (received.includes('task:cancelled')) {
          socket.destroy()
          resolve(received)
        }
      })
      socket.on('error', reject)
    })

    assert.ok(connectedData.includes('"event":"connected"'))
    assert.ok(connectedData.includes('"event":"task:cancelled"'))
  })

  test('stops daemon server and cleans up', async () => {
    await daemon.stop()
    rmSync(sandbox, { recursive: true, force: true })
  })
})
