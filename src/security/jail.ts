import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, normalize, relative, resolve, sep } from 'node:path';

export class SecurityError extends Error {
  readonly code = 'SECURITY_VIOLATION';
  constructor(message: string) {
    super(message);
    this.name = 'SecurityError';
  }
}

const FORBIDDEN_NAMES = new Set([
  '.ssh',
  '.gnupg',
  '.gpg',
  '.aws',
  '.kube',
  '.docker',
  '.bashrc',
  '.bash_profile',
  '.zshrc',
  '.profile',
  '.netrc',
  'id_rsa',
  'id_ed25519',
  'authorized_keys',
]);

const SYSTEM_FORBIDDEN_ROOTS = ['/etc', '/var', '/proc', '/sys', '/dev', '/root', '/boot'];

export interface JailGuardOptions {
  /** Canonical roots within which access is strictly confined. */
  readonly allowedRoots: readonly string[];
}

export class JailGuard {
  private readonly canonicalRoots: readonly string[];

  constructor(options: JailGuardOptions) {
    if (!options.allowedRoots.length) {
      throw new SecurityError('Au moins un dossier racine autorisé doit être configuré.');
    }

    this.canonicalRoots = options.allowedRoots.map((root) => {
      const resolved = resolve(root);
      if (existsSync(resolved)) {
        try {
          return realpathSync(resolved);
        } catch {
          return normalize(resolved);
        }
      }
      return normalize(resolved);
    });
  }

  /**
   * Returns the list of canonical roots.
   */
  getAllowedRoots(): readonly string[] {
    return this.canonicalRoots;
  }

  /**
   * Validates and returns the safe canonical path if inside allowed roots and not forbidden.
   * Throws SecurityError if outside jail, traversal attempted, or forbidden target.
   */
  resolveSafePath(candidatePath: string): string {
    if (!candidatePath || typeof candidatePath !== 'string') {
      throw new SecurityError('Chemin de fichier invalide ou manquant.');
    }

    // Reject null byte injection
    if (candidatePath.includes('\0')) {
      throw new SecurityError('Injection de caractère nul détectée dans le chemin.');
    }

    // Pre-normalization checks
    const normalized = normalize(candidatePath);

    // Resolve absolute path against the first allowed root if relative
    const resolvedCandidate = isAbsolute(normalized)
      ? normalized
      : resolve(this.canonicalRoots[0], normalized);

    // Canonicalize with realpath if it exists to defeat symlink escapes
    let realCandidate = resolvedCandidate;
    if (existsSync(resolvedCandidate)) {
      try {
        realCandidate = realpathSync(resolvedCandidate);
      } catch {
        realCandidate = resolvedCandidate;
      }
    }

    // Check system forbidden roots
    for (const sysRoot of SYSTEM_FORBIDDEN_ROOTS) {
      if (realCandidate === sysRoot || realCandidate.startsWith(`${sysRoot}${sep}`)) {
        throw new SecurityError(`Accès strictement interdit au répertoire système : ${sysRoot}`);
      }
    }

    // Check forbidden file / directory names
    const parts = realCandidate.split(sep);
    for (const part of parts) {
      if (FORBIDDEN_NAMES.has(part)) {
        throw new SecurityError(`Accès refusé au composant protégé : ${part}`);
      }
    }

    // Verify candidate is strictly contained inside at least one canonical root
    const isContained = this.canonicalRoots.some((root) => {
      if (realCandidate === root) {
        return true;
      }
      const rel = relative(root, realCandidate);
      return !rel.startsWith('..') && !isAbsolute(rel);
    });

    if (!isContained) {
      throw new SecurityError(
        `Violation de confinement : le chemin ${realCandidate} est situé en dehors des racines autorisées.`
      );
    }

    return realCandidate;
  }

  /**
   * Checks whether a candidate path is safely within the jail.
   */
  isPathAllowed(candidatePath: string): boolean {
    try {
      this.resolveSafePath(candidatePath);
      return true;
    } catch {
      return false;
    }
  }
}
