const { createServer } = require('node:http');
const { readFileSync, mkdtempSync, rmSync } = require('node:fs');
const { join, extname } = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
// Run after npm run web:build. CHROME_BIN can select another Chromium executable.
const root = join(__dirname, '..', 'web', '.output', 'public');
const fixture = {
  uptimeSeconds: 30,
  totalNodes: 1,
  onlineNodes: 1,
  nodes: [
    {
      nodeId: 'smoke',
      nodeName: 'Poste de test',
      online: true,
      state: 'idle',
      activeProject: { id: 'test', name: 'Projet de test', path: '/test' },
    },
  ],
  projects: [],
  activeTasks: 0,
  pendingApprovals: 0,
};
let taskResponse;
let activeTask;
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const json = (data) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  };
  if (path === '/status') return json(fixture);
  if (path === '/api/tasks' && req.method === 'POST') {
    taskResponse = res;
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const task = JSON.parse(body);
      activeTask = {
        ...task,
        status: 'running',
        stage: 'inspecting',
        createdAt: Date.now(),
        nodeId: 'smoke',
      };
    });
    return;
  }
  if (path === '/api/tasks') return json(activeTask ? [activeTask] : []);
  if (path === '/api/approvals') return json([]);
  if (path === '/api/voice/status') return json({ available: false });
  if (path === '/api/models')
    return json({
      models: [{ id: 'local', model: 'local', displayName: 'Local' }],
      selected: { model: 'local' },
    });
  try {
    res.setHeader(
      'Content-Type',
      {
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.html': 'text/html',
        '.json': 'application/json',
      }[extname(path)] || 'text/html'
    );
    res.end(readFileSync(join(root, path === '/' ? 'index.html' : path)));
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
});
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const profile = mkdtempSync('/tmp/nexus-chrome-');
  const chrome = spawn(
    process.env.CHROME_BIN || '/usr/bin/google-chrome',
    [
      '--headless',
      ...(process.env.CHROME_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
      '--disable-gpu',
      '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
  const chromeExit = new Promise((resolve) => chrome.once('exit', resolve));
  let ws;
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let data = '';
      const timer = setTimeout(() => reject(Error('Chrome startup timeout')), 10000);
      chrome.stderr.on('data', (chunk) => {
        data += chunk;
        const match = data.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      chrome.on('error', reject);
    });
    const debugUrl = new URL(endpoint);
    const tabs = await fetch(`http://${debugUrl.host}/json/list`).then((r) => r.json());
    ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r, { once: true }));
    let seq = 0;
    const pending = new Map();
    const exceptions = [];
    ws.addEventListener('message', (e) => {
      const data = JSON.parse(e.data);
      if (data.id) {
        const p = pending.get(data.id);
        if (p) {
          pending.delete(data.id);
          data.error ? p.reject(data.error) : p.resolve(data.result);
        }
      } else if (data.method === 'Runtime.exceptionThrown')
        exceptions.push(data.params.exceptionDetails);
    });
    const call = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async (expression) => {
      const result = await call('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const waitFor = async (expression) => {
      for (let i = 0; i < 100; i++) {
        if (await evaluate(expression)) return;
        await delay(50);
      }
      throw Error(`Timed out: ${expression}`);
    };
    await call('Runtime.enable');
    await call('Page.enable');
    await call('Page.addScriptToEvaluateOnNewDocument', {
      source: `
      localStorage.setItem('nexus_core_url', location.origin);
      localStorage.setItem('nexus_tts_enabled', 'true');
      localStorage.setItem('nexus_auto_send_voice', 'false');
      localStorage.setItem('nexus_tts_preferences', JSON.stringify({autoSpeak:false,rate:1.2,voice:''}));
      window.nativeCalls=[]; window.spoken=[]; window.transcript='Une demande dictée';
      window.androidBridge={};
      const methods={TextToSpeech:['getSupportedVoices','speak','stop'],SpeechRecognition:['available','checkPermissions','start','stop','removeAllListeners'],StatusBar:['setStyle','setBackgroundColor'],Haptics:['impact','notification']};
      window.Capacitor={PluginHeaders:Object.entries(methods).map(([name, methods])=>({name,methods:methods.map(name=>({name,rtype:'promise'}))})),
        nativePromise:async(plugin,method,options)=>{
          window.nativeCalls.push({plugin,method,options});
          if(plugin==='TextToSpeech'){
            if(method==='getSupportedVoices')return {voices:[{voiceURI:'local-fr',lang:'fr-FR',name:'Français',localService:true,default:true}]};
            if(method==='speak'){window.spoken.push(options);return new Promise(resolve=>{window.finishSpeech=resolve;});}
          }
          if(plugin==='SpeechRecognition'){
            if(method==='available')return {available:true};
            if(method==='checkPermissions')return {speechRecognition:'granted'};
            if(method==='start')return {matches:[window.transcript]};
          }
          return {};
        }
      };
    `,
    });
    await call('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
    await waitFor(
      "document.querySelector('.welcome-title') && document.querySelector('.project-pill-name')?.textContent.includes('Projet de test')"
    );
    const submit = () =>
      evaluate(
        "document.querySelector('.composer').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))"
      );
    const type = (text) =>
      evaluate(
        `document.querySelector('#message').value=${JSON.stringify(text)};document.querySelector('#message').dispatchEvent(new Event('input',{bubbles:true}));`
      );
    const reply = async () => {
      for (let i = 0; i < 100 && !taskResponse; i++) await delay(50);
      assert.ok(taskResponse, 'request sent to Core');
      activeTask = undefined;
      taskResponse.setHeader('Content-Type', 'application/json');
      taskResponse.end(JSON.stringify({ text: '**Réponse finale** de Nexus.' }));
      taskResponse = undefined;
      await waitFor("!document.querySelector('#message').disabled");
    };
    const dictate = async () => {
      await evaluate("document.querySelector('.mic-button').click()");
      await waitFor("document.querySelector('#message').value.includes('demande dictée')");
    };
    // Dictation followed by manual send must preserve the voice origin.
    await dictate();
    await submit();
    await reply();
    await waitFor('window.spoken.length===1');
    assert.equal(await evaluate('window.spoken[0].text'), 'Réponse finale de Nexus.');
    assert.equal(await evaluate('window.spoken[0].voice'), 0);
    assert.equal(await evaluate('window.spoken[0].rate'), 1.2);
    await waitFor("document.querySelector('.beacon-label').textContent==='SPEAKING'");
    // Starting another dictation stops native playback before opening recognition.
    await dictate();
    const calls = await evaluate('window.nativeCalls');
    const recognitionIndex = calls.findLastIndex(
      (c) => c.plugin === 'SpeechRecognition' && c.method === 'start'
    );
    assert.ok(
      calls
        .slice(0, recognitionIndex)
        .filter((c) => c.plugin === 'TextToSpeech' && c.method === 'stop').length >= 3
    );
    // Deleting that dictated draft resets its origin; written messages stay silent.
    await type('');
    await type('Message écrit');
    await submit();
    await reply();
    await delay(100);
    assert.equal(await evaluate('window.spoken.length'), 1);
    await evaluate("document.querySelector('.status-beacon').click()");
    await waitFor("document.querySelector('dialog[open] .switch-field')");
    await evaluate(
      "[...document.querySelectorAll('.switch-field')].find(e=>e.textContent.includes('Envoyer après')).querySelector('input').click()"
    );
    await evaluate('document.querySelector(\'dialog[open] [aria-label="Fermer"]\').click()');
    // Auto-send must also produce native speech with auto-read for typed messages off.
    await evaluate("document.querySelector('.mic-button').click()");
    await reply();
    await waitFor('window.spoken.length===2');
    await evaluate('window.finishSpeech()');
    await waitFor("document.querySelector('.beacon-label').textContent==='READY'");
    // Global mute overrides voice-origin replies.
    await evaluate("document.querySelector('.status-beacon').click()");
    await waitFor("document.querySelector('dialog[open] .switch-field')");
    await evaluate(
      "[...document.querySelectorAll('.switch-field')].find(e=>e.textContent.includes('Activer la voix')).querySelector('input').click()"
    );
    await evaluate('document.querySelector(\'dialog[open] [aria-label="Fermer"]\').click()');
    await evaluate("document.querySelector('.mic-button').click()");
    await reply();
    await delay(100);
    assert.equal(await evaluate('window.spoken.length'), 2);
    assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
    console.log(
      'Android bridge smoke passed: manual and automatic dictation → native TTS, Markdown cleanup, voice/speed, microphone interruption, typed draft reset, global mute, no runtime exceptions.'
    );
  } finally {
    ws?.close();
    taskResponse?.end('{}');
    chrome.kill('SIGTERM');
    await chromeExit;
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
