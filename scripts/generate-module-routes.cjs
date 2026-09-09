/**
 * scripts/generate-module-routes.cjs
 *
 * Emits the Next route files that serve module endpoints.
 *
 * Each module declares its HTTP surface in `src/modules/<id>/module.routes.json`. That file is the
 * single source of truth: the module's manifest imports it to bind handlers, and this generator
 * reads it to emit thin route files under `src/app/api/m/**` that delegate through the registry.
 * A generated route therefore never imports a module — only the composition root may name one.
 *
 * Usage:
 *   node scripts/generate-module-routes.cjs           write the generated tree
 *   node scripts/generate-module-routes.cjs --check    fail when the tree on disk is stale
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const modulesDir = path.join(rootDir, 'src', 'modules');
const generatedApiDir = path.join(rootDir, 'src', 'app', 'api', 'm');
const generatedPageDir = path.join(rootDir, 'src', 'app', 'tools', 'm');

const DECLARATION_FILE_NAME = 'module.routes.json';
const ROUTE_FILE_NAME = 'route.ts';
const PAGE_FILE_NAME = 'page.tsx';
const CHECK_FLAG = '--check';

/**
 * Mirrors of the contracts in src/core/modules. This script is plain Node and cannot import
 * TypeScript, so the values are duplicated here and a unit test holds both copies to the same
 * answers rather than trusting them to stay aligned.
 */
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const RUNTIMES = ['nodejs', 'edge'];
const DYNAMIC_MODES = ['auto', 'force-dynamic', 'force-static', 'error'];

const VALID_MODULE_ID = /^[a-z][a-z0-9-]*$/;

/** Literal segment, or a Next dynamic segment: [id], [...rest] or [[...rest]]. */
const VALID_PATH_SEGMENT = /^(?:[a-z0-9][a-z0-9._-]*|\[\[?\.{0,3}[a-zA-Z][a-zA-Z0-9]*\]?\])$/;

// ---------------------------------------------------------------------------------------------
// Path arithmetic — mirrors src/core/modules/moduleRoutePaths.ts
// ---------------------------------------------------------------------------------------------

function normalizeEndpointPath(endpointPath) {
  return endpointPath.replace(/^\/+|\/+$/g, '');
}

function resolveRoutePath(moduleId, endpointPath) {
  const normalizedPath = normalizeEndpointPath(endpointPath);
  return normalizedPath.length === 0 ? moduleId : `${moduleId}/${normalizedPath}`;
}

function endpointKey(method, endpointPath) {
  const normalizedPath = normalizeEndpointPath(endpointPath);
  return normalizedPath.length === 0 ? method : `${method} ${normalizedPath}`;
}

// ---------------------------------------------------------------------------------------------
// Declaration reading and validation
// ---------------------------------------------------------------------------------------------

function fail(message) {
  throw new Error(message);
}

function assertKnownValue(value, allowedValues, label, context) {
  if (!allowedValues.includes(value)) {
    fail(`${context}: unsupported ${label} "${value}". Supported values: ${allowedValues.join(', ')}.`);
  }
}

function assertValidEndpointPath(endpointPath, context) {
  const normalizedPath = normalizeEndpointPath(endpointPath);
  if (normalizedPath.length === 0) {
    return;
  }

  for (const segment of normalizedPath.split('/')) {
    if (!VALID_PATH_SEGMENT.test(segment)) {
      fail(
        `${context}: segment "${segment}" is not a usable route segment. Use lowercase literals or a Next dynamic segment such as [id].`
      );
    }
  }
}

function validateDeclaration(declaration, moduleId, context) {
  if (typeof declaration.path !== 'string') {
    fail(`${context}: every endpoint needs a string "path" (use "" to serve the module root).`);
  }
  assertValidEndpointPath(declaration.path, context);
  assertKnownValue(declaration.method, HTTP_METHODS, 'method', context);

  if (declaration.runtime !== undefined) {
    assertKnownValue(declaration.runtime, RUNTIMES, 'runtime', context);
  }
  if (declaration.dynamic !== undefined) {
    assertKnownValue(declaration.dynamic, DYNAMIC_MODES, 'dynamic mode', context);
  }

  return {
    moduleId,
    path: normalizeEndpointPath(declaration.path),
    method: declaration.method,
    runtime: declaration.runtime,
    dynamic: declaration.dynamic,
    routePath: resolveRoutePath(moduleId, declaration.path),
  };
}

