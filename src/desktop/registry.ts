import { logger } from '../logging/logger';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { TaskBackend } from './types';

export interface ProjectRegistryEntry {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly defaultBackend?: TaskBackend;
  readonly protectedBranches?: readonly string[];
  readonly addedAt: number;
  readonly lastActiveAt?: number;
}

export interface ProjectRegistryFile {
  readonly version: 1;
  defaultProjectId?: string;
  projects: ProjectRegistryEntry[];
}

export interface AddProjectOptions {
  readonly path: string;
  readonly name?: string;
  readonly id?: string;
  readonly defaultBackend?: TaskBackend;
  readonly protectedBranches?: readonly string[];
  readonly isDefault?: boolean;
}

export function getDefaultRegistryPath(): string {
  return process.env.NEXUS_PROJECTS_REGISTRY ?? resolve(homedir(), '.nexus', 'projects.json');
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'project'
  );
}

export class ProjectRegistry {
  private readonly filePath: string;
  private data: ProjectRegistryFile;

  constructor(filePath?: string) {
    this.filePath = filePath ? resolve(filePath) : getDefaultRegistryPath();
    this.data = this.load();
  }

  getFilePath(): string {
    return this.filePath;
  }

  private load(): ProjectRegistryFile {
    if (!existsSync(this.filePath)) {
      return {
        version: 1,
        projects: [],
      };
    }

    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && Array.isArray(parsed.projects)) {
        return {
          version: 1,
          defaultProjectId:
            typeof parsed.defaultProjectId === 'string' ? parsed.defaultProjectId : undefined,
          projects: parsed.projects.filter((p: unknown): p is ProjectRegistryEntry =>
            Boolean(
              p &&
                typeof p === 'object' &&
                typeof (p as Record<string, unknown>).id === 'string' &&
                typeof (p as Record<string, unknown>).path === 'string' &&
                typeof (p as Record<string, unknown>).name === 'string'
            )
          ),
        };
      }
    } catch (err) {
      logger.warn('Registry', 'delivery_failed');
    }

    return {
      version: 1,
      projects: [],
    };
  }

  save(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  list(): readonly ProjectRegistryEntry[] {
    return [...this.data.projects];
  }

  get(idOrPath: string): ProjectRegistryEntry | undefined {
    const needle = idOrPath.trim();
    const resolvedNeedle = resolve(needle);

    return this.data.projects.find(
      (p) => p.id === needle || p.name === needle || p.path === needle || p.path === resolvedNeedle
    );
  }

  getDefault(): ProjectRegistryEntry | undefined {
    if (this.data.defaultProjectId) {
      const found = this.data.projects.find((p) => p.id === this.data.defaultProjectId);
      if (found) {
        return found;
      }
    }
    return this.data.projects[0];
  }

  setDefault(idOrPath: string): ProjectRegistryEntry {
    const project = this.get(idOrPath);
    if (!project) {
      throw new Error(`Projet introuvable dans le registre : ${idOrPath}`);
    }
    this.data.defaultProjectId = project.id;
    this.save();
    return project;
  }

  add(options: AddProjectOptions): ProjectRegistryEntry {
    const rawPath = options.path.trim();
    if (!rawPath) {
      throw new Error('Le chemin du projet ne peut pas être vide.');
    }

    const resolvedPath = resolve(rawPath);
    if (!existsSync(resolvedPath)) {
      throw new Error(`Le chemin du projet n'existe pas : ${resolvedPath}`);
    }

    const stat = statSync(resolvedPath);
    if (!stat.isDirectory()) {
      throw new Error(`Le chemin du projet doit être un répertoire : ${resolvedPath}`);
    }

    const baseName = basename(resolvedPath);
    const name = options.name?.trim() || baseName;
    const baseId = slugify(options.id?.trim() || name || baseName);

    // Ensure unique ID if new path
    let id = baseId;
    let counter = 1;
    while (this.data.projects.some((p) => p.id === id && p.path !== resolvedPath)) {
      id = `${baseId}-${++counter}`;
    }

    const existingIndex = this.data.projects.findIndex((p) => p.path === resolvedPath);

    const entry: ProjectRegistryEntry = {
      id: existingIndex !== -1 ? this.data.projects[existingIndex].id : id,
      name,
      path: resolvedPath,
      defaultBackend: options.defaultBackend,
      protectedBranches: options.protectedBranches,
      addedAt: existingIndex !== -1 ? this.data.projects[existingIndex].addedAt : Date.now(),
      lastActiveAt: Date.now(),
    };

    if (existingIndex !== -1) {
      this.data.projects[existingIndex] = entry;
    } else {
      this.data.projects.push(entry);
    }

    if (options.isDefault || !this.data.defaultProjectId) {
      this.data.defaultProjectId = entry.id;
    }

    this.save();
    return entry;
  }

  remove(idOrPath: string): boolean {
    const project = this.get(idOrPath);
    if (!project) {
      return false;
    }

    this.data.projects = this.data.projects.filter((p) => p.id !== project.id);

    if (this.data.defaultProjectId === project.id) {
      this.data.defaultProjectId = this.data.projects[0]?.id;
    }

    this.save();
    return true;
  }

  recordActivity(idOrPath: string): void {
    const index = this.data.projects.findIndex(
      (p) => p.id === idOrPath || p.path === resolve(idOrPath)
    );
    if (index !== -1) {
      const current = this.data.projects[index];
      this.data.projects[index] = {
        ...current,
        lastActiveAt: Date.now(),
      };
      this.save();
    }
  }
}

export function loadProjectRegistry(customPath?: string): ProjectRegistry {
  return new ProjectRegistry(customPath);
}
