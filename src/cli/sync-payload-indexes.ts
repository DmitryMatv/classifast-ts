import { parseArgs } from "node:util";
import { z } from "zod";
import {
  buildClassifierConfig,
  getAllCollectionNames,
  type CollectionLayout,
} from "../classifier/classifier-config.js";
import { loadEnvFileIfPresent } from "../config/env-file.js";
import {
  migrateConfiguredCollections,
  type QdrantIndexClient,
} from "../qdrant/payload-index-migration.js";
import { createQdrantClient } from "../qdrant/qdrant-connection.js";
import {
  errorMessage,
  formatValidationIssue,
  inspectConfiguredCollections,
  type QdrantValidationReport,
} from "../qdrant/qdrant-schema.js";

const PROGRAM = "sync-payload-indexes";
const USAGE = `usage: ${PROGRAM} {check,apply} [--collection NAME]...`;
const HELP = `${USAGE}

Validate or reconcile configured Qdrant payload indexes.

commands:
  check              Report schema problems without changing Qdrant.
  apply              Backfill normalized IDs and create or replace indexes.

options:
  --collection NAME  Limit the operation to a configured collection
                     (repeatable).
  -h, --help         Show this help.`;

const MAINTENANCE_TIMEOUT_MS = 120_000;
const RULE = "=".repeat(60);
const ENV_FILE = new URL("../../.env", import.meta.url);

const commandSchema = z.enum(["check", "apply"]);
type Command = z.infer<typeof commandSchema>;

export interface CliDeps {
  readonly env: NodeJS.ProcessEnv;
  readonly loadEnvFile: () => void;
  readonly createClient: (env: NodeJS.ProcessEnv) => QdrantIndexClient;
}

export const defaultDeps: CliDeps = {
  env: process.env,
  loadEnvFile: () => loadEnvFileIfPresent(ENV_FILE),
  createClient: (env) => createQdrantClient(env, MAINTENANCE_TIMEOUT_MS),
};

type ParsedArgs =
  { kind: "help" } | { kind: "run"; command: Command; collections: string[] };

class UsageError extends Error {}

function parseCliArgs(argv: readonly string[]): ParsedArgs {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        collection: { type: "string", multiple: true },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    throw new UsageError(errorMessage(error));
  }
  if (parsed.values.help) return { kind: "help" };

  const [command, ...extra] = parsed.positionals;
  if (command === undefined) {
    throw new UsageError("the following arguments are required: command");
  }
  const result = commandSchema.safeParse(command);
  if (!result.success) {
    throw new UsageError(
      `argument command: invalid choice: '${command}' (choose from check, apply)`,
    );
  }
  if (extra.length > 0) {
    throw new UsageError(`unrecognized arguments: ${extra.join(" ")}`);
  }
  return {
    kind: "run",
    command: result.data,
    collections: parsed.values.collection ?? [],
  };
}

function selectCollections(
  requested: readonly string[],
  config: CollectionLayout,
): Set<string> | undefined {
  if (requested.length === 0) return undefined;
  const configured = new Set(getAllCollectionNames(config));
  const selected = new Set(requested);
  const unknown = [...selected].filter((name) => !configured.has(name)).sort();
  if (unknown.length > 0) {
    throw new UsageError(
      `Unknown configured collection(s): ${unknown.join(", ")}`,
    );
  }
  return selected;
}

function printValidationReport(report: QdrantValidationReport): void {
  if (report.issues.length === 0) {
    console.log(
      `Validated ${report.quantizationCache.size} configured collection(s).`,
    );
    return;
  }
  console.log("Qdrant schema validation failed:");
  for (const issue of report.issues) {
    console.log(`  ! ${formatValidationIssue(issue)}`);
  }
}

async function runCheck(
  client: QdrantIndexClient,
  config: CollectionLayout,
  collectionNames: ReadonlySet<string> | undefined,
): Promise<number> {
  const report = await inspectConfiguredCollections(
    client,
    config,
    collectionNames,
  );
  printValidationReport(report);
  return report.issues.length === 0 ? 0 : 1;
}

async function runApply(
  client: QdrantIndexClient,
  config: CollectionLayout,
  collectionNames: ReadonlySet<string> | undefined,
): Promise<number> {
  const { successCount, errorCount } = await migrateConfiguredCollections(
    client,
    config,
    collectionNames,
  );
  const report = await inspectConfiguredCollections(
    client,
    config,
    collectionNames,
  );

  console.log(`\n${RULE}`);
  console.log(`Completed: ${successCount} collections remediated successfully`);
  if (errorCount > 0) {
    console.log(`Errors: ${errorCount} collections had migration issues`);
  }
  printValidationReport(report);
  console.log(RULE);
  return errorCount === 0 && report.issues.length === 0 ? 0 : 1;
}

export async function main(
  argv: readonly string[],
  deps: CliDeps = defaultDeps,
): Promise<number> {
  let args: ParsedArgs;
  let config: CollectionLayout;
  let collectionNames: Set<string> | undefined;
  try {
    args = parseCliArgs(argv);
    if (args.kind === "help") {
      console.log(HELP);
      return 0;
    }
    deps.loadEnvFile();
    config = buildClassifierConfig(deps.env);
    collectionNames = selectCollections(args.collections, config);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`${USAGE}\n${PROGRAM}: error: ${error.message}`);
      return 2;
    }
    console.error(
      `Invalid configuration: ${error instanceof z.ZodError ? z.prettifyError(error) : errorMessage(error)}`,
    );
    return 1;
  }

  console.log(RULE);
  console.log("Qdrant Payload Index Sync");
  console.log(RULE);
  console.log(`Mode: ${args.command}`);

  try {
    const client = deps.createClient(deps.env);
    return args.command === "check"
      ? await runCheck(client, config, collectionNames)
      : await runApply(client, config, collectionNames);
  } catch (error) {
    console.log(`Qdrant operation failed: ${errorMessage(error)}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
