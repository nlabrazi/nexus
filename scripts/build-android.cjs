const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const android = path.join(root, 'web', 'android');
const tools = path.join(os.homedir(), '.local', 'share', 'nexus', 'android');
const windows = process.platform === 'win32';
const env = { ...process.env };

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', shell: windows });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} a échoué (${result.status ?? result.signal}).`);
}

try {
  // Prefer Nexus's isolated Linux tools; leave the system Java unchanged.
  const managedJava = path.join(tools, 'jdk-21');
  if (!windows && fs.existsSync(path.join(managedJava, 'bin', 'java'))) {
    env.JAVA_HOME = managedJava;
  }
  if (env.JAVA_HOME) env.PATH = `${path.join(env.JAVA_HOME, 'bin')}${path.delimiter}${env.PATH || ''}`;
  const java = env.JAVA_HOME ? path.join(env.JAVA_HOME, 'bin', windows ? 'java.exe' : 'java') : 'java';
  const version = spawnSync(java, ['-version'], { env, encoding: 'utf8' });
  const major = Number(`${version.stderr || ''}\n${version.stdout || ''}`.match(/version "(\d+)/)?.[1]);
  if (version.status !== 0 || major < 21 || major > 23 || !major) {
    throw new Error('Ce projet nécessite un JDK 21 (Gradle 8.11). Installez-le et renseignez JAVA_HOME.');
  }

  const properties = path.join(android, 'local.properties');
  const original = fs.existsSync(properties) ? fs.readFileSync(properties, 'utf8') : null;
  const configuredSdk = original?.match(/^sdk\.dir=(.*)$/m)?.[1]?.trim().replace(/\\([\\: ])/g, '$1');
  const sdk = [
    !windows && path.join(tools, 'sdk'),
    env.ANDROID_HOME,
    env.ANDROID_SDK_ROOT,
    configuredSdk,
  ].find(candidate => candidate && fs.existsSync(path.join(candidate, 'platforms', 'android-35', 'android.jar')));
  if (!sdk) throw new Error('SDK Android Linux/Windows introuvable : installez la plateforme Android 35 et renseignez ANDROID_HOME.');
  env.ANDROID_HOME = sdk;
  env.ANDROID_SDK_ROOT = sdk;

  console.log(`Compilation Android avec Java ${major}.`);
  run(windows ? 'npm.cmd' : 'npm', ['--prefix', 'web', 'run', 'cap:build']);

  // Use the SDK for this build, then restore the user's Android Studio setting.
  const sdkLine = `sdk.dir=${sdk.replace(/\\/g, '/').replace(/:/g, '\\:')}`;
  const content = original?.match(/^sdk\.dir=.*$/m)
    ? original.replace(/^sdk\.dir=.*$/m, sdkLine)
    : `${original || ''}\n${sdkLine}\n`;
  try {
    fs.writeFileSync(properties, content);
    run(windows ? 'gradlew.bat' : './gradlew', ['--no-daemon', '--console=plain', 'assembleDebug'], android);
  } finally {
    if (original === null) fs.rmSync(properties, { force: true });
    else fs.writeFileSync(properties, original);
  }

  const apk = path.join(root, 'nexus-debug.apk');
  fs.copyFileSync(path.join(android, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'), apk);
  console.log(`\nAPK prêt : ${apk}\nTransférez ce fichier sur votre téléphone pour l’installer.`);
} catch (error) {
  console.error(`\nBuild Android : ${error.message}`);
  process.exitCode = 1;
}