/**
 * Validates one module's declaration file and returns its endpoints.
 *
 * The module id is checked against the folder name so a copy-pasted declaration cannot silently
 * publish one module's endpoints under another module's prefix.
 */
function parseDeclarationFile(fileContents, moduleDirName) {
  const context = `src/modules/${moduleDirName}/${DECLARATION_FILE_NAME}`;

  let parsed;
  try {
    // Windows editors happily save a byte order mark, which JSON.parse rejects with an error that
    // names an invisible character. The TypeScript side imports the same file without complaint,
    // so tolerate it here rather than letting the two halves disagree over a byte nobody can see.
    parsed = JSON.parse(fileContents.replace(/^\uFEFF/, ''));
  } catch (error) {
    return fail(`${context}: invalid JSON (${error.message}).`);
  }

  if (typeof parsed.moduleId !== 'string' || !VALID_MODULE_ID.test(parsed.moduleId)) {
    fail(
      `${context}: "moduleId" must be lowercase and may contain only letters, digits and hyphens, because it becomes a URL segment.`
    );
  }
  if (parsed.moduleId !== moduleDirName) {
    fail(`${context}: declares moduleId "${parsed.moduleId}" but lives in folder "${moduleDirName}". They must match.`);
  }
  if (!Array.isArray(parsed.endpoints)) {
    fail(`${context}: "endpoints" must be an array (use [] when the module serves no endpoints).`);
  }

  const seenKeys = new Set();
  const endpoints = parsed.endpoints.map((declaration) => {
    const endpoint = validateDeclaration(declaration, parsed.moduleId, context);
    const key = endpointKey(endpoint.method, endpoint.path);

    if (seenKeys.has(key)) {
      fail(`${context}: declares "${key}" twice. Each method and path pair may be declared once.`);
    }
    seenKeys.add(key);

    return endpoint;
  });

  return { endpoints, pages: parsePageDeclarations(parsed, context) };
}

/** Validates the optional `pages` array: a module may own whole routes as well as endpoints. */
function parsePageDeclarations(parsed, context) {
  if (parsed.pages === undefined) {
    return [];
  }
  if (!Array.isArray(parsed.pages)) {
    fail(`${context}: "pages" must be an array when present.`);
  }

  const seenPaths = new Set();
  return parsed.pages.map((declaration) => {
    if (typeof declaration.path !== 'string') {
      fail(`${context}: every page needs a string "path" (use "" to own the module root).`);
    }
    if (typeof declaration.title !== 'string' || declaration.title.trim().length === 0) {
      fail(`${context}: every page needs a non-empty "title"; it becomes the document title.`);
    }
    assertValidEndpointPath(declaration.path, context);

    const normalizedPath = normalizeEndpointPath(declaration.path);
    if (seenPaths.has(normalizedPath)) {
      fail(`${context}: declares page "${normalizedPath}" twice. Each page path may be declared once.`);
    }
    seenPaths.add(normalizedPath);

    return {
      moduleId: parsed.moduleId,
      path: normalizedPath,
      title: declaration.title,
      routePath: resolveRoutePath(parsed.moduleId, declaration.path),
    };
  });
}

/** Collects the declarations of every module that has a declaration file. */
function readModuleDeclarations(modulesDirectory = modulesDir) {
  if (!fs.existsSync(modulesDirectory)) {
    return [];
  }

  const declarations = { endpoints: [], pages: [] };

  const moduleDirNames = fs
    .readdirSync(modulesDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const moduleDirName of moduleDirNames) {
    const declarationPath = path.join(modulesDirectory, moduleDirName, DECLARATION_FILE_NAME);
    if (!fs.existsSync(declarationPath)) {
      continue;
    }
    const parsed = parseDeclarationFile(fs.readFileSync(declarationPath, 'utf8'), moduleDirName);
    declarations.endpoints.push(...parsed.endpoints);
    declarations.pages.push(...parsed.pages);
  }

  return declarations;
}

// ---------------------------------------------------------------------------------------------
// Route planning and rendering
// ---------------------------------------------------------------------------------------------

/**
 * Groups endpoints by the route file that will serve them.
 *
 * Next configures `runtime` and `dynamic` per file, so two methods on the same path cannot ask for
 * different ones. That conflict is rejected here rather than resolved by whichever declaration was
 * read last.
 */
