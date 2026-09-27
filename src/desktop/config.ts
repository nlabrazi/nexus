import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { hostname } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadProjectRegistry } from './registry';
import { DesktopNodeConfig, DesktopProjectConfig, TaskBackend } from './types';

const VALID_BACKENDS = new Set<TaskBackend>(['codex', 'antigravity', 'brain']);

export interface CliConfigOptions {
  readonly project?: string;
  readonly projects?: readonly string[];
  readonly name?: string;
  readonly nodeId?: string;
  readonly nodeName?: string;
  readonly authToken?: string;
  readonly core?: string;
  readonly backend?: string;
  readonly config?: string;
  readonly registryPath?: string;
  readonly protectedBranches?: readonly string[];
  readonly autoDiscover?: boolean;
}

export function loadConfigFile(configPath: string): Partial<DesktopNodeConfig> {
  const resolved = resolve(configPath);
  if (!existsSync(resolved)) {
    throw new Error(`Fichier de configuration introuvable : ${resolved}`);
  }

  try {
    const raw = readFileSync(resolved, 'utf-8');
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Le fichier de configuration doit contenir un objet JSON.');
    }
    return parsed as Partial<DesktopNodeConfig>;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Fichier de configuration')) {
      throw error;
    }
    throw new Error(
      `Impossible de lire le fichier de configuration ${resolved} : ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export function resolveDesktopConfig(
  cliOptions?: CliConfigOptions,
  env: NodeJS.ProcessEnv = process.env,
  baseDir: string = process.cwd()
): DesktopNodeConfig {
  let fileConfig: Partial<DesktopNodeConfig> = {};
  const configPath = cliOptions?.config ?? env.NEXUS_CONFIG;
  if (configPath) {
    fileConfig = loadConfigFile(resolve(baseDir, configPath));
  }

  // Resolve projects
  const rawProjects: DesktopProjectConfig[] = [];

  // 1. Projects from Registry (~/.nexus/projects.json)
  const registry = loadProjectRegistry(cliOptions?.registryPath ?? env.NEXUS_PROJECTS_REGISTRY);
  const defaultRegProj = registry.getDefault();
  for (const regProj of registry.list()) {
    // Put default project first, others after
    if (regProj.id === defaultRegProj?.id) {
      rawProjects.unshift({
        id: regProj.id,
        name: regProj.name,
        path: regProj.path,
        protectedBranches: regProj.protectedBranches ? [...regProj.protectedBranches] : undefined,
      });
    } else {
      rawProjects.push({
        id: regProj.id,
        name: regProj.name,
        path: regProj.path,
        protectedBranches: regProj.protectedBranches ? [...regProj.protectedBranches] : undefined,
      });
    }
  }

  // 2. Projects from config file
  if (Array.isArray(fileConfig.projects)) {
    for (const proj of fileConfig.projects) {
      if (proj && typeof proj.path === 'string') {
        rawProjects.push(proj);
      }
    }
  }

  // 3. Projects from multiple CLI arguments / comma-separated list
  if (cliOptions?.projects) {
    for (const p of cliOptions.projects) {
      if (p.trim()) {
        rawProjects.unshift({ path: p.trim() });
      }
    }
  }

  // 4. Project from CLI or ENV (--project)
  const cliProjectPath = cliOptions?.project ?? env.NEXUS_PROJECT_PATH ?? env.NEXUS_PROJECT;
  if (cliProjectPath) {
    const cliProjectName = cliOptions?.name ?? env.NEXUS_PROJECT_NAME;
    rawProjects.unshift({
      path: cliProjectPath,
      name: cliProjectName,
      protectedBranches: cliOptions?.protectedBranches,
    });
  }

  if (rawProjects.length === 0) {
    throw new Error(
      'Aucun projet configuré. Spécifiez au moins un projet via --project <chemin>, enregistrez-en un via `nexus-desktop projects add <chemin>`, ou définissez la variable NEXUS_PROJECT_PATH.'
    );
  }

  // 5. Auto-discover sibling workspace directories in parent folder if requested
  const shouldAutoDiscover =
    cliOptions?.autoDiscover ??
    (env.NEXUS_AUTO_DISCOVER === '1' || env.NEXUS_AUTO_DISCOVER === 'true');
  const primaryCandidate = rawProjects[0]?.path ? resolve(baseDir, rawProjects[0].path) : undefined;
  if (shouldAutoDiscover && primaryCandidate && existsSync(primaryCandidate)) {
    try {
      const parentDir = dirname(primaryCandidate);
      const isSystemDir =
        parentDir === '/' || parentDir === '/tmp' || parentDir === '/home' || parentDir === '/var';
      if (!isSystemDir && existsSync(parentDir) && statSync(parentDir).isDirectory()) {
        const entries = readdirSync(parentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
            const siblingPath = resolve(parentDir, entry.name);
            const isProject =
              existsSync(resolve(siblingPath, '.git')) ||
              existsSync(resolve(siblingPath, 'package.json')) ||
              existsSync(resolve(siblingPath, '.nexus')) ||
              existsSync(resolve(siblingPath, 'Cargo.toml')) ||
              existsSync(resolve(siblingPath, 'pyproject.toml'));
            if (isProject && !rawProjects.some((p) => resolve(baseDir, p.path) === siblingPath)) {
              rawProjects.push({
                name: entry.name,
                path: siblingPath,
              });
            }
          }
        }
      }
    } catch {
      // Non-blocking sibling exploration
    }
  }

  // Deduplicate and resolve projects
  const validatedProjects: DesktopProjectConfig[] = [];
  const seenPaths = new Set<string>();

  for (const proj of rawProjects) {
    const resolvedPath = resolve(baseDir, proj.path);
    if (seenPaths.has(resolvedPath)) {
      continue;
    }
    seenPaths.add(resolvedPath);

    if (!existsSync(resolvedPath)) {
      throw new Error(`Le chemin du projet n'existe pas : ${resolvedPath}`);
    }

    const stat = statSync(resolvedPath);
    if (!stat.isDirectory()) {
      throw new Error(`Le chemin du projet n'est pas un répertoire : ${resolvedPath}`);
    }

    const name = proj.name?.trim() || basename(resolvedPath);
    const id = proj.id?.trim() || name.toLowerCase().replace(/[^a-z0-9_-]/g, '-');

    validatedProjects.push({
      id,
      name,
      path: resolvedPath,
      protectedBranches: proj.protectedBranches,
    });
  }

  // Backend
  const backendCandidate =
    cliOptions?.backend ?? env.NEXUS_DEFAULT_BACKEND ?? fileConfig.defaultBackend ?? 'codex';
  if (!VALID_BACKENDS.has(backendCandidate as TaskBackend)) {
    throw new Error(
      `Backend inconnu : « ${backendCandidate} ». Valeurs permises : codex, antigravity, brain.`
    );
  }
  const defaultBackend = backendCandidate as TaskBackend;

  // Node ID and Name
  const nodeId =
    cliOptions?.nodeId?.trim() ??
    env.NEXUS_NODE_ID?.trim() ??
    fileConfig.nodeId?.trim() ??
    randomUUID();

  const nodeName =
    cliOptions?.nodeName?.trim() ??
    env.NEXUS_NODE_NAME?.trim() ??
    fileConfig.nodeName?.trim() ??
    hostname() ??
    'nexus-desktop';

  // Auth token
  const authToken =
    cliOptions?.authToken?.trim() ??
    env.NEXUS_CORE_AUTH_TOKEN?.trim() ??
    env.NEXUS_AUTH_TOKEN?.trim() ??
    (env.NEXUS_CORE_AUTH_TOKENS ? env.NEXUS_CORE_AUTH_TOKENS.split(',')[0].trim() : undefined) ??
    fileConfig.authToken?.trim() ??
    '';

  const coreUrl =
    cliOptions?.core?.trim() ?? env.NEXUS_CORE_URL?.trim() ?? fileConfig.coreUrl?.trim();

  if (coreUrl && !authToken) {
    throw new Error(
      "Jeton d'authentification manquant pour se connecter à Nexus Core. Spécifiez --token <token> ou la variable NEXUS_CORE_AUTH_TOKEN."
    );
  }

  const protectedBranches = cliOptions?.protectedBranches ?? fileConfig.protectedBranches;

  return {
    nodeId,
    nodeName,
    authToken,
    coreUrl,
    projects: validatedProjects,
    defaultBackend,
    protectedBranches,
  };
}