function groupEndpointsByRoute(endpoints) {
  const groupsByRoutePath = new Map();

  for (const endpoint of endpoints) {
    const existingGroup = groupsByRoutePath.get(endpoint.routePath);

    if (!existingGroup) {
      groupsByRoutePath.set(endpoint.routePath, {
        moduleId: endpoint.moduleId,
        routePath: endpoint.routePath,
        methods: [endpoint.method],
        runtime: endpoint.runtime,
        dynamic: endpoint.dynamic,
      });
      continue;
    }

    if (existingGroup.methods.includes(endpoint.method)) {
      fail(`Duplicate module route "${endpoint.method} ${endpoint.routePath}". Two endpoints cannot serve the same method and path.`);
    }
    if (existingGroup.runtime !== endpoint.runtime || existingGroup.dynamic !== endpoint.dynamic) {
      fail(
        `Conflicting configuration for route "${endpoint.routePath}": methods on one path share a single route file, so they must declare the same runtime and dynamic mode.`
      );
    }

    existingGroup.methods.push(endpoint.method);
  }

  return [...groupsByRoutePath.values()]
    .sort((first, second) => first.routePath.localeCompare(second.routePath))
    .map((group) => ({
      ...group,
      methods: HTTP_METHODS.filter((method) => group.methods.includes(method)),
    }));
}

function renderRouteConfiguration(group) {
  const configurationLines = [];

  if (group.runtime !== undefined) {
    configurationLines.push(`export const runtime = "${group.runtime}";`);
  }
  if (group.dynamic !== undefined) {
    configurationLines.push(`export const dynamic = "${group.dynamic}";`);
  }

  return configurationLines.length === 0 ? '' : `${configurationLines.join('\n')}\n\n`;
}

function renderRouteHandlers(group) {
  return group.methods
    .map(
      (method) =>
        `export const ${method} = createModuleRouteHandler(\n  moduleRegistry,\n  ModuleHttpMethod.${method},\n  ROUTE_PATH\n);`
    )
    .join('\n\n');
}

function renderRouteFile(group) {
  return `/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Emitted by scripts/generate-module-routes.cjs from
 * src/modules/${group.moduleId}/${DECLARATION_FILE_NAME}.
 *
 * Regenerate with \`npm run modules:routes\`. \`npm run modules:routes:check\` fails when this tree
 * is stale, so the served surface always matches the declarations that produced it.
 */
import { moduleRegistry } from "@/app/modules.registry";
import { ModuleHttpMethod } from "@/core/modules/contracts";
import { createModuleRouteHandler } from "@/core/modules/createModuleRouteHandler";

const ROUTE_PATH = "${group.routePath}";

${renderRouteConfiguration(group)}${renderRouteHandlers(group)}
`;
}

/**
 * Renders a page route.
 *
 * Like a generated API route it names its module only as a string and resolves through the
 * registry, so the composition root keeps its monopoly. `notFound()` covers the case of a route
 * file left behind by a module that no longer owns it.
 */
function renderPageFile(page) {
  return `/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Emitted by scripts/generate-module-routes.cjs from
 * src/modules/${page.moduleId}/${DECLARATION_FILE_NAME}.
 *
 * Regenerate with \`npm run modules:routes\`. \`npm run modules:routes:check\` fails when this tree
 * is stale, so the served surface always matches the declarations that produced it.
 */
import { notFound } from "next/navigation";
import { moduleRegistry } from "@/app/modules.registry";
import { ModuleErrorBoundary } from "@/ui-kit/modules/ModuleErrorBoundary";

const PAGE_ROUTE_PATH = "${page.routePath}";

export const metadata = {
  title: "${page.title.replace(/"/g, '\\"')}",
};

export default function ModuleOwnedPage() {
  const registeredPage = moduleRegistry.findPage(PAGE_ROUTE_PATH);

  if (!registeredPage) {
    notFound();
  }

  const ModuleOwnedPageContent = registeredPage.page.Component;

  return (
    <ModuleErrorBoundary contributionId={PAGE_ROUTE_PATH}>
      <ModuleOwnedPageContent />
    </ModuleErrorBoundary>
  );
}
`;
}

/** Builds the complete generated tree: output paths relative to the repo root, and contents. */
function planGeneratedFiles(declarations) {
  const endpointFiles = groupEndpointsByRoute(declarations.endpoints).map((group) => ({
    relativePath: path.posix.join('src/app/api/m', group.routePath, ROUTE_FILE_NAME),
    contents: renderRouteFile(group),
  }));

  const pageFiles = [...declarations.pages]
    .sort((first, second) => first.routePath.localeCompare(second.routePath))
    .map((page) => ({
      relativePath: path.posix.join('src/app/tools/m', page.routePath, PAGE_FILE_NAME),
      contents: renderPageFile(page),
    }));

  return [...endpointFiles, ...pageFiles];
}

// ---------------------------------------------------------------------------------------------
// Disk reconciliation
// ---------------------------------------------------------------------------------------------

function listExistingFiles(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listExistingFiles(fullPath) : [fullPath];
  });
}

/** Line endings vary with git's autocrlf, so comparisons ignore them. */
function normalizeLineEndings(contents) {
  return contents.replace(/\r\n/g, '\n');
}

function toRelativePosixPath(absolutePath) {
  return path.relative(rootDir, absolutePath).split(path.sep).join('/');
}

function diffAgainstDisk(plannedFiles) {
  const plannedByPath = new Map(plannedFiles.map((file) => [file.relativePath, file.contents]));
  const existingPaths = [
    ...listExistingFiles(generatedApiDir),
    ...listExistingFiles(generatedPageDir),
  ].map(toRelativePosixPath);

  const stalePaths = existingPaths.filter((existingPath) => !plannedByPath.has(existingPath)).sort();
  const missingPaths = [];
  const changedPaths = [];

  for (const [relativePath, contents] of plannedByPath) {
    const absolutePath = path.join(rootDir, relativePath);
    if (!fs.existsSync(absolutePath)) {
      missingPaths.push(relativePath);
      continue;
    }
    if (normalizeLineEndings(fs.readFileSync(absolutePath, 'utf8')) !== normalizeLineEndings(contents)) {
      changedPaths.push(relativePath);
    }
  }

  return { missingPaths, changedPaths, stalePaths };
}

function removeEmptyDirectories(directory) {
  if (!fs.existsSync(directory)) {
    return;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      removeEmptyDirectories(path.join(directory, entry.name));
    }
  }

  if (fs.readdirSync(directory).length === 0) {
    fs.rmdirSync(directory);
  }
}

function writeGeneratedFiles(plannedFiles, drift) {
  for (const stalePath of drift.stalePaths) {
    fs.rmSync(path.join(rootDir, stalePath));
  }

  const outdatedPaths = new Set([...drift.missingPaths, ...drift.changedPaths]);
  for (const file of plannedFiles) {
    if (!outdatedPaths.has(file.relativePath)) {
      continue;
    }
    const absolutePath = path.join(rootDir, file.relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, file.contents, 'utf8');
  }

  removeEmptyDirectories(generatedApiDir);
  removeEmptyDirectories(generatedPageDir);
}

function describeDrift(drift) {
  return [
    ...drift.missingPaths.map((filePath) => `  missing: ${filePath}`),
    ...drift.changedPaths.map((filePath) => `  outdated: ${filePath}`),
    ...drift.stalePaths.map((filePath) => `  orphaned: ${filePath}`),
  ].join('\n');
}

function hasDrift(drift) {
  return drift.missingPaths.length + drift.changedPaths.length + drift.stalePaths.length > 0;
}

function main(argv) {
  const isCheckMode = argv.includes(CHECK_FLAG);
  const plannedFiles = planGeneratedFiles(readModuleDeclarations());
  const drift = diffAgainstDisk(plannedFiles);

  if (isCheckMode) {
    if (hasDrift(drift)) {
      console.error('Generated module routes are stale:');
      console.error(describeDrift(drift));
      console.error('\nRun `npm run modules:routes` and commit the result.');
      return 1;
    }
    console.log(`Generated module routes are up to date (${plannedFiles.length} route file(s)).`);
    return 0;
  }

  if (!hasDrift(drift)) {
    console.log(`Generated module routes already up to date (${plannedFiles.length} route file(s)).`);
    return 0;
  }

  writeGeneratedFiles(plannedFiles, drift);
  console.log(`Generated module routes updated (${plannedFiles.length} route file(s)):`);
  console.log(describeDrift(drift));
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`Module route generation failed.\n${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  endpointKey,
  groupEndpointsByRoute,
  main,
  normalizeEndpointPath,
  parseDeclarationFile,
  planGeneratedFiles,
  readModuleDeclarations,
  renderRouteFile,
  renderPageFile,
  resolveRoutePath,
  DYNAMIC_MODES,
  HTTP_METHODS,
  RUNTIMES,
};
